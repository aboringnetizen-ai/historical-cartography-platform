CREATE TABLE cartography.draft_face_locks (
  epoch_id text NOT NULL REFERENCES cartography.epochs,
  face_id text NOT NULL CHECK (btrim(face_id) <> ''),
  PRIMARY KEY (epoch_id, face_id)
);

CREATE TABLE cartography.draft_heads (
  changeset_id uuid PRIMARY KEY REFERENCES cartography.spatial_changesets,
  revision_id uuid NOT NULL REFERENCES cartography.topology_revisions
);

CREATE TABLE cartography.unit_reassignments (
  operation_id uuid PRIMARY KEY,
  sequence_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  changeset_id uuid NOT NULL REFERENCES cartography.spatial_changesets,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  previous_revision_id uuid NOT NULL REFERENCES cartography.topology_revisions,
  revision_id uuid NOT NULL UNIQUE REFERENCES cartography.topology_revisions,
  moved_face_ids text[] NOT NULL CHECK (cardinality(moved_face_ids) > 0),
  affected_arc_ids text[] NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  rolled_back_at timestamptz,
  UNIQUE (operation_id, changeset_id)
);

CREATE INDEX unit_reassignments_by_changeset ON cartography.unit_reassignments (changeset_id);

CREATE TABLE cartography.unit_reassignment_events (
  operation_id uuid NOT NULL,
  changeset_id uuid NOT NULL,
  hist_event_id text NOT NULL,
  PRIMARY KEY (operation_id, hist_event_id),
  FOREIGN KEY (operation_id, changeset_id) REFERENCES cartography.unit_reassignments (operation_id, changeset_id),
  FOREIGN KEY (changeset_id, hist_event_id) REFERENCES cartography.changeset_event_bindings
);

CREATE FUNCTION cartography.read_unit_reassignment(p_operation_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'operation_id', r.operation_id, 'changeset_id', r.changeset_id,
    'previous_revision_id', r.previous_revision_id, 'revision_id', r.revision_id,
    'moved_face_ids', r.moved_face_ids, 'affected_arc_ids', r.affected_arc_ids,
    'driven_by_event_ids', (
      SELECT jsonb_agg(e.hist_event_id ORDER BY e.hist_event_id)
      FROM cartography.unit_reassignment_events AS e WHERE e.operation_id = r.operation_id
    ),
    'status', CASE WHEN r.rolled_back_at IS NULL THEN 'APPLIED' ELSE 'ROLLED_BACK' END
  )
  FROM cartography.unit_reassignments AS r WHERE r.operation_id = p_operation_id;
$$;

CREATE FUNCTION cartography.reassign_draft_units(
  p_changeset_id uuid, p_operation_id uuid, p_expected_revision_id uuid, p_new_revision_id uuid,
  p_request_sha256 text, p_assignments jsonb, p_event_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, topology
AS $$
DECLARE
  v_changeset cartography.spatial_changesets%ROWTYPE;
  v_existing cartography.unit_reassignments%ROWTYPE;
  v_old_topology varchar;
  v_new_topology varchar := 'carto_' || replace(p_new_revision_id::text, '-', '');
  v_head uuid;
  v_faces text[];
  v_arcs text[];
  v_locked text;
BEGIN
  SELECT * INTO STRICT v_changeset FROM cartography.spatial_changesets
  WHERE changeset_id = p_changeset_id FOR UPDATE;
  SELECT * INTO v_existing FROM cartography.unit_reassignments WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.changeset_id <> p_changeset_id OR v_existing.request_sha256 <> p_request_sha256 THEN
      RAISE EXCEPTION 'Operation ID already belongs to a different request' USING ERRCODE = '22023';
    END IF;
    RETURN cartography.read_unit_reassignment(p_operation_id);
  END IF;

  SELECT coalesce(h.revision_id, b.base_revision_id) INTO STRICT v_head
  FROM cartography.change_branches AS b
  LEFT JOIN cartography.draft_heads AS h ON h.changeset_id = p_changeset_id
  WHERE b.epoch_id = v_changeset.epoch_id AND b.branch_name = v_changeset.branch_name;
  IF v_head IS DISTINCT FROM p_expected_revision_id THEN
    RAISE EXCEPTION 'Draft revision has changed; reload the active head' USING ERRCODE = '40001';
  END IF;
  IF p_event_ids IS NULL OR cardinality(p_event_ids) = 0 OR EXISTS (
    SELECT 1 FROM unnest(p_event_ids) AS requested(id) GROUP BY id HAVING id IS NULL OR count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_event_ids) AS requested(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM cartography.changeset_event_bindings AS b
      WHERE b.changeset_id = p_changeset_id AND b.hist_event_id = requested.id
    )
  ) THEN
    RAISE EXCEPTION 'Every operation event must be bound to the ChangeSet' USING ERRCODE = '23514';
  END IF;

  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' OR jsonb_array_length(p_assignments) = 0 THEN
    RAISE EXCEPTION 'At least one unit assignment is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) AS a
    WHERE jsonb_typeof(a->'face_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(a->'control_score') IS DISTINCT FROM 'number'
       OR (a->>'control_score')::double precision NOT BETWEEN 0 AND 100
       OR NOT coalesce(jsonb_typeof(a->'polity_id') IN ('null', 'string'), false)
       OR btrim(a->>'polity_id') = ''
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) AS a GROUP BY a->>'face_id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invalid or duplicate unit assignment' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) AS a
    WHERE NOT EXISTS (
      SELECT 1 FROM cartography.face_labels AS f WHERE f.revision_id = v_head AND f.face_id = a->>'face_id'
    )
  ) THEN
    RAISE EXCEPTION 'Unit is not part of the expected draft revision' USING ERRCODE = '23514';
  END IF;
  SELECT array_agg(f.face_id ORDER BY f.face_id) INTO v_faces
  FROM cartography.face_labels AS f JOIN jsonb_to_recordset(p_assignments) AS a(
    face_id text, polity_id text, control_score double precision
  ) USING (face_id)
  WHERE f.revision_id = v_head
    AND (f.polity_id IS DISTINCT FROM a.polity_id OR f.control_score IS DISTINCT FROM a.control_score);
  IF v_faces IS NULL THEN
    RAISE EXCEPTION 'Assignments do not change the draft revision' USING ERRCODE = '22023';
  END IF;
  -- Serialize lock registration against this epoch during a draft edit.
  PERFORM 1 FROM cartography.epochs WHERE epoch_id = v_changeset.epoch_id FOR SHARE;
  SELECT face_id INTO v_locked FROM cartography.draft_face_locks
  WHERE epoch_id = v_changeset.epoch_id AND face_id = ANY (v_faces) ORDER BY face_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'A human lock protects this unit' USING ERRCODE = '23514',
      CONSTRAINT = 'draft_face_human_lock', DETAIL = v_locked;
  END IF;

  SELECT topology_name INTO STRICT v_old_topology FROM cartography.topology_revisions WHERE revision_id = v_head;
  INSERT INTO cartography.topology_revisions (revision_id, epoch_id, topology_name)
  VALUES (p_new_revision_id, v_changeset.epoch_id, v_new_topology);
  PERFORM topology.CopyTopology(v_old_topology, v_new_topology);
  INSERT INTO cartography.face_labels
    (revision_id, postgis_face_id, face_id, polity_id, control_score, zone_semantics)
  SELECT p_new_revision_id, f.postgis_face_id, f.face_id,
    CASE WHEN a.face_id IS NULL THEN f.polity_id ELSE a.polity_id END,
    coalesce(a.control_score, f.control_score), f.zone_semantics
  FROM cartography.face_labels AS f LEFT JOIN jsonb_to_recordset(p_assignments) AS a(
    face_id text, polity_id text, control_score double precision
  ) USING (face_id)
  WHERE f.revision_id = v_head;
  INSERT INTO cartography.paleo_arc_bindings (revision_id, epoch_id, edge_id, feature_id)
  SELECT p_new_revision_id, epoch_id, edge_id, feature_id FROM cartography.paleo_arc_bindings WHERE revision_id = v_head;
  INSERT INTO cartography.revision_landmark_inventories (revision_id, anchors)
  SELECT p_new_revision_id, anchors FROM cartography.revision_landmark_inventories WHERE revision_id = v_head;

  EXECUTE format($query$
    SELECT array_agg($1::uuid::text || ':arc:' || e.edge_id ORDER BY e.edge_id)
    FROM %I.edge_data AS e WHERE EXISTS (
      SELECT 1 FROM cartography.face_labels AS f
      WHERE f.revision_id = $1 AND f.face_id = ANY ($2)
        AND f.postgis_face_id IN (e.left_face, e.right_face)
    )
  $query$, v_new_topology)
  INTO v_arcs USING p_new_revision_id, v_faces;

  INSERT INTO cartography.unit_reassignments
    (operation_id, changeset_id, request_sha256, previous_revision_id, revision_id, moved_face_ids, affected_arc_ids)
  VALUES (p_operation_id, p_changeset_id, p_request_sha256, v_head, p_new_revision_id, v_faces, v_arcs);
  INSERT INTO cartography.unit_reassignment_events (operation_id, changeset_id, hist_event_id)
  SELECT p_operation_id, p_changeset_id, id FROM unnest(p_event_ids) AS events(id);
  INSERT INTO cartography.draft_heads (changeset_id, revision_id) VALUES (p_changeset_id, p_new_revision_id)
  ON CONFLICT (changeset_id) DO UPDATE SET revision_id = EXCLUDED.revision_id;
  RETURN cartography.read_unit_reassignment(p_operation_id);
END;
$$;

CREATE FUNCTION cartography.rollback_draft_reassignment(p_changeset_id uuid, p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_operation cartography.unit_reassignments%ROWTYPE;
  v_head uuid;
BEGIN
  PERFORM 1 FROM cartography.spatial_changesets WHERE changeset_id = p_changeset_id FOR UPDATE;
  SELECT * INTO STRICT v_operation FROM cartography.unit_reassignments
  WHERE changeset_id = p_changeset_id AND operation_id = p_operation_id;
  IF v_operation.rolled_back_at IS NOT NULL THEN RETURN cartography.read_unit_reassignment(p_operation_id); END IF;
  SELECT revision_id INTO STRICT v_head FROM cartography.draft_heads WHERE changeset_id = p_changeset_id;
  IF v_head <> v_operation.revision_id THEN
    RAISE EXCEPTION 'Only the active draft operation can be rolled back' USING ERRCODE = '40001';
  END IF;
  UPDATE cartography.draft_heads SET revision_id = v_operation.previous_revision_id WHERE changeset_id = p_changeset_id;
  UPDATE cartography.unit_reassignments SET rolled_back_at = transaction_timestamp() WHERE operation_id = p_operation_id;
  RETURN cartography.read_unit_reassignment(p_operation_id);
END;
$$;

CREATE FUNCTION cartography.register_draft_face_lock(p_revision_id uuid, p_face_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_epoch text;
BEGIN
  SELECT r.epoch_id INTO STRICT v_epoch FROM cartography.topology_revisions AS r
  JOIN cartography.face_labels AS f USING (revision_id)
  WHERE r.revision_id = p_revision_id AND f.face_id = p_face_id;
  PERFORM 1 FROM cartography.epochs WHERE epoch_id = v_epoch FOR UPDATE;
  INSERT INTO cartography.draft_face_locks (epoch_id, face_id) VALUES (v_epoch, p_face_id) ON CONFLICT DO NOTHING;
END;
$$;
