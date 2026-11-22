import type {
  AdminEvolutionRecord,
  AdminUnit,
  EvidenceCitation,
  HistoricalEvent,
  HistoricalToponym,
  MapSnapshot,
  SharedBoundaryArc,
  SourceDocument,
  SpatialChangeSet,
  TerritorialFace,
} from "@historical-cartography/shared-schema";
import type { FeatureCollection, LineString, Polygon } from "geojson";

export interface PolityMetadata {
  polity_id: string;
  name_zh: string;
  name_original_script?: string;
  parent_polity_id?: string;
  preferred_hex: string;
  monarch_name: string;
  era_label: string;
  capital_toponym_id?: string;
  emblem_symbol?: string;
  summary: string;
}

export interface FigurePortraitStyle {
  bg_hex: string;
  cloak_hex: string;
  skin_hex: string;
  crown_type: "turban" | "crown" | "helmet" | "hat";
  beard?: boolean;
}

export interface HistoricalFigure {
  figure_id: string;
  name_zh: string;
  title: string;
  polity_id: string;
  active_from_jdn: number;
  active_to_jdn: number;
  coordinates?: [number, number];
  portrait_monogram: string;
  accent_hex: string;
  portrait_style?: FigurePortraitStyle;
  route_points?: [number, number][];
  summary: string;
}

export interface PaleoGeoOverlay {
  feature_id: string;
  epoch_id: string;
  feature_type: "PALEO_RIVER" | "PALEO_COASTLINE" | "SILK_ROAD" | "ETHNIC_TRIBE" | "MODERN_PROVINCE" | "POPULATION_HUB";
  label_zh: string;
  geometry: LineString | Polygon;
  is_historical_override: boolean;
  source_note: string;
}

export interface MarchingRoute {
  route_id: string;
  hist_event_id: string;
  label_zh: string;
  coordinates: [number, number][];
  battle_point?: [number, number];
  color_hex: string;
}

export interface DiffComparisonRecord {
  changeset: SpatialChangeSet;
  summary_zh: string;
  before_snapshot: MapSnapshot;
  after_snapshot: MapSnapshot;
  affected_arc_ids: string[];
  affected_toponym_ids: string[];
}

export interface DynastyEraBand {
  band_id: string;
  label_zh: string;
  era_note: string;
  polity_id: string;
  valid_from_jdn: number;
  valid_to_jdn: number;
  focus_jdn: number;
  parallel_eras?: Array<{ polity_zh: string; era_text: string }>;
  color_hex: string;
}

export interface WaterBodyLabel {
  id: string;
  name_zh: string;
  coordinates: [number, number];
  kind: "SEA" | "LAKE";
}

export interface EpochSceneBundle {
  epoch: MapSnapshot["epoch"];
  epoch_label_zh: string;
  historical_year_display: string;
  calendar_era_note: string;
  revision_id: string;
  data_status: MapSnapshot["data_status"];
  is_demo_fixture: boolean;
  recommended_style_id?: string;
  recommended_hud_types?: string[];
  subtitle_default?: string;
  chronicle_notes?: { heading: string; paragraphs: string[] };
  coalition_sides?: Array<{
    title_zh: string;
    title_en: string;
    accent_hex: string;
    swatch_ramp?: string[];
    members: Array<{
      name_zh: string;
      name_orig: string;
      commander?: string;
      emblem?: string;
      portrait_style?: FigurePortraitStyle;
    }>;
  }>;
  superseded_modern_rivers?: string[];
  water_labels?: WaterBodyLabel[];
  canonical_arcs: SharedBoundaryArc[];
  canonical_faces: TerritorialFace[];
  snapshot: MapSnapshot;
  admin_units: AdminUnit[];
  admin_evolutions: AdminEvolutionRecord[];
  toponyms: HistoricalToponym[];
  events: HistoricalEvent[];
  sources: SourceDocument[];
  citations_by_id: Record<string, EvidenceCitation>;
  figures: HistoricalFigure[];
  paleo_overlays: PaleoGeoOverlay[];
  marching_routes: MarchingRoute[];
  polities: PolityMetadata[];
  diff_record?: DiffComparisonRecord;
  default_camera: {
    center: [number, number];
    zoom: number;
  };
  modern_reference_overlay: FeatureCollection<LineString>;
}
