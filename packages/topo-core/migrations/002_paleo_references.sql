CREATE TABLE cartography.paleo_line_references (
  epoch_id text NOT NULL REFERENCES cartography.epochs,
  feature_id text NOT NULL CHECK (btrim(feature_id) <> ''),
  source_doc_id text NOT NULL CHECK (btrim(source_doc_id) <> ''),
  feature_kind text NOT NULL CHECK (feature_kind IN ('RIVER', 'COASTLINE', 'LAKE')),
  geom geometry(LineString, 4326) NOT NULL,
  PRIMARY KEY (epoch_id, feature_id)
);

ALTER TABLE cartography.topology_revisions
  ADD UNIQUE (revision_id, epoch_id);

CREATE TABLE cartography.paleo_arc_bindings (
  revision_id uuid NOT NULL,
  epoch_id text NOT NULL,
  edge_id bigint NOT NULL CHECK (edge_id > 0),
  feature_id text NOT NULL,
  PRIMARY KEY (revision_id, edge_id),
  FOREIGN KEY (revision_id, epoch_id) REFERENCES cartography.topology_revisions (revision_id, epoch_id),
  FOREIGN KEY (epoch_id, feature_id) REFERENCES cartography.paleo_line_references (epoch_id, feature_id)
);

CREATE FUNCTION cartography.register_paleo_reference(
  p_epoch_id text,
  p_from_jdn double precision,
  p_to_jdn double precision,
  p_feature_id text,
  p_source_doc_id text,
  p_feature_kind text,
  p_geometry jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_epoch cartography.epochs%ROWTYPE;
  v_line geometry;
  v_registered cartography.paleo_line_references%ROWTYPE;
BEGIN
  v_line := ST_GeometryN(cartography.read_linework(jsonb_build_array(p_geometry)), 1);
  INSERT INTO cartography.epochs VALUES (p_epoch_id, p_from_jdn, p_to_jdn)
  ON CONFLICT (epoch_id) DO NOTHING;
  SELECT * INTO STRICT v_epoch FROM cartography.epochs WHERE epoch_id = p_epoch_id;
  IF v_epoch.valid_from_jdn <> p_from_jdn OR v_epoch.valid_to_jdn <> p_to_jdn THEN
    RAISE EXCEPTION 'Epoch interval is immutable for %', p_epoch_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO cartography.paleo_line_references (epoch_id, feature_id, source_doc_id, feature_kind, geom)
  VALUES (p_epoch_id, p_feature_id, p_source_doc_id, p_feature_kind, v_line)
  ON CONFLICT (epoch_id, feature_id) DO NOTHING;
  SELECT * INTO STRICT v_registered FROM cartography.paleo_line_references
  WHERE epoch_id = p_epoch_id AND feature_id = p_feature_id;
  IF v_registered.source_doc_id <> p_source_doc_id OR v_registered.feature_kind <> p_feature_kind
      OR ST_AsEWKB(v_registered.geom) <> ST_AsEWKB(v_line) THEN
    RAISE EXCEPTION 'Paleogeography source % is immutable in epoch %', p_feature_id, p_epoch_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION cartography.build_draft_with_paleo(
  p_revision_id uuid,
  p_epoch_id text,
  p_from_jdn double precision,
  p_to_jdn double precision,
  p_coverage_boundaries jsonb,
  p_internal_boundaries jsonb,
  p_faces jsonb,
  p_feature_ids text[]
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, public, topology
AS $$
DECLARE
  v_topology name;
  v_feature_id text;
  v_reference geometry;
  v_boundary jsonb;
  v_paleo_lines jsonb := '[]'::jsonb;
  v_matched geometry;
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(p_feature_ids) AS ids(id)
             GROUP BY id HAVING id IS NULL OR count(*) > 1) THEN
    RAISE EXCEPTION 'Paleogeography references must be nonnull and unique' USING ERRCODE = '22023';
  END IF;

  FOREACH v_feature_id IN ARRAY p_feature_ids LOOP
    SELECT geom INTO v_reference FROM cartography.paleo_line_references
    WHERE epoch_id = p_epoch_id AND feature_id = v_feature_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Paleogeography feature % is unavailable in epoch %', v_feature_id, p_epoch_id
        USING ERRCODE = '23514';
    END IF;
    SELECT jsonb_build_object('type', 'LineString', 'coordinates',
      jsonb_agg(jsonb_build_array(ST_X(p.geom), ST_Y(p.geom)) ORDER BY p.path))
    INTO v_boundary FROM ST_DumpPoints(v_reference) AS p;
    v_paleo_lines := v_paleo_lines || jsonb_build_array(v_boundary);
  END LOOP;

  PERFORM cartography.build_draft_topology(
    p_revision_id, p_epoch_id, p_from_jdn, p_to_jdn, p_coverage_boundaries,
    p_internal_boundaries || v_paleo_lines, p_faces
  );
  SELECT topology_name INTO STRICT v_topology FROM cartography.topology_revisions
  WHERE revision_id = p_revision_id;

  FOREACH v_feature_id IN ARRAY p_feature_ids LOOP
    SELECT geom INTO STRICT v_reference FROM cartography.paleo_line_references
    WHERE epoch_id = p_epoch_id AND feature_id = v_feature_id;
    EXECUTE format(
      'WITH bound AS (
        INSERT INTO cartography.paleo_arc_bindings (revision_id, epoch_id, edge_id, feature_id)
        SELECT $1, $2, e.edge_id, $3
        FROM %1$I.edge_data AS e
        WHERE ST_CoveredBy(e.geom, $4)
        RETURNING edge_id
      )
      SELECT ST_Union(e.geom) FROM %1$I.edge_data AS e JOIN bound USING (edge_id)',
      v_topology
    )
    INTO v_matched USING p_revision_id, p_epoch_id, v_feature_id, v_reference;
    IF v_matched IS NULL OR NOT ST_Equals(v_matched, v_reference)
        OR ST_HausdorffDistance(v_matched, v_reference) <> 0 THEN
      RAISE EXCEPTION 'Paleogeography feature % does not match its boundary edges exactly', v_feature_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN p_revision_id;
END;
$$;
