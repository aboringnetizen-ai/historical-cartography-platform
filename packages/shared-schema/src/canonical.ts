import type * as GeoJSON from "geojson";

// ============================================================================
// 9.1 基础枚举与双纪年结构 (Core Enums & Historical Time)
// ============================================================================

export type CredibilityTier =
  | "T1_PRIMARY_AND_LOCAL_ACADEMIC"
  | "T2_SECONDARY_SCHOLARLY_OR_CURATED"
  | "T3_GENERAL_ENCYCLOPEDIA"
  | "REJECTED_UNVERIFIED";

export type SourceMedium =
  | "LOCAL_FILE"
  | "INTERNET_ARCHIVE"
  | "ACADEMIC_JOURNAL"
  | "WEB_REPORT"
  | "ENCYCLOPEDIA";

export type ControlSemanticTag =
  | "DIRECT_CORE"
  | "REGULAR_ADMIN"
  | "INDIRECT_JIMI"
  | "TRIBUTARY_VASSAL"
  | "LOOSE_OR_SPARSE_FRONTIER"
  | "DISPUTED_CONTESTED";

export type BoundaryCertainty =
  | "CERTAIN_EXACT"
  | "NATURAL_FEATURE"
  | "APPROXIMATE_FUZZY"
  | "DISPUTED_SCHOLARLY";

export type ZoneSemantics =
  | "POLITY_TERRITORY"
  | "BUFFER_ZONE"
  | "DISPUTED_OVERLAP";

export type AdminChangeType =
  | "ESTABLISHED"
  | "ABOLISHED"
  | "MERGED"
  | "SPLIT"
  | "RENAMED"
  | "SEAT_MOVED"
  | "JURISDICTION_CHANGED";

export type TimeGranularity = "CENTURY" | "DECADE" | "YEAR" | "MONTH" | "DAY" | "HOUR";

export interface HistoricalTimestamp {
  astronomical_year: number;          // 公元1年=1, 公元前1年=0, 公元前2年=-1（唯一计算与排序基准）
  month?: number;                     // 1-12
  day?: number;                       // 1-31
  hour?: number;                      // 0-23
  minute?: number;                    // 0-59
  julian_day_number: number;          // 连续儒略日数（用于跨公元前后毫秒/小时级精确插值与排序）
  uncertainty_days?: number;          // 不确定区间（±天数）
  historical_year_display: string;    // 展示用规范字符串（无公元0年，如 "公元前202年" / "公元928年"）
  calendar_era_note?: string;         // 原史料传统年号/历法（如 "清宣宗道光21年九月二十六"）
}

// ============================================================================
// 9.2 文献与细粒度来源定位 (Source & Granular Provenance)
// ============================================================================

export interface SourceDocument {
  source_doc_id: string;
  title: string;
  authors: string[];
  publication_year?: number;
  publisher_or_journal?: string;
  is_local_academic_journal: boolean;
  medium: SourceMedium;
  credibility_tier: CredibilityTier;
  language: string;
  local_path?: string;
  file_sha256?: string;
  source_url?: string;
  archive_snapshot_url?: string;
  fetched_at_iso?: string;
  ocr_engine?: "PADDLE_OCR" | "SURYA" | "MINERU" | "NATIVE_TEXT";
  ocr_indexed: boolean;
}

export interface EvidenceCitation {
  citation_id: string;
  source_doc_id: string;
  credibility_tier: Exclude<CredibilityTier, "REJECTED_UNVERIFIED">; // 类型层直接封杀黑名单
  volume_or_chapter?: string;
  page_number?: string;
  ocr_line_range?: [number, number];
  web_section_anchor?: string;
  verbatim_quote: string;             // 必填原文摘录，入库门禁强制在索引中校验真实存在
  quote_match_score?: number;         // 门禁自动回填的原文匹配度 (0.0 ~ 1.0)
  translation_or_note?: string;
  verified_by_human: boolean;
}

// ============================================================================
// 9.3 历史事件与事务变更集 (Event-Driven Mutation Contract)
// ============================================================================

export interface HistoricalEvent {
  hist_event_id: string;
  title: string;
  summary: string;
  event_category: "WAR_BATTLE" | "FOUNDING" | "TERRITORY_TRANSFER" | "ADMIN_REFORM" | "TREATY" | "OTHER";
  time_start: HistoricalTimestamp;
  time_end?: HistoricalTimestamp;
  involved_polity_ids: string[];
  involved_figure_ids: string[];
  involved_toponym_ids: string[];
  spatial_impact_description: string;
  citations: EvidenceCitation[];      // 长度 >= 1
  highest_credibility_tier: Exclude<CredibilityTier, "REJECTED_UNVERIFIED">;
  conflict_status: "CONSENSUS" | "T1_SCHOLARLY_DISPUTE" | "PENDING_T1_VERIFICATION";
}

export interface SpatialChangeSet {
  changeset_id: string;
  parent_changeset_id?: string;
  branch_name: string;
  epoch_id: string;                   // 所属平面拓扑切片纪元 ID
  author_type: "AI_AGENT" | "HUMAN_EDITOR";
  author_id: string;
  bound_event_ids: string[];          // 门禁强制长度 >= 1
  operations_log: Record<string, unknown>[];
  gate_report: {
    g1_topology_passed: boolean;
    g1_5_smoothness_passed: boolean;
    g2_event_binding_passed: boolean;
    g3_provenance_quote_passed: boolean;
    g4_human_lock_passed: boolean;
  };
  visual_diff_artifact_uri?: string;
  status: "DRAFT" | "PENDING_HUMAN_REVIEW" | "COMMITTED" | "ROLLED_BACK";
  created_at_iso: string;
}

// ============================================================================
// 9.4 双时态平面拓扑与可控平滑实体 (Bitemporal Topology & Smoothness)
// ============================================================================

export interface BoundarySmoothnessProfile {
  profile_id: string;
  mode: "CARTOGRAPHIC_NATURAL" | "TENSION_SPLINE_BOUNDED";
  simplify_area_ratio: number;        // 推荐 0.00005
  spline_tension: number;             // 0.45 ~ 0.65，默认 0.55
  max_hausdorff_deviation_km: number; // 默认 25 km 且 <= 0.8% 图幅宽
  target_fractal_dim_range: [number, number]; // 默认 [1.04, 1.22]
  min_micro_turn_angle_deg: number;   // 默认 135
  enforce_landmark_preservation: true;
}

export interface SharedBoundaryArc {
  arc_id: string;
  epoch_id: string;                   // 隔离跨时代平面拓扑域
  canonical_geometry: GeoJSON.LineString;        // 唯一可编辑考证骨架/自然吸附几何
  rendered_spline_geometry?: GeoJSON.LineString; // 只读派生平滑缓存，严禁反写回 canonical
  smoothness_profile_id: string;
  measured_fractal_dim?: number;
  measured_max_deviation_km?: number;
  start_node_id: string;
  end_node_id: string;
  left_face_id: string;
  right_face_id: string;
  snapped_paleo_feature_id?: string;  // 绑定带时代版本的古河道/古海岸线要素 ID
  certainty: BoundaryCertainty;
  valid_from_jdn: number;
  valid_to_jdn: number;
  driven_by_event_ids: string[];
  human_locked_override: boolean;
}

export interface TerritorialFace {
  face_id: string;
  epoch_id: string;
  boundary_arc_ids: string[];         // 有序闭合共享弧段引用
  zone_semantics: ZoneSemantics;
  polity_id?: string;                 // 纯疆域图层按此无缝融合同政权子面
  admin_unit_id?: string;
  control_score: number;              // 0 ~ 100 连续数值，越大控制力越强
  control_semantic_tag?: ControlSemanticTag;
  is_sparse_or_desert_zone?: boolean; // 仅标记自然属性，渲染时不强制挖空
  disputed_claimant_polity_ids?: string[];
  valid_from_jdn: number;
  valid_to_jdn: number;
  highest_credibility_tier: Exclude<CredibilityTier, "REJECTED_UNVERIFIED">;
  driven_by_event_ids: string[];
  human_locked_override: boolean;
}

// ============================================================================
// 9.5 行政区划、沿革与历史地名 (Admin Units, Evolution & Toponyms)
// ============================================================================

export interface AdminUnit {
  admin_unit_id: string;
  polity_id: string;
  name_historical: string;
  alt_names: string[];
  admin_level: 0 | 1 | 2 | 3;
  parent_admin_unit_id?: string;
  seat_toponym_id?: string;
  valid_from_jdn: number;
  valid_to_jdn: number;
  citations: EvidenceCitation[];
}

export interface AdminEvolutionRecord {
  evolution_id: string;
  change_type: AdminChangeType;
  timestamp: HistoricalTimestamp;
  source_admin_unit_ids: string[];
  target_admin_unit_ids: string[];
  hist_event_id: string;
  citations: EvidenceCitation[];
}

export interface HistoricalToponym {
  toponym_id: string;
  name_zh: string;
  name_original_script?: string;
  alt_names_and_transliterations: string[];
  modern_name?: string;
  coordinates: [number, number];      // [lon, lat] WGS84
  location_precision: "EXACT_SITE" | "APPROXIMATE_AREA" | "UNCERTAIN";
  entity_rank: "CAPITAL" | "MAJOR_CITY" | "PREFECTURE_SEAT" | "COUNTY_SEAT" | "PASS_FORT" | "NATURAL_FEATURE";
  valid_from_jdn: number;
  valid_to_jdn: number;
  label_priority: number;             // 1-100
  citations: EvidenceCitation[];
}

// ============================================================================
// 9.6 正交视觉风格、图层、底部时间轴与视频导播契约 (Style, Timeline & Video)
// ============================================================================

export type BasemapId =
  | "hypsometric_dem"
  | "swiss_relief_engraved"
  | "alabaster_clay_relief"
  | "satellite_natural"
  | "satellite_dark_mono"
  | "antique_parchment"
  | "modern_reference";

export type BorderShaderMode =
  | "crisp_outlined"
  | "inner_band_glow"
  | "watercolor_vignette"
  | "multi_tier_ink"
  | "occupation_hatch_frontline"
  | "spotlight_isolation";

export interface LayerVisibilityConfig {
  base_mode: "PURE_TERRITORY" | "CONTROL_INTENSITY";
  enabled_overlays: string[];
  control_intensity_render_mode?: "OPACITY_GRADIENT" | "COLOR_RAMP" | "CLOSED_ISOPLETH_CONTOURS";
  min_credibility_filter?: Exclude<CredibilityTier, "REJECTED_UNVERIFIED">;
}

export interface ComposableStylePack {
  style_id: string;
  display_name: string;
  extends_style_id?: string;
  basemap: {
    basemap_id: BasemapId;
    blend_mode: "normal" | "multiply" | "overlay" | "soft-light";
    desaturation: number;
    hillshade_exaggeration: number;
    show_graticule_grid: boolean;
    show_modern_overlay: boolean;
  };
  border_shader: {
    mode: BorderShaderMode;
    outer_stroke_hex: string;
    outer_stroke_width_px: number;
    inner_band_width_px?: number;
    inner_band_opacity?: number;
    hatch_angle_deg?: number;
    hatch_spacing_px?: number;
    admin_tier_widths_px?: [number, number, number];
  };
  territory_rendering: {
    pure_mode_fill_opacity: number;
    control_score_stops: Array<{
      score: number;                  // 0 ~ 100
      opacity: number;
      saturation_scale: number;
      contour_stroke_dasharray?: number[];
    }>;
  };
  color_palette_id: string;
  auto_four_color_solver: boolean;
  typography: {
    polity_font: string;
    city_font: string;
    curved_along_spine: boolean;
    letter_spacing_em: number;
    bilingual_mode: "NONE" | "STACKED" | "INLINE";
    show_uncertainty_question_mark: boolean;
    city_symbol_pack: "PILL_BADGE" | "BLUE_RING" | "ANTIQUE_DOUBLE_RING" | "YELLOW_SQUARE";
  };
  default_smoothness_profile: BoundarySmoothnessProfile;
  default_hud_preset_id?: string;
}

export interface DirectorKeyframe {
  keyframe_id: string;
  video_time_sec: number;
  historical_jdn: number;
  camera: { center: [number, number]; zoom: number; bearing_deg: number; pitch_deg: number };
  easing: "LINEAR" | "EASE_IN_OUT_CUBIC" | "CAMERA_FLY_TO";
  style_id?: string;
  layer_config?: LayerVisibilityConfig;
  enable_ghost_previous_border?: boolean;
  morph_transition_sec?: number;
  topology_change_fallback?: "OCCUPATION_RIPPLE" | "WIPE_MASK" | "CROSS_DISSOLVE";
}

export interface VideoExportJobSpec {
  project_id: string;
  aspect_ratio: "16:9" | "9:16" | "1:1" | "21:9";
  resolution: "1080p" | "1440p" | "4K";
  fps: 30 | 60;
  output_format: "MP4_H264" | "MP4_HEVC" | "WEBM_ALPHA" | "PRORES_4444" | "INTERACTIVE_WEB_BUNDLE";
  keyframes: DirectorKeyframe[];
  hud_widgets: Array<{
    widget_id: string;
    type:
      | "DATE_ERA_BADGE"
      | "FIGURE_PORTRAIT_PIN"
      | "COALITION_ROSTER_SIDEBAR"
      | "POLITY_DASHBOARD_PANEL"
      | "CHRONICLE_TEXT_OVERLAY"
      | "SUBTITLE_BAR"
      | "PIP_INSET_MAP";
    anchor: "TOP_LEFT" | "TOP_RIGHT" | "BOTTOM_CENTER" | "LEFT_SIDEBAR" | "RIGHT_SIDEBAR" | "MAP_COORDINATE";
    map_coordinates?: [number, number];
    visible_from_sec: number;
    visible_to_sec: number;
    data_binding: Record<string, unknown>;
  }>;
  audio_narration_uri?: string;
  auto_generate_srt: boolean;
  auto_generate_bibliography_credits: boolean;
}
