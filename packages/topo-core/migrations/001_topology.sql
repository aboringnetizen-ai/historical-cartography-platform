CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

CREATE SCHEMA cartography;

CREATE TYPE cartography.julian_interval AS RANGE (
  subtype = double precision,
  subtype_diff = float8mi
);

CREATE TABLE cartography.epochs (
  epoch_id text PRIMARY KEY CHECK (btrim(epoch_id) <> ''),
  valid_from_jdn double precision NOT NULL,
  valid_to_jdn double precision NOT NULL,
  CHECK (
    valid_from_jdn > '-Infinity'::double precision
    AND valid_to_jdn < 'Infinity'::double precision
    AND valid_from_jdn < valid_to_jdn
  ),
  EXCLUDE USING gist (
    cartography.julian_interval(valid_from_jdn, valid_to_jdn, '[)') WITH &&
  )
);

CREATE TABLE cartography.topology_revisions (
  revision_id uuid PRIMARY KEY,
  epoch_id text NOT NULL REFERENCES cartography.epochs,
  topology_name name UNIQUE NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX topology_revisions_epoch ON cartography.topology_revisions (epoch_id);

CREATE TABLE cartography.face_labels (
  revision_id uuid NOT NULL REFERENCES cartography.topology_revisions,
  postgis_face_id bigint NOT NULL CHECK (postgis_face_id > 0),
  face_id text NOT NULL CHECK (btrim(face_id) <> ''),
  polity_id text CHECK (btrim(polity_id) <> ''),
  control_score double precision NOT NULL CHECK (control_score BETWEEN 0 AND 100),
  zone_semantics text NOT NULL
    CHECK (zone_semantics IN ('POLITY_TERRITORY', 'BUFFER_ZONE', 'DISPUTED_OVERLAP')),
  PRIMARY KEY (revision_id, postgis_face_id),
  UNIQUE (revision_id, face_id)
);

CREATE FUNCTION cartography.read_linework(p_items jsonb)
RETURNS geometry
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog, public
AS $$
DECLARE
  item jsonb;
  line geometry;
  lines geometry[] := ARRAY[]::geometry[];
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Expected a nonempty array of boundary LineStrings' USING ERRCODE = '22023';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    line := ST_GeomFromGeoJSON(item);
    IF line IS NULL OR ST_GeometryType(line) <> 'ST_LineString'
        OR ST_SRID(line) <> 4326 OR ST_NDims(line) <> 2
        OR NOT ST_IsValid(line) OR NOT ST_IsSimple(line)
        OR NOT ST_CoveredBy(line, ST_MakeEnvelope(-180, -90, 180, 90, 4326)) THEN
      RAISE EXCEPTION 'Expected valid, simple, 2D WGS84 boundary LineStrings' USING ERRCODE = '22023';
    END IF;
    lines := array_append(lines, line);
  END LOOP;

  RETURN ST_Collect(lines);
END;
$$;

CREATE FUNCTION cartography.build_draft_topology(
  p_revision_id uuid,
  p_epoch_id text,
  p_from_jdn double precision,
  p_to_jdn double precision,
  p_coverage_boundaries jsonb,
  p_internal_boundaries jsonb,
  p_faces jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, public, topology
AS $$
DECLARE
  v_topology varchar := 'carto_' || replace(p_revision_id::text, '-', '');
  v_epoch cartography.epochs%ROWTYPE;
  v_outer_lines geometry;
  v_all_lines geometry;
  v_cover geometry;
  v_actual geometry;
  v_face geometry;
  v_seed geometry;
  v_numeric_face_id bigint;
  v_face_count bigint;
  v_dangling_edges bigint;
  v_topology_error text;
  v_label jsonb;
BEGIN
  IF p_coverage_boundaries IS NULL OR p_internal_boundaries IS NULL OR p_faces IS NULL
      OR jsonb_typeof(p_internal_boundaries) <> 'array' OR jsonb_typeof(p_faces) <> 'array'
      OR jsonb_array_length(p_faces) = 0 THEN
    RAISE EXCEPTION 'Expected boundary arrays and at least one face seed' USING ERRCODE = '22023';
  END IF;

  v_outer_lines := ST_UnaryUnion(cartography.read_linework(p_coverage_boundaries));
  v_cover := ST_BuildArea(v_outer_lines);
  IF v_cover IS NULL OR ST_IsEmpty(v_cover) OR NOT ST_IsValid(v_cover)
      OR NOT ST_Equals(v_outer_lines, ST_Boundary(v_cover)) THEN
    RAISE EXCEPTION 'Coverage linework must enclose the complete study area' USING ERRCODE = '22023';
  END IF;
  v_all_lines := v_outer_lines;
  IF jsonb_array_length(p_internal_boundaries) > 0 THEN
    v_all_lines := ST_CollectionExtract(
      ST_Collect(v_outer_lines, cartography.read_linework(p_internal_boundaries)), 2
    );
  END IF;

  INSERT INTO cartography.epochs VALUES (p_epoch_id, p_from_jdn, p_to_jdn)
  ON CONFLICT (epoch_id) DO NOTHING;
  SELECT * INTO STRICT v_epoch FROM cartography.epochs WHERE epoch_id = p_epoch_id;
  IF v_epoch.valid_from_jdn <> p_from_jdn OR v_epoch.valid_to_jdn <> p_to_jdn THEN
    RAISE EXCEPTION 'Epoch interval is immutable for %', p_epoch_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO cartography.topology_revisions (revision_id, epoch_id, topology_name)
  VALUES (p_revision_id, p_epoch_id, v_topology);
  PERFORM topology.CreateTopology(v_topology::name, 4326, 0);
  PERFORM topology.TopoGeo_LoadGeometry(v_topology, v_all_lines, 0);

  SELECT string_agg(format('%s (%s, %s)', e.error, e.id1, e.id2), '; ')
  INTO v_topology_error
  FROM topology.ValidateTopology(v_topology) AS e;
  IF v_topology_error IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid topology in revision %: %', p_revision_id, v_topology_error
      USING ERRCODE = '23514';
  END IF;

  EXECUTE format('SELECT count(*) FROM %I.edge_data WHERE left_face = right_face', v_topology)
  INTO v_dangling_edges;
  IF v_dangling_edges > 0 THEN
    RAISE EXCEPTION 'Boundary contains edges that do not separate two faces' USING ERRCODE = '23514';
  END IF;

  FOR v_label IN SELECT value FROM jsonb_array_elements(p_faces) LOOP
    v_seed := ST_GeomFromGeoJSON(v_label->'seed');
    IF v_seed IS NULL OR ST_IsEmpty(v_seed) OR ST_GeometryType(v_seed) <> 'ST_Point'
        OR ST_SRID(v_seed) <> 4326 OR ST_NDims(v_seed) <> 2
        OR NOT ST_Contains(v_cover, v_seed) THEN
      RAISE EXCEPTION 'Face % needs an interior WGS84 point', v_label->>'face_id' USING ERRCODE = '22023';
    END IF;
    v_numeric_face_id := topology.GetFaceByPoint(v_topology, v_seed, 0);
    IF v_numeric_face_id IS NULL OR v_numeric_face_id = 0 THEN
      RAISE EXCEPTION 'Face seed % does not identify a bounded face', v_label->>'face_id'
        USING ERRCODE = '23514';
    END IF;
    v_face := topology.ST_GetFaceGeometry(v_topology, v_numeric_face_id);
    IF NOT ST_Contains(v_face, v_seed) THEN
      RAISE EXCEPTION 'Face seed % lies on a shared boundary', v_label->>'face_id' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_label->'control_score') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Face % requires a numeric control score', v_label->>'face_id' USING ERRCODE = '22023';
    END IF;
    INSERT INTO cartography.face_labels
      (revision_id, postgis_face_id, face_id, polity_id, control_score, zone_semantics)
    VALUES
      (p_revision_id, v_numeric_face_id, v_label->>'face_id', v_label->>'polity_id',
       (v_label->>'control_score')::double precision, v_label->>'zone_semantics');
  END LOOP;

  -- An intentional hole in the study mask can be a bounded native face.
  -- Actual mapped faces must exactly cover the mask; labels outside it are forbidden.
  SELECT ST_Union(topology.ST_GetFaceGeometry(v_topology, l.postgis_face_id))
  INTO v_actual
  FROM cartography.face_labels AS l
  WHERE l.revision_id = p_revision_id;
  IF NOT ST_Equals(v_actual, v_cover) THEN
    RAISE EXCEPTION 'Labeled topology faces do not exactly cover the study area' USING ERRCODE = '23514';
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM %I.face AS f
     WHERE f.face_id > 0
       AND ST_Area(ST_Intersection(topology.ST_GetFaceGeometry($1, f.face_id), $2)) > 0',
    v_topology
  )
  INTO v_face_count USING v_topology, v_cover;
  IF v_face_count <> jsonb_array_length(p_faces) THEN
    RAISE EXCEPTION 'Every bounded face in the study area must have exactly one label'
      USING ERRCODE = '23514';
  END IF;

  RETURN p_revision_id;
END;
$$;

CREATE FUNCTION cartography.read_map_snapshot(p_revision_id uuid, p_historical_jdn double precision)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public, topology
AS $$
DECLARE
  v_topology varchar;
  v_epoch cartography.epochs%ROWTYPE;
  v_faces jsonb;
  v_edges jsonb;
  v_prefix text := p_revision_id::text || ':';
BEGIN
  SELECT r.topology_name, e.epoch_id, e.valid_from_jdn, e.valid_to_jdn
  INTO v_topology, v_epoch.epoch_id, v_epoch.valid_from_jdn, v_epoch.valid_to_jdn
  FROM cartography.topology_revisions AS r JOIN cartography.epochs AS e USING (epoch_id)
  WHERE r.revision_id = p_revision_id
    AND p_historical_jdn >= e.valid_from_jdn AND p_historical_jdn < e.valid_to_jdn;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'id', l.face_id,
    'geometry', ST_AsGeoJSON(ST_ForcePolygonCCW(topology.ST_GetFaceGeometry(v_topology, l.postgis_face_id)), 15)::jsonb,
    'properties', jsonb_strip_nulls(jsonb_build_object(
      'face_id', l.face_id,
      'polity_id', l.polity_id,
      'control_score', l.control_score,
      'zone_semantics', l.zone_semantics,
      'boundary_arc_ids', (
        SELECT jsonb_agg(v_prefix || 'arc:' || abs(e.edge) ORDER BY e.sequence)
        FROM topology.ST_GetFaceEdges(v_topology, l.postgis_face_id) AS e
      )
    ))
  ) ORDER BY l.face_id), '[]'::jsonb)
  INTO v_faces
  FROM cartography.face_labels AS l WHERE l.revision_id = p_revision_id;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(jsonb_build_object(
      ''type'', ''Feature'',
      ''id'', $2 || ''arc:'' || e.edge_id,
      ''geometry'', ST_AsGeoJSON(e.geom, 15)::jsonb,
      ''properties'', jsonb_build_object(
        ''arc_id'', $2 || ''arc:'' || e.edge_id,
        ''start_node_id'', $2 || ''node:'' || e.start_node,
        ''end_node_id'', $2 || ''node:'' || e.end_node,
        ''left_face_id'', l.face_id,
        ''right_face_id'', r.face_id
      )
    ) ORDER BY e.edge_id), ''[]''::jsonb)
    FROM %I.edge_data AS e
    LEFT JOIN cartography.face_labels AS l ON l.revision_id = $1 AND l.postgis_face_id = e.left_face
    LEFT JOIN cartography.face_labels AS r ON r.revision_id = $1 AND r.postgis_face_id = e.right_face
    WHERE l.face_id IS NOT NULL OR r.face_id IS NOT NULL',
    v_topology
  )
  INTO v_edges USING p_revision_id, v_prefix;

  RETURN jsonb_build_object(
    'revision_id', p_revision_id,
    'data_status', 'DRAFT',
    'epoch', to_jsonb(v_epoch),
    'territories', jsonb_build_object('type', 'FeatureCollection', 'features', v_faces),
    'boundaries', jsonb_build_object('type', 'FeatureCollection', 'features', v_edges)
  );
END;
$$;
