CREATE TABLE cartography.change_branches (
  epoch_id text NOT NULL,
  branch_name text NOT NULL CHECK (btrim(branch_name) <> ''),
  base_revision_id uuid NOT NULL,
  PRIMARY KEY (epoch_id, branch_name),
  FOREIGN KEY (base_revision_id, epoch_id) REFERENCES cartography.topology_revisions (revision_id, epoch_id)
);

CREATE TABLE cartography.spatial_changesets (
  changeset_id uuid PRIMARY KEY,
  epoch_id text NOT NULL,
  branch_name text NOT NULL,
  author_type text NOT NULL CHECK (author_type IN ('AI_AGENT', 'HUMAN_EDITOR')),
  author_id text NOT NULL CHECK (btrim(author_id) <> ''),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  review_issues jsonb NOT NULL CHECK (jsonb_typeof(review_issues) = 'array'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (epoch_id, branch_name) REFERENCES cartography.change_branches
);

CREATE TABLE cartography.changeset_event_bindings (
  changeset_id uuid NOT NULL REFERENCES cartography.spatial_changesets,
  hist_event_id text NOT NULL CHECK (btrim(hist_event_id) <> ''),
  event_revision text NOT NULL CHECK (btrim(event_revision) <> ''),
  citation_indexes jsonb NOT NULL
    CHECK (jsonb_typeof(citation_indexes) = 'array' AND jsonb_array_length(citation_indexes) > 0),
  PRIMARY KEY (changeset_id, hist_event_id)
);

CREATE FUNCTION cartography.read_open_changeset(p_id uuid, p_request_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_changeset cartography.spatial_changesets%ROWTYPE;
  v_revision uuid;
  v_event_ids jsonb;
  v_events jsonb;
BEGIN
  SELECT * INTO v_changeset FROM cartography.spatial_changesets WHERE changeset_id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_changeset.request_sha256 IS DISTINCT FROM p_request_sha256 THEN
    RAISE EXCEPTION 'ChangeSet ID already belongs to a different request' USING ERRCODE = '22023';
  END IF;
  SELECT base_revision_id INTO STRICT v_revision FROM cartography.change_branches
  WHERE epoch_id = v_changeset.epoch_id AND branch_name = v_changeset.branch_name;
  SELECT jsonb_agg(b.hist_event_id ORDER BY b.hist_event_id),
         jsonb_agg(jsonb_build_object(
           'hist_event_id', b.hist_event_id, 'event_revision', b.event_revision,
           'citation_indexes', b.citation_indexes
         ) ORDER BY b.hist_event_id)
  INTO v_event_ids, v_events FROM cartography.changeset_event_bindings AS b WHERE b.changeset_id = p_id;
  IF v_event_ids IS NULL THEN
    RAISE EXCEPTION 'ChangeSet % has no bound event', p_id USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object(
    'status', 'OPENED', 'base_revision_id', v_revision, 'bound_events', v_events, 'issues', v_changeset.review_issues,
    'changeset', jsonb_build_object(
      'changeset_id', p_id, 'epoch_id', v_changeset.epoch_id, 'branch_name', v_changeset.branch_name,
      'author_type', v_changeset.author_type, 'author_id', v_changeset.author_id, 'bound_event_ids', v_event_ids,
      'operations_log', '[]'::jsonb,
      'gate_report', jsonb_build_object(
        'g1_topology_passed', false, 'g1_5_smoothness_passed', false, 'g2_event_binding_passed', true,
        'g3_provenance_quote_passed', NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_changeset.review_issues) AS issue WHERE issue->>'gate' = 'G3'
        ),
        'g4_human_lock_passed', false
      ),
      'status', CASE WHEN v_changeset.review_issues = '[]'::jsonb THEN 'DRAFT' ELSE 'PENDING_HUMAN_REVIEW' END,
      'created_at_iso', to_char(v_changeset.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
END;
$$;

CREATE FUNCTION cartography.open_draft_changeset(
  p_id uuid, p_base_revision_id uuid, p_epoch_id text, p_branch_name text, p_author_type text,
  p_author_id text, p_request_sha256 text, p_bound_events jsonb, p_review_issues jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing jsonb;
  v_branch_revision uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cartography:changeset:' || p_id::text, 0));
  v_existing := cartography.read_open_changeset(p_id, p_request_sha256);
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF p_bound_events IS NULL OR jsonb_typeof(p_bound_events) <> 'array' OR jsonb_array_length(p_bound_events) = 0 THEN
    RAISE EXCEPTION 'A ChangeSet requires at least one event' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_bound_events) AS b
    WHERE jsonb_typeof(b->'citation_indexes') IS DISTINCT FROM 'array'
       OR jsonb_array_length(b->'citation_indexes') = 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_bound_events) AS b
    CROSS JOIN LATERAL jsonb_array_elements(b->'citation_indexes') AS c
    WHERE jsonb_typeof(c->'citation_id') IS DISTINCT FROM 'string' OR btrim(c->>'citation_id') = ''
       OR jsonb_typeof(c->'source_doc_id') IS DISTINCT FROM 'string' OR btrim(c->>'source_doc_id') = ''
       OR jsonb_typeof(c->'index_revision') IS DISTINCT FROM 'string' OR btrim(c->>'index_revision') = ''
  ) THEN
    RAISE EXCEPTION 'Every event requires a complete citation index binding' USING ERRCODE = '23514';
  END IF;

  INSERT INTO cartography.change_branches (epoch_id, branch_name, base_revision_id)
  VALUES (p_epoch_id, p_branch_name, p_base_revision_id) ON CONFLICT (epoch_id, branch_name) DO NOTHING;
  SELECT base_revision_id INTO STRICT v_branch_revision FROM cartography.change_branches
  WHERE epoch_id = p_epoch_id AND branch_name = p_branch_name;
  IF v_branch_revision <> p_base_revision_id THEN
    RAISE EXCEPTION 'The change branch already has a different base revision' USING ERRCODE = '23514';
  END IF;

  INSERT INTO cartography.spatial_changesets
    (changeset_id, epoch_id, branch_name, author_type, author_id, request_sha256, review_issues)
  VALUES (p_id, p_epoch_id, p_branch_name, p_author_type, p_author_id, p_request_sha256, p_review_issues);

  INSERT INTO cartography.changeset_event_bindings (changeset_id, hist_event_id, event_revision, citation_indexes)
  SELECT p_id, b.hist_event_id, b.event_revision, b.citation_indexes
  FROM jsonb_to_recordset(p_bound_events) AS b(hist_event_id text, event_revision text, citation_indexes jsonb);

  RETURN cartography.read_open_changeset(p_id, p_request_sha256);
END;
$$;
