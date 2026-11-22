import type {
  BasemapId,
  BorderShaderMode,
  BoundarySmoothnessProfile,
  ComposableStylePack,
  LayerVisibilityConfig,
} from "@historical-cartography/shared-schema";

export interface BasemapCatalogItem {
  id: BasemapId;
  label_zh: string;
  description_zh: string;
  is_dark: boolean;
  default_bg_hex: string;
  water_hex: string;
  land_low_hex: string;
  land_high_hex: string;
}

export const BASEMAP_CATALOG: readonly BasemapCatalogItem[] = [
  {
    id: "hypsometric_dem",
    label_zh: "高程分层设色",
    description_zh: "海拔自然色带 + 立体山体阴影，清晰展现高原、盆地、绿洲与河谷",
    is_dark: false,
    default_bg_hex: "#d5e4ee",
    water_hex: "#9ec2da",
    land_low_hex: "#dce4ca",
    land_high_hex: "#b79e7a",
  },
  {
    id: "swiss_relief_engraved",
    label_zh: "瑞士精雕晕渲",
    description_zh: "Eduard Imhof 暖阳/冷阴空气透视晕渲，适合叠加经纬网与精细水系",
    is_dark: false,
    default_bg_hex: "#dae2e5",
    water_hex: "#9bb7cc",
    land_low_hex: "#e6e8df",
    land_high_hex: "#a4acb0",
  },
  {
    id: "alabaster_clay_relief",
    label_zh: "极简白灰石膏",
    description_zh: "非活跃区压低为纯白/浅灰高明度浮雕，强烈突出活跃政权",
    is_dark: false,
    default_bg_hex: "#e8edf2",
    water_hex: "#c9d4df",
    land_low_hex: "#f4f5f6",
    land_high_hex: "#cfd3d8",
  },
  {
    id: "satellite_natural",
    label_zh: "真彩卫星影像",
    description_zh: "无云自然地表遥感纹理，配合海岸线与古水系叠加",
    is_dark: true,
    default_bg_hex: "#162638",
    water_hex: "#1c3b57",
    land_low_hex: "#3d4f38",
    land_high_hex: "#786951",
  },
  {
    id: "satellite_dark_mono",
    label_zh: "暗黑黑白卫星",
    description_zh: "深炭灰/黑白暗调卫星地形，高亮白色海岸线与高饱和政权色块",
    is_dark: true,
    default_bg_hex: "#131820",
    water_hex: "#192029",
    land_low_hex: "#292c31",
    land_high_hex: "#4a4e56",
  },
  {
    id: "antique_parchment",
    label_zh: "羊皮纸古舆图",
    description_zh: "泛黄宣纸/羊皮纹理叠加细腻山影与蔚蓝水系，还原古卷质感",
    is_dark: false,
    default_bg_hex: "#dfd5bc",
    water_hex: "#b8c7c4",
    land_low_hex: "#eee4cd",
    land_high_hex: "#c6b28f",
  },
  {
    id: "modern_reference",
    label_zh: "现今政区参考",
    description_zh: "现代国界、城市与交通参照层，支持半透明叠加做古今对照",
    is_dark: false,
    default_bg_hex: "#dde6ef",
    water_hex: "#b3cde4",
    land_low_hex: "#eef1f4",
    land_high_hex: "#cbd2da",
  },
];

export const BORDER_SHADER_CATALOG: readonly {
  mode: BorderShaderMode;
  label_zh: string;
  summary_zh: string;
}[] = [
  { mode: "crisp_outlined", label_zh: "锐利双层描边", summary_zh: "高对比亮白/深色外描边，复杂地形轮廓清晰" },
  { mode: "inner_band_glow", label_zh: "学术内发光带", summary_zh: "深色精细外框配向内延展半透明彩带，腹地通透显政区" },
  { mode: "watercolor_vignette", label_zh: "水彩外缘羽化", summary_zh: "外缘浓重着彩向中心渐淡，透出羊皮纸山川纹理" },
  { mode: "multi_tier_ink", label_zh: "多级黑墨分界", summary_zh: "省界 > 府界 > 县/土司微单元分级黑墨线配经纬网" },
  { mode: "occupation_hatch_frontline", label_zh: "战役占领斜线", summary_zh: "军事占领斜线网纹填充 + 交战前线高亮推进线" },
  { mode: "spotlight_isolation", label_zh: "聚光灯焦点隔离", summary_zh: "周边去色黑白暗调底图，仅主角政权高饱和聚焦" },
];

export const DEFAULT_SMOOTHNESS_PROFILE: BoundarySmoothnessProfile = {
  profile_id: "profile-cartographic-natural",
  mode: "CARTOGRAPHIC_NATURAL",
  simplify_area_ratio: 0.00005,
  spline_tension: 0.55,
  max_hausdorff_deviation_km: 25,
  target_fractal_dim_range: [1.04, 1.22],
  min_micro_turn_angle_deg: 135,
  enforce_landmark_preservation: true,
};

const DEFAULT_CONTROL_STOPS: ComposableStylePack["territory_rendering"]["control_score_stops"] = [
  { score: 0, opacity: 0.06, saturation_scale: 0.18, contour_stroke_dasharray: [2, 5] },
  { score: 20, opacity: 0.24, saturation_scale: 0.42, contour_stroke_dasharray: [4, 4] },
  { score: 50, opacity: 0.54, saturation_scale: 0.72, contour_stroke_dasharray: [8, 3] },
  { score: 80, opacity: 0.82, saturation_scale: 0.94 },
  { score: 100, opacity: 0.92, saturation_scale: 1.0 },
];

export const PALETTE_THEMES: Record<string, { label_zh: string; colors: string[] }> = {
  "palette-vivid-narrative": {
    label_zh: "叙事科普高饱和色系",
    colors: ["#2d74da", "#2aa564", "#d94f4f", "#d98d26", "#8c56d9", "#1c9db3", "#c44586"],
  },
  "palette-kunyu-mineral": {
    label_zh: "古卷矿物颜料色系",
    colors: ["#558b77", "#b88a4a", "#7f6393", "#4f749c", "#b85f4b", "#929457", "#6f8096"],
  },
  "palette-academic-wash": {
    label_zh: "清淡学术套色系",
    colors: ["#6495c4", "#6fb38a", "#d98d68", "#a883c4", "#c4a85a", "#5ca8b3", "#c97496"],
  },
  "palette-gemstone-dark": {
    label_zh: "暗黑深邃宝石色系",
    colors: ["#1f78d1", "#1fa368", "#d44a3a", "#d99a1e", "#8f4fd4", "#1ea8b8", "#cf3c88"],
  },
  "palette-tactical-redblue": {
    label_zh: "红蓝对抗战役色系",
    colors: ["#c83e3b", "#2e68b8", "#d48d2b", "#4e8f66", "#7a6696", "#3d94a6", "#9a6d52"],
  },
};

export const FLAGSHIP_STYLE_PRESETS: readonly ComposableStylePack[] = [
  {
    style_id: "vivid_video_songti",
    display_name: "高饱和叙事科普风",
    basemap: {
      basemap_id: "hypsometric_dem",
      blend_mode: "multiply",
      desaturation: 0.12,
      hillshade_exaggeration: 0.72,
      show_graticule_grid: false,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "crisp_outlined",
      outer_stroke_hex: "#ffffff",
      outer_stroke_width_px: 2.6,
      inner_band_width_px: 6,
      inner_band_opacity: 0.25,
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.68,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-vivid-narrative",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Serif SC, Songti SC, SimSun, serif",
      city_font: "Noto Sans SC, PingFang SC, sans-serif",
      curved_along_spine: true,
      letter_spacing_em: 0.28,
      bilingual_mode: "NONE",
      show_uncertainty_question_mark: true,
      city_symbol_pack: "BLUE_RING",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-narrative-16x9",
  },
  {
    style_id: "kunyufu_parchment",
    display_name: "古卷水彩晕边风",
    extends_style_id: "vivid_video_songti",
    basemap: {
      basemap_id: "antique_parchment",
      blend_mode: "multiply",
      desaturation: 0.08,
      hillshade_exaggeration: 0.55,
      show_graticule_grid: false,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "watercolor_vignette",
      outer_stroke_hex: "#4b4132",
      outer_stroke_width_px: 1.8,
      inner_band_width_px: 24,
      inner_band_opacity: 0.45,
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.56,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-kunyu-mineral",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Serif SC, Kaiti SC, Songti SC, serif",
      city_font: "Noto Serif SC, Songti SC, serif",
      curved_along_spine: true,
      letter_spacing_em: 0.42,
      bilingual_mode: "NONE",
      show_uncertainty_question_mark: true,
      city_symbol_pack: "ANTIQUE_DOUBLE_RING",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-scholar-classic",
  },
  {
    style_id: "academic_inner_glow",
    display_name: "清淡学术考证风",
    extends_style_id: "kunyufu_parchment",
    basemap: {
      basemap_id: "swiss_relief_engraved",
      blend_mode: "normal",
      desaturation: 0.25,
      hillshade_exaggeration: 0.42,
      show_graticule_grid: true,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "inner_band_glow",
      outer_stroke_hex: "#2d353c",
      outer_stroke_width_px: 1.6,
      inner_band_width_px: 18,
      inner_band_opacity: 0.42,
      admin_tier_widths_px: [2.2, 1.3, 0.8],
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.28,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-academic-wash",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Serif SC, Songti SC, serif",
      city_font: "Noto Serif SC, Songti SC, serif",
      curved_along_spine: true,
      letter_spacing_em: 0.36,
      bilingual_mode: "STACKED",
      show_uncertainty_question_mark: true,
      city_symbol_pack: "ANTIQUE_DOUBLE_RING",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-scholar-classic",
  },
  {
    style_id: "obsidian_dark_empire",
    display_name: "暗黑深邃宝石风",
    extends_style_id: "vivid_video_songti",
    basemap: {
      basemap_id: "satellite_dark_mono",
      blend_mode: "soft-light",
      desaturation: 0.9,
      hillshade_exaggeration: 0.8,
      show_graticule_grid: false,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "crisp_outlined",
      outer_stroke_hex: "#f8fafc",
      outer_stroke_width_px: 2.2,
      inner_band_width_px: 10,
      inner_band_opacity: 0.28,
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.68,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-gemstone-dark",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Serif SC, Songti SC, serif",
      city_font: "Noto Sans SC, sans-serif",
      curved_along_spine: true,
      letter_spacing_em: 0.3,
      bilingual_mode: "INLINE",
      show_uncertainty_question_mark: true,
      city_symbol_pack: "BLUE_RING",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-narrative-16x9",
  },
  {
    style_id: "alabaster_clay_focus",
    display_name: "极简白灰浮雕风",
    extends_style_id: "vivid_video_songti",
    basemap: {
      basemap_id: "alabaster_clay_relief",
      blend_mode: "multiply",
      desaturation: 0.95,
      hillshade_exaggeration: 0.68,
      show_graticule_grid: false,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "inner_band_glow",
      outer_stroke_hex: "#2f3640",
      outer_stroke_width_px: 1.8,
      inner_band_width_px: 14,
      inner_band_opacity: 0.34,
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.64,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-vivid-narrative",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Serif SC, Songti SC, serif",
      city_font: "Noto Sans SC, sans-serif",
      curved_along_spine: true,
      letter_spacing_em: 0.28,
      bilingual_mode: "NONE",
      show_uncertainty_question_mark: true,
      city_symbol_pack: "BLUE_RING",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-portrait-pin",
  },
  {
    style_id: "atlas_chronicle",
    display_name: "史图馆典藏图集风",
    extends_style_id: "academic_inner_glow",
    basemap: {
      basemap_id: "swiss_relief_engraved",
      blend_mode: "multiply",
      desaturation: 0.18,
      hillshade_exaggeration: 0.52,
      show_graticule_grid: true,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "multi_tier_ink",
      outer_stroke_hex: "#26231f",
      outer_stroke_width_px: 2.0,
      admin_tier_widths_px: [2.4, 1.4, 0.7],
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.44,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-academic-wash",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Serif SC, Songti SC, serif",
      city_font: "Noto Serif SC, serif",
      curved_along_spine: true,
      letter_spacing_em: 0.32,
      bilingual_mode: "STACKED",
      show_uncertainty_question_mark: true,
      city_symbol_pack: "YELLOW_SQUARE",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-chronicle-atlas",
  },
  {
    style_id: "tactical_war_parchment",
    display_name: "战役斜线双语风",
    extends_style_id: "kunyufu_parchment",
    basemap: {
      basemap_id: "antique_parchment",
      blend_mode: "multiply",
      desaturation: 0.22,
      hillshade_exaggeration: 0.64,
      show_graticule_grid: false,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "occupation_hatch_frontline",
      outer_stroke_hex: "#8b1e1e",
      outer_stroke_width_px: 2.4,
      hatch_angle_deg: 45,
      hatch_spacing_px: 9,
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.58,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-tactical-redblue",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Serif SC, serif",
      city_font: "Noto Sans SC, sans-serif",
      curved_along_spine: false,
      letter_spacing_em: 0.18,
      bilingual_mode: "STACKED",
      show_uncertainty_question_mark: true,
      city_symbol_pack: "PILL_BADGE",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-coalition-war",
  },
  {
    style_id: "matte_vector_story",
    display_name: "哑光现代科普风",
    extends_style_id: "vivid_video_songti",
    basemap: {
      basemap_id: "hypsometric_dem",
      blend_mode: "normal",
      desaturation: 0.45,
      hillshade_exaggeration: 0.48,
      show_graticule_grid: false,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "crisp_outlined",
      outer_stroke_hex: "#e5e7eb",
      outer_stroke_width_px: 1.9,
      admin_tier_widths_px: [2.0, 1.1, 0.7],
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.78,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-vivid-narrative",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Sans SC, PingFang SC, sans-serif",
      city_font: "Noto Sans SC, sans-serif",
      curved_along_spine: false,
      letter_spacing_em: 0.14,
      bilingual_mode: "NONE",
      show_uncertainty_question_mark: false,
      city_symbol_pack: "BLUE_RING",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-narrative-16x9",
  },
  {
    style_id: "engraved_tusi_swiss",
    display_name: "瑞士黑墨精雕风",
    extends_style_id: "atlas_chronicle",
    basemap: {
      basemap_id: "swiss_relief_engraved",
      blend_mode: "multiply",
      desaturation: 0.4,
      hillshade_exaggeration: 0.88,
      show_graticule_grid: true,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "multi_tier_ink",
      outer_stroke_hex: "#111827",
      outer_stroke_width_px: 2.2,
      admin_tier_widths_px: [2.6, 1.5, 0.85],
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.42,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-kunyu-mineral",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Serif SC, Songti SC, serif",
      city_font: "Noto Serif SC, serif",
      curved_along_spine: true,
      letter_spacing_em: 0.25,
      bilingual_mode: "NONE",
      show_uncertainty_question_mark: true,
      city_symbol_pack: "YELLOW_SQUARE",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-scholar-classic",
  },
  {
    style_id: "mono_spotlight_hud",
    display_name: "黑白卫星聚光灯风",
    extends_style_id: "obsidian_dark_empire",
    basemap: {
      basemap_id: "satellite_dark_mono",
      blend_mode: "normal",
      desaturation: 1.0,
      hillshade_exaggeration: 0.7,
      show_graticule_grid: false,
      show_modern_overlay: false,
    },
    border_shader: {
      mode: "spotlight_isolation",
      outer_stroke_hex: "#fbbf24",
      outer_stroke_width_px: 2.6,
      inner_band_width_px: 12,
      inner_band_opacity: 0.35,
    },
    territory_rendering: {
      pure_mode_fill_opacity: 0.72,
      control_score_stops: DEFAULT_CONTROL_STOPS,
    },
    color_palette_id: "palette-gemstone-dark",
    auto_four_color_solver: true,
    typography: {
      polity_font: "Noto Sans SC, sans-serif",
      city_font: "Noto Sans SC, sans-serif",
      curved_along_spine: false,
      letter_spacing_em: 0.16,
      bilingual_mode: "INLINE",
      show_uncertainty_question_mark: true,
      city_symbol_pack: "BLUE_RING",
    },
    default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
    default_hud_preset_id: "hud-dashboard-spotlight",
  },
];

export type StylePackPatch = Partial<Omit<ComposableStylePack, "basemap" | "border_shader" | "territory_rendering" | "typography">> & {
  basemap?: Partial<ComposableStylePack["basemap"]>;
  border_shader?: Partial<ComposableStylePack["border_shader"]>;
  territory_rendering?: Partial<ComposableStylePack["territory_rendering"]>;
  typography?: Partial<ComposableStylePack["typography"]>;
};

export function mergeStylePack(base: ComposableStylePack, patch: StylePackPatch): ComposableStylePack {
  return {
    ...base,
    ...patch,
    basemap: { ...base.basemap, ...patch.basemap },
    border_shader: { ...base.border_shader, ...patch.border_shader },
    territory_rendering: { ...base.territory_rendering, ...patch.territory_rendering },
    typography: { ...base.typography, ...patch.typography },
  };
}

/**
 * Resolve an inheritable `ComposableStylePack` along its `extends_style_id` chain
 * with optional user/MCP runtime overrides.
 */
export function resolveStylePack(
  styleId: string,
  extraPacks: readonly ComposableStylePack[] = [],
  overrides?: StylePackPatch,
): ComposableStylePack {
  const byId = new Map<string, ComposableStylePack>();
  for (const p of FLAGSHIP_STYLE_PRESETS) byId.set(p.style_id, p);
  for (const p of extraPacks) byId.set(p.style_id, p);

  const chain: ComposableStylePack[] = [];
  const visited = new Set<string>();
  let cursorId: string | undefined = styleId;

  while (cursorId) {
    if (visited.has(cursorId)) {
      throw new Error(`Circular extends_style_id detected at ${cursorId}`);
    }
    visited.add(cursorId);
    const found = byId.get(cursorId);
    if (!found) {
      if (chain.length === 0) {
        const fallback = FLAGSHIP_STYLE_PRESETS[0]!;
        return overrides ? mergeStylePack(fallback, overrides) : fallback;
      }
      break;
    }
    chain.unshift(found);
    cursorId = found.extends_style_id;
  }

  let resolved = chain[0]!;
  for (let i = 1; i < chain.length; i++) {
    resolved = mergeStylePack(resolved, chain[i]!);
  }
  if (overrides) {
    resolved = mergeStylePack(resolved, overrides);
  }
  return resolved;
}

export function composeMapStyle(params: {
  style_id: string;
  overrides?: StylePackPatch;
  layer_config: LayerVisibilityConfig;
}): {
  resolved_style: ComposableStylePack;
  layer_config: LayerVisibilityConfig;
} {
  return {
    resolved_style: resolveStylePack(params.style_id, [], params.overrides),
    layer_config: params.layer_config,
  };
}
