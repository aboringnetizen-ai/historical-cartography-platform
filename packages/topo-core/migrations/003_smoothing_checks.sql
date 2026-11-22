CREATE TABLE cartography.revision_landmark_inventories (
  revision_id uuid PRIMARY KEY REFERENCES cartography.topology_revisions,
  anchors jsonb NOT NULL CHECK (jsonb_typeof(anchors) = 'array'),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE FUNCTION cartography.register_landmark_inventory(p_revision_id uuid, p_anchors jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ordered jsonb;
  v_existing jsonb;
BEGIN
  IF p_anchors IS NULL OR jsonb_typeof(p_anchors) <> 'array' THEN
    RAISE EXCEPTION 'Expected a complete landmark inventory array' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_anchors) AS a(
      toponym_id text, coordinates double precision[], valid_from_jdn double precision, valid_to_jdn double precision
    )
    WHERE a.toponym_id IS NULL OR btrim(a.toponym_id) = ''
      OR cardinality(a.coordinates) IS DISTINCT FROM 2
      OR (a.coordinates[1] BETWEEN -180 AND 180) IS NOT TRUE
      OR (a.coordinates[2] BETWEEN -90 AND 90) IS NOT TRUE
      OR (a.valid_from_jdn > '-Infinity'::double precision AND a.valid_to_jdn < 'Infinity'::double precision
         AND a.valid_from_jdn < a.valid_to_jdn) IS NOT TRUE
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_anchors) AS item
    GROUP BY item->>'toponym_id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invalid or duplicate landmark anchors' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY item->>'toponym_id'), '[]'::jsonb)
  INTO v_ordered FROM jsonb_array_elements(p_anchors) AS item;
  INSERT INTO cartography.revision_landmark_inventories (revision_id, anchors) VALUES (p_revision_id, v_ordered)
  ON CONFLICT (revision_id) DO NOTHING;
  SELECT anchors INTO STRICT v_existing FROM cartography.revision_landmark_inventories WHERE revision_id = p_revision_id;
  IF v_existing <> v_ordered THEN
    RAISE EXCEPTION 'Landmark inventory is immutable for revision %', p_revision_id USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION cartography.read_native_arc(p_revision_id uuid, p_jdn double precision, p_edge_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_topology name;
  v_result jsonb;
BEGIN
  SELECT r.topology_name INTO v_topology
  FROM cartography.topology_revisions AS r JOIN cartography.epochs AS e USING (epoch_id)
  WHERE r.revision_id = p_revision_id AND p_jdn >= e.valid_from_jdn AND p_jdn < e.valid_to_jdn;
  IF NOT FOUND THEN RETURN NULL; END IF;

  EXECUTE format($query$
    SELECT jsonb_build_object(
      'geometry', jsonb_build_object('type', 'LineString', 'coordinates',
        (SELECT jsonb_agg(jsonb_build_array(ST_X(p.geom), ST_Y(p.geom)) ORDER BY p.path)
         FROM ST_DumpPoints(edge.geom) AS p)
      ),
      'paleo', EXISTS (
        SELECT 1 FROM cartography.paleo_arc_bindings AS a WHERE a.revision_id = $1 AND a.edge_id = $2
      )
    )
    FROM %I.edge_data AS edge WHERE edge.edge_id = $2
  $query$, v_topology)
  INTO v_result USING p_revision_id, p_edge_id;
  RETURN v_result;
END;
$$;

CREATE FUNCTION cartography.check_draft_spline(p_revision_id uuid, p_edge_id bigint, p_candidate jsonb)
RETURNS TABLE(topology_error text, anchors_registered boolean, changed_toponym_ids text[])
LANGUAGE plpgsql
SET search_path = pg_catalog, public, topology
AS $$
DECLARE
  v_topology varchar;
  v_epoch cartography.epochs%ROWTYPE;
  v_scratch varchar := 'carto_spline_' || replace(gen_random_uuid()::text, '-', '');
  v_inventory jsonb;
  v_faces bigint[];
BEGIN
  SELECT r.topology_name, e.valid_from_jdn, e.valid_to_jdn
  INTO STRICT v_topology, v_epoch.valid_from_jdn, v_epoch.valid_to_jdn
  FROM cartography.topology_revisions AS r JOIN cartography.epochs AS e USING (epoch_id)
  WHERE r.revision_id = p_revision_id;
  SELECT anchors INTO v_inventory FROM cartography.revision_landmark_inventories WHERE revision_id = p_revision_id;
  anchors_registered := FOUND;
  changed_toponym_ids := ARRAY[]::text[];

  EXECUTE format('SELECT ARRAY[left_face, right_face]::bigint[] FROM %I.edge_data WHERE edge_id = $1', v_topology)
  INTO STRICT v_faces USING p_edge_id;
  PERFORM topology.CopyTopology(v_topology, v_scratch);
  BEGIN
    PERFORM topology.ST_ChangeEdgeGeom(v_scratch, p_edge_id, ST_GeomFromGeoJSON(p_candidate));
  EXCEPTION WHEN raise_exception OR invalid_parameter_value OR check_violation OR internal_error THEN
    IF SQLSTATE = 'XX000' AND SQLERRM NOT LIKE 'SQL/MM Spatial exception - %' THEN RAISE; END IF;
    topology_error := SQLERRM;
  END;
  IF topology_error IS NULL THEN
    SELECT string_agg(format('%s (%s, %s)', e.error, e.id1, e.id2), '; ')
    INTO topology_error FROM topology.ValidateTopology(v_scratch) AS e;
  END IF;

  IF topology_error IS NULL AND anchors_registered THEN
    WITH adjacent AS MATERIALIZED (
      SELECT topology.ST_GetFaceGeometry(v_topology, f.face_id) AS before,
             topology.ST_GetFaceGeometry(v_scratch, f.face_id) AS after
      FROM unnest(v_faces) AS f(face_id) WHERE f.face_id <> 0
    ), points AS (
      SELECT a.toponym_id, ST_SetSRID(ST_MakePoint(a.coordinates[1], a.coordinates[2]), 4326) AS point
      FROM jsonb_to_recordset(v_inventory) AS a(
        toponym_id text, coordinates double precision[], valid_from_jdn double precision, valid_to_jdn double precision
      )
      WHERE a.valid_from_jdn < v_epoch.valid_to_jdn AND a.valid_to_jdn > v_epoch.valid_from_jdn
    )
    SELECT coalesce(array_agg(p.toponym_id ORDER BY p.toponym_id), ARRAY[]::text[])
    INTO changed_toponym_ids
    FROM points AS p
    WHERE EXISTS (SELECT 1 FROM adjacent AS f WHERE ST_Covers(f.before, p.point) <> ST_Covers(f.after, p.point));
  END IF;

  PERFORM topology.DropTopology(v_scratch);
  RETURN NEXT;
END;
$$;
