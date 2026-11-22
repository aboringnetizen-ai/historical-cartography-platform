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

export interface HudPresetTheme {
  preset_id: string;
  label_zh: string;
  date_badge_style: "glass_accent" | "gold_seal" | "floating_serif" | "parchment_crest";
  figure_pin_style: "portrait_medallion" | "crest_shield";
  subtitle_style: "dark_pill" | "borderless_stroke";
  chronicle_style: "dark_card" | "floating_ink";
  roster_style: "parchment_gold" | "slate_glass";
  pip_style: "atlas_sea_inset" | "tactical_radar";
  prefer_light_map_label: boolean;
}

export const HUD_PRESET_CATALOG: Record<string, HudPresetTheme> = {
  "hud-narrative-16x9": {
    preset_id: "hud-narrative-16x9",
    label_zh: "叙事科普角标+人像勋章",
    date_badge_style: "glass_accent",
    figure_pin_style: "portrait_medallion",
    subtitle_style: "dark_pill",
    chronicle_style: "dark_card",
    roster_style: "slate_glass",
    pip_style: "tactical_radar",
    prefer_light_map_label: true,
  },
  "hud-scholar-classic": {
    preset_id: "hud-scholar-classic",
    label_zh: "古卷考证浮雕字幕",
    date_badge_style: "glass_accent",
    figure_pin_style: "portrait_medallion",
    subtitle_style: "dark_pill",
    chronicle_style: "floating_ink",
    roster_style: "parchment_gold",
    pip_style: "atlas_sea_inset",
    prefer_light_map_label: false,
  },
  "hud-portrait-pin": {
    preset_id: "hud-portrait-pin",
    label_zh: "白灰浮雕+金边盾徽立绘",
    date_badge_style: "gold_seal",
    figure_pin_style: "crest_shield",
    subtitle_style: "borderless_stroke",
    chronicle_style: "dark_card",
    roster_style: "slate_glass",
    pip_style: "tactical_radar",
    prefer_light_map_label: true,
  },
  "hud-chronicle-atlas": {
    preset_id: "hud-chronicle-atlas",
    label_zh: "史图馆典藏+海面专栏+附图",
    date_badge_style: "floating_serif",
    figure_pin_style: "portrait_medallion",
    subtitle_style: "dark_pill",
    chronicle_style: "floating_ink",
    roster_style: "parchment_gold",
    pip_style: "atlas_sea_inset",
    prefer_light_map_label: true,
  },
  "hud-coalition-war": {
    preset_id: "hud-coalition-war",
    label_zh: "羊皮纸双边参战花名册",
    date_badge_style: "parchment_crest",
    figure_pin_style: "portrait_medallion",
    subtitle_style: "dark_pill",
    chronicle_style: "floating_ink",
    roster_style: "parchment_gold",
    pip_style: "tactical_radar",
    prefer_light_map_label: true,
  },
  "hud-dashboard-spotlight": {
    preset_id: "hud-dashboard-spotlight",
    label_zh: "聚光灯君主旗帜仪表盘",
    date_badge_style: "glass_accent",
    figure_pin_style: "portrait_medallion",
    subtitle_style: "dark_pill",
    chronicle_style: "dark_card",
    roster_style: "slate_glass",
    pip_style: "tactical_radar",
    prefer_light_map_label: true,
  },
};

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
    default_bg_hex: "#eef1f4",
    water_hex: "#c2bcef",
    land_low_hex: "#f7f8fa",
    land_high_hex: "#d4d9df",
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
    description_zh: "泛黄纤维纸纹叠加细腻山影与蔚蓝水系，还原古卷质感",
    is_dark: false,
    default_bg_hex: "#dfd5bc",
    water_hex: "#bfd0d4",
    land_low_hex: "#efe4c8",
    land_high_hex: "#c4ad84",
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
  { score: 0, opacity: 0.08, saturation_scale: 0.18, contour_stroke_dasharray: [2, 5] },
  { score: 20, opacity: 0.26, saturation_scale: 0.42, contour_stroke_dasharray: [4, 4] },
  { score: 50, opacity: 0.56, saturation_scale: 0.72, contour_stroke_dasharray: [8, 3] },
  { score: 80, opacity: 0.82, saturation_scale: 0.94, contour_stroke_dasharray: [14, 2] },
  { score: 100, opacity: 0.92, saturation_scale: 1.0 },
];

export const PALETTE_THEMES: Record<string, { label_zh: string; colors: string[] }> = {
  "palette-vivid-narrative": {
    label_zh: "叙事科普高饱和色系",
    colors: ["#2aa564", "#2d74da", "#d94f4f", "#d98d26", "#8c56d9", "#1c9db3", "#c44586"],
  },
  "palette-kunyu-mineral": {
    label_zh: "古卷矿物颜料色系",
    colors: ["#c8b37c", "#558b77", "#7f6393", "#4f749c", "#b85f4b", "#929457", "#6f8096"],
  },
  "palette-academic-wash": {
    label_zh: "清淡学术套色系",
    colors: ["#149438", "#6495c4", "#d98d68", "#a883c4", "#c4a85a", "#5ca8b3", "#c97496"],
  },
  "palette-gemstone-dark": {
    label_zh: "暗黑深邃宝石色系",
    colors: ["#d97706", "#1f78d1", "#1fa368", "#d44a3a", "#8f4fd4", "#1ea8b8", "#cf3c88"],
  },
  "palette-tactical-redblue": {
    label_zh: "红蓝对抗战役色系",
    colors: ["#c82828", "#163aa8", "#d48d2b", "#4e8f66", "#7a6696", "#3d94a6", "#9a6d52"],
  },
};

export type StylePackPatch = Partial<
  Omit<ComposableStylePack, "basemap" | "border_shader" | "territory_rendering" | "typography">
> & {
  basemap?: Partial<ComposableStylePack["basemap"]>;
  border_shader?: Partial<ComposableStylePack["border_shader"]>;
  territory_rendering?: Partial<ComposableStylePack["territory_rendering"]>;
  typography?: Partial<ComposableStylePack["typography"]>;
};

export type FlagshipStyleSeed = StylePackPatch & { style_id: string; display_name: string };

const BASE_FLAGSHIP_PACK: ComposableStylePack = {
  style_id: "vivid_video_songti",
  display_name: "高饱和叙事科普风",
  basemap: {
    basemap_id: "hypsometric_dem",
    blend_mode: "multiply",
    desaturation: 0.14,
    hillshade_exaggeration: 0.72,
    show_graticule_grid: false,
    show_modern_overlay: false,
  },
  border_shader: {
    mode: "crisp_outlined",
    outer_stroke_hex: "#ffffff",
    outer_stroke_width_px: 2.2,
    inner_band_width_px: 8,
    inner_band_opacity: 0.28,
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
    letter_spacing_em: 0.3,
    bilingual_mode: "NONE",
    show_uncertainty_question_mark: true,
    city_symbol_pack: "BLUE_RING",
  },
  default_smoothness_profile: DEFAULT_SMOOTHNESS_PROFILE,
  default_hud_preset_id: "hud-narrative-16x9",
};

/**
 * True sparse inheritance chain: modifying parent packs propagates orthogonally to children!
 */
export const FLAGSHIP_STYLE_SEEDS: readonly FlagshipStyleSeed[] = [
  BASE_FLAGSHIP_PACK,
  {
    style_id: "kunyufu_parchment",
    display_name: "古卷水彩晕边风",
    extends_style_id: "vivid_video_songti",
    basemap: { basemap_id: "antique_parchment", desaturation: 0.08, hillshade_exaggeration: 0.52 },
    border_shader: { mode: "watercolor_vignette", outer_stroke_hex: "#4b4132", outer_stroke_width_px: 1.7, inner_band_width_px: 24, inner_band_opacity: 0.56 },
    territory_rendering: { pure_mode_fill_opacity: 0.24 },
    color_palette_id: "palette-kunyu-mineral",
    typography: { polity_font: "Noto Serif SC, Kaiti SC, Songti SC, serif", city_font: "Noto Serif SC, Songti SC, serif", letter_spacing_em: 0.45, city_symbol_pack: "ANTIQUE_DOUBLE_RING" },
    default_hud_preset_id: "hud-scholar-classic",
  },
  {
    style_id: "academic_inner_glow",
    display_name: "清淡学术考证风",
    extends_style_id: "kunyufu_parchment",
    basemap: { basemap_id: "swiss_relief_engraved", blend_mode: "normal", desaturation: 0.25, hillshade_exaggeration: 0.44, show_graticule_grid: true },
    border_shader: { mode: "inner_band_glow", outer_stroke_hex: "#2d353c", outer_stroke_width_px: 1.5, inner_band_width_px: 18, inner_band_opacity: 0.46, admin_tier_widths_px: [2.2, 1.3, 0.8] },
    territory_rendering: { pure_mode_fill_opacity: 0.26 },
    color_palette_id: "palette-academic-wash",
    typography: { letter_spacing_em: 0.36, bilingual_mode: "STACKED" },
  },
  {
    style_id: "obsidian_dark_empire",
    display_name: "暗黑深邃宝石风",
    extends_style_id: "vivid_video_songti",
    basemap: { basemap_id: "satellite_dark_mono", blend_mode: "soft-light", desaturation: 0.92, hillshade_exaggeration: 0.78 },
    border_shader: { mode: "crisp_outlined", outer_stroke_hex: "#f8fafc", outer_stroke_width_px: 2.1, inner_band_width_px: 10, inner_band_opacity: 0.3 },
    color_palette_id: "palette-gemstone-dark",
    typography: { bilingual_mode: "INLINE" },
  },
  {
    style_id: "alabaster_clay_focus",
    display_name: "极简白灰浮雕风",
    extends_style_id: "vivid_video_songti",
    basemap: { basemap_id: "alabaster_clay_relief", blend_mode: "multiply", desaturation: 0.96, hillshade_exaggeration: 0.68 },
    border_shader: { mode: "crisp_outlined", outer_stroke_hex: "#ffffff", outer_stroke_width_px: 2.2, inner_band_width_px: 12, inner_band_opacity: 0.3 },
    territory_rendering: { pure_mode_fill_opacity: 0.66 },
    default_hud_preset_id: "hud-portrait-pin",
  },
  {
    style_id: "atlas_chronicle",
    display_name: "史图馆典藏图集风",
    extends_style_id: "academic_inner_glow",
    basemap: { blend_mode: "multiply", desaturation: 0.16, hillshade_exaggeration: 0.5 },
    border_shader: { mode: "multi_tier_ink", outer_stroke_hex: "#26231f", outer_stroke_width_px: 2.1, admin_tier_widths_px: [2.4, 1.35, 0.72] },
    territory_rendering: { pure_mode_fill_opacity: 0.56 },
    typography: { city_symbol_pack: "YELLOW_SQUARE" },
    default_hud_preset_id: "hud-chronicle-atlas",
  },
  {
    style_id: "tactical_war_parchment",
    display_name: "战役斜线双语风",
    extends_style_id: "kunyufu_parchment",
    basemap: { desaturation: 0.22, hillshade_exaggeration: 0.64 },
    border_shader: { mode: "occupation_hatch_frontline", outer_stroke_hex: "#f8fafc", outer_stroke_width_px: 2.1, hatch_angle_deg: 45, hatch_spacing_px: 8, inner_band_opacity: 0.62 },
    territory_rendering: { pure_mode_fill_opacity: 0.58 },
    color_palette_id: "palette-tactical-redblue",
    typography: { city_font: "Noto Sans SC, sans-serif", curved_along_spine: false, letter_spacing_em: 0.18, bilingual_mode: "STACKED", city_symbol_pack: "PILL_BADGE" },
    default_hud_preset_id: "hud-coalition-war",
  },
  {
    style_id: "matte_vector_story",
    display_name: "哑光现代科普风",
    extends_style_id: "vivid_video_songti",
    basemap: { blend_mode: "normal", desaturation: 0.45, hillshade_exaggeration: 0.48 },
    border_shader: { outer_stroke_hex: "#e5e7eb", outer_stroke_width_px: 1.9, admin_tier_widths_px: [2.0, 1.1, 0.7] },
    territory_rendering: { pure_mode_fill_opacity: 0.74 },
    typography: { polity_font: "Noto Sans SC, PingFang SC, sans-serif", curved_along_spine: false, letter_spacing_em: 0.14, show_uncertainty_question_mark: false },
  },
  {
    style_id: "engraved_tusi_swiss",
    display_name: "瑞士黑墨精雕风",
    extends_style_id: "atlas_chronicle",
    basemap: { desaturation: 0.4, hillshade_exaggeration: 0.88 },
    border_shader: { outer_stroke_hex: "#111827", outer_stroke_width_px: 2.3, admin_tier_widths_px: [2.6, 1.5, 0.85] },
    territory_rendering: { pure_mode_fill_opacity: 0.42 },
    color_palette_id: "palette-kunyu-mineral",
    typography: { bilingual_mode: "NONE" },
    default_hud_preset_id: "hud-scholar-classic",
  },
  {
    style_id: "mono_spotlight_hud",
    display_name: "黑白卫星聚光灯风",
    extends_style_id: "obsidian_dark_empire",
    basemap: { blend_mode: "normal", desaturation: 1.0, hillshade_exaggeration: 0.7 },
    border_shader: { mode: "spotlight_isolation", outer_stroke_hex: "#fbbf24", outer_stroke_width_px: 2.6, inner_band_width_px: 14, inner_band_opacity: 0.38 },
    territory_rendering: { pure_mode_fill_opacity: 0.72 },
    typography: { polity_font: "Noto Sans SC, sans-serif", curved_along_spine: false, letter_spacing_em: 0.16 },
    default_hud_preset_id: "hud-dashboard-spotlight",
  },
];

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
 * Resolve an inheritable `ComposableStylePack` along its `extends_style_id` chain.
 * Supports passing overridden seed/pack entries via `extraPacks` so modifying a parent
 * style dynamically propagates down to child presets.
 */
export function resolveStylePack(
  styleId: string,
  extraPacks: readonly StylePackPatch[] = [],
  overrides?: StylePackPatch,
): ComposableStylePack {
  const byId = new Map<string, StylePackPatch>();
  for (const s of FLAGSHIP_STYLE_SEEDS) byId.set(s.style_id, s);
  for (const p of extraPacks) {
    if (p.style_id) byId.set(p.style_id, p);
  }

  const chain: StylePackPatch[] = [];
  const visited = new Set<string>();
  let cursorId: string | undefined = styleId;

  while (cursorId) {
    if (visited.has(cursorId)) {
      throw new Error(`Circular extends_style_id detected at ${cursorId}`);
    }
    visited.add(cursorId);
    const found = byId.get(cursorId);
    if (!found) break;
    chain.unshift(found);
    cursorId = found.extends_style_id;
  }

  let resolved = BASE_FLAGSHIP_PACK;
  for (const node of chain) {
    resolved = mergeStylePack(resolved, node);
  }
  if (overrides) {
    resolved = mergeStylePack(resolved, overrides);
  }
  return resolved;
}

export const FLAGSHIP_STYLE_PRESETS: readonly ComposableStylePack[] = FLAGSHIP_STYLE_SEEDS.map((s) =>
  resolveStylePack(s.style_id),
);

export function resolveHudPresetTheme(stylePack: ComposableStylePack): HudPresetTheme {
  const pid = stylePack.default_hud_preset_id ?? "hud-narrative-16x9";
  return HUD_PRESET_CATALOG[pid] ?? HUD_PRESET_CATALOG["hud-narrative-16x9"]!;
}

/**
 * Declarative WCAG-inspired relative luminance contrast check.
 */
export function isDarkHexColor(hex: string): boolean {
  const clean = hex.trim().replace(/^#/, "");
  const r = Number.parseInt(clean.slice(0, 2) || "00", 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4) || "00", 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6) || "00", 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.45;
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
