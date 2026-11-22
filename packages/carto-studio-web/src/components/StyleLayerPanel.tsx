import type {
  BasemapId,
  BorderShaderMode,
  ComposableStylePack,
  CredibilityTier,
  LayerVisibilityConfig,
} from "@historical-cartography/shared-schema";
import type { LabelLayoutReport } from "../core/layout/label-collision.ts";
import {
  BASEMAP_CATALOG,
  BORDER_SHADER_CATALOG,
  FLAGSHIP_STYLE_PRESETS,
  type StylePackPatch,
} from "../core/styles/style-presets.ts";

export interface StyleLayerPanelProps {
  activeStyleId: string;
  resolvedStyle: ComposableStylePack;
  layerConfig: LayerVisibilityConfig;
  labelReport: LabelLayoutReport;
  onSelectStylePreset: (styleId: string) => void;
  onPatchStyle: (patch: StylePackPatch) => void;
  onUpdateLayerConfig: (next: LayerVisibilityConfig) => void;
}

const OVERLAY_OPTIONS: Array<{ id: string; label_zh: string }> = [
  { id: "admin_divisions", label_zh: "多级政区界与治所" },
  { id: "historical_events", label_zh: "历史事件/行军箭头" },
  { id: "source_credibility", label_zh: "信源等级审校高亮" },
  { id: "uncertainty_markers", label_zh: "模糊疆界与存疑标注" },
  { id: "physical_paleo_geo", label_zh: "古水系/河道变迁覆写" },
  { id: "silk_road_network", label_zh: "丝绸之路干线叠加" },
  { id: "ethnic_tribes", label_zh: "周边族群与部落标注" },
  { id: "population_hubs", label_zh: "战役聚落与港口枢纽" },
];

const BLEND_MODES: Array<{ id: ComposableStylePack["basemap"]["blend_mode"]; label: string }> = [
  { id: "normal", label: "正常 (Normal)" },
  { id: "multiply", label: "正片叠底 (Multiply)" },
  { id: "overlay", label: "叠加 (Overlay)" },
  { id: "soft-light", label: "柔光 (Soft-Light)" },
];

const CREDIBILITY_FILTERS: Array<{ id: Exclude<CredibilityTier, "REJECTED_UNVERIFIED">; label: string }> = [
  { id: "T3_GENERAL_ENCYCLOPEDIA", label: "T3 及以上（全部入图）" },
  { id: "T2_SECONDARY_SCHOLARLY_OR_CURATED", label: "仅 T2 学术论著及以上" },
  { id: "T1_PRIMARY_AND_LOCAL_ACADEMIC", label: "仅 T1 原始史料/核心正史" },
];

const FONT_OPTIONS = [
  { value: '"Noto Serif SC", "Songti SC", serif', label: "思源宋体 (Noto Serif SC)" },
  { value: '"Noto Sans SC", "PingFang SC", sans-serif', label: "思源黑体 (Noto Sans SC)" },
  { value: '"KaiTi", "STKaiti", "BiauKai", serif', label: "楷体 (KaiTi)" },
  { value: '"FangSong", "STFangsong", serif', label: "仿宋 (FangSong)" },
];

export function StyleLayerPanel(props: StyleLayerPanelProps) {
  const { resolvedStyle, layerConfig } = props;
  const shader = resolvedStyle.border_shader;
  const typo = resolvedStyle.typography;
  const adminWidths = shader.admin_tier_widths_px ?? [2.8, 1.8, 1.1];

  const toggleOverlay = (overlayId: string) => {
    const exists = layerConfig.enabled_overlays.includes(overlayId);
    const next = exists
      ? layerConfig.enabled_overlays.filter((id) => id !== overlayId)
      : [...layerConfig.enabled_overlays, overlayId];
    props.onUpdateLayerConfig({ ...layerConfig, enabled_overlays: next });
  };

  return (
    <aside className="side-drawer" aria-label="正交风格与图层面板">
      <div className="panel-section">
        <div className="panel-title">
          <span>风格 Preset 与继承链</span>
          <span className="pill-badge">{resolvedStyle.extends_style_id ? `继承自 ${resolvedStyle.extends_style_id}` : "根风格"}</span>
        </div>
        <select
          className="select-control"
          value={props.activeStyleId}
          onChange={(e) => props.onSelectStylePreset(e.target.value)}
        >
          {FLAGSHIP_STYLE_PRESETS.map((preset) => (
            <option key={preset.style_id} value={preset.style_id}>
              {preset.display_name}
            </option>
          ))}
        </select>
        <div className="grid-two" style={{ marginTop: 8 }}>
          <button
            type="button"
            className={`btn-toggle ${layerConfig.base_mode === "PURE_TERRITORY" ? "active" : ""}`}
            onClick={() => props.onUpdateLayerConfig({ ...layerConfig, base_mode: "PURE_TERRITORY" })}
          >
            纯净疆域
          </button>
          <button
            type="button"
            className={`btn-toggle ${layerConfig.base_mode === "CONTROL_INTENSITY" ? "active" : ""}`}
            onClick={() =>
              props.onUpdateLayerConfig({
                ...layerConfig,
                base_mode: "CONTROL_INTENSITY",
                control_intensity_render_mode: layerConfig.control_intensity_render_mode ?? "OPACITY_GRADIENT",
              })
            }
          >
            控制力衰减
          </button>
        </div>
        {layerConfig.base_mode === "CONTROL_INTENSITY" && (
          <select
            className="select-control"
            style={{ marginTop: 6 }}
            value={layerConfig.control_intensity_render_mode ?? "OPACITY_GRADIENT"}
            onChange={(e) =>
              props.onUpdateLayerConfig({
                ...layerConfig,
                control_intensity_render_mode: e.target.value as NonNullable<
                  LayerVisibilityConfig["control_intensity_render_mode"]
                >,
              })
            }
          >
            <option value="OPACITY_GRADIENT">透明度渐变衰减</option>
            <option value="COLOR_RAMP">饱和度/明度色阶</option>
            <option value="CLOSED_ISOPLETH_CONTOURS">封闭控制力等值圈</option>
          </select>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-title">底图与混合模式 (Basemap & Blend)</div>
        <select
          className="select-control"
          value={resolvedStyle.basemap.basemap_id}
          onChange={(e) => props.onPatchStyle({ basemap: { basemap_id: e.target.value as BasemapId } })}
        >
          {BASEMAP_CATALOG.map((bm) => (
            <option key={bm.id} value={bm.id}>
              {bm.label_zh}
            </option>
          ))}
        </select>
        <select
          className="select-control"
          style={{ marginTop: 6 }}
          value={resolvedStyle.basemap.blend_mode}
          onChange={(e) =>
            props.onPatchStyle({
              basemap: { blend_mode: e.target.value as ComposableStylePack["basemap"]["blend_mode"] },
            })
          }
        >
          {BLEND_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <div className="field-row" style={{ marginTop: 8 }}>
          <span>去色度 ({resolvedStyle.basemap.desaturation.toFixed(2)})</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={resolvedStyle.basemap.desaturation}
            onChange={(e) => props.onPatchStyle({ basemap: { desaturation: Number(e.target.value) } })}
          />
        </div>
        <div className="field-row" style={{ marginTop: 6 }}>
          <span>山体浮雕 ({resolvedStyle.basemap.hillshade_exaggeration.toFixed(2)})</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={resolvedStyle.basemap.hillshade_exaggeration}
            onChange={(e) => props.onPatchStyle({ basemap: { hillshade_exaggeration: Number(e.target.value) } })}
          />
        </div>
        <div className="grid-two" style={{ marginTop: 6 }}>
          <label className="chip-row" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={resolvedStyle.basemap.show_graticule_grid}
              onChange={(e) => props.onPatchStyle({ basemap: { show_graticule_grid: e.target.checked } })}
            />
            显示经纬网
          </label>
          <label className="chip-row" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={resolvedStyle.basemap.show_modern_overlay}
              onChange={(e) => props.onPatchStyle({ basemap: { show_modern_overlay: e.target.checked } })}
            />
            现代国界参考
          </label>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">疆界 Shader 与笔触参数</div>
        <select
          className="select-control"
          value={shader.mode}
          onChange={(e) => props.onPatchStyle({ border_shader: { mode: e.target.value as BorderShaderMode } })}
        >
          {BORDER_SHADER_CATALOG.map((item) => (
            <option key={item.mode} value={item.mode}>
              {item.label_zh}
            </option>
          ))}
        </select>
        <div className="field-row" style={{ marginTop: 8 }}>
          <span>外描边色 / 线宽 ({shader.outer_stroke_width_px.toFixed(1)}px)</span>
          <div className="chip-row">
            <input
              type="color"
              value={shader.outer_stroke_hex}
              onChange={(e) => props.onPatchStyle({ border_shader: { outer_stroke_hex: e.target.value } })}
            />
            <input
              type="range"
              min={0.5}
              max={6}
              step={0.2}
              style={{ width: 88 }}
              value={shader.outer_stroke_width_px}
              onChange={(e) => props.onPatchStyle({ border_shader: { outer_stroke_width_px: Number(e.target.value) } })}
            />
          </div>
        </div>
        {(shader.mode === "inner_band_glow" || shader.mode === "watercolor_vignette") && (
          <>
            <div className="field-row" style={{ marginTop: 6 }}>
              <span>内晕宽度 ({shader.inner_band_width_px ?? 16}px)</span>
              <input
                type="range"
                min={4}
                max={42}
                step={1}
                value={shader.inner_band_width_px ?? 16}
                onChange={(e) => props.onPatchStyle({ border_shader: { inner_band_width_px: Number(e.target.value) } })}
              />
            </div>
            <div className="field-row" style={{ marginTop: 4 }}>
              <span>内晕不透明度 ({(shader.inner_band_opacity ?? 0.42).toFixed(2)})</span>
              <input
                type="range"
                min={0.1}
                max={0.95}
                step={0.05}
                value={shader.inner_band_opacity ?? 0.42}
                onChange={(e) => props.onPatchStyle({ border_shader: { inner_band_opacity: Number(e.target.value) } })}
              />
            </div>
          </>
        )}
        {shader.mode === "occupation_hatch_frontline" && (
          <>
            <div className="field-row" style={{ marginTop: 6 }}>
              <span>斜线倾角 ({shader.hatch_angle_deg ?? 45}°)</span>
              <input
                type="range"
                min={0}
                max={180}
                step={5}
                value={shader.hatch_angle_deg ?? 45}
                onChange={(e) => props.onPatchStyle({ border_shader: { hatch_angle_deg: Number(e.target.value) } })}
              />
            </div>
            <div className="field-row" style={{ marginTop: 4 }}>
              <span>斜线间距 ({shader.hatch_spacing_px ?? 9}px)</span>
              <input
                type="range"
                min={4}
                max={24}
                step={1}
                value={shader.hatch_spacing_px ?? 9}
                onChange={(e) => props.onPatchStyle({ border_shader: { hatch_spacing_px: Number(e.target.value) } })}
              />
            </div>
          </>
        )}
        {shader.mode === "multi_tier_ink" && (
          <div className="field-row" style={{ marginTop: 6 }}>
            <span>省/府/县线宽</span>
            <input
              type="range"
              min={1.0}
              max={4.5}
              step={0.2}
              value={adminWidths[0]}
              onChange={(e) => {
                const topW = Number(e.target.value);
                props.onPatchStyle({
                  border_shader: {
                    admin_tier_widths_px: [topW, Number((topW * 0.65).toFixed(1)), Number((topW * 0.38).toFixed(1))],
                  },
                });
              }}
            />
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-title">专题叠加层与最低信源门槛</div>
        <select
          className="select-control"
          style={{ marginBottom: 8 }}
          value={layerConfig.min_credibility_filter ?? "T3_GENERAL_ENCYCLOPEDIA"}
          onChange={(e) =>
            props.onUpdateLayerConfig({
              ...layerConfig,
              min_credibility_filter: e.target.value as Exclude<CredibilityTier, "REJECTED_UNVERIFIED">,
            })
          }
        >
          {CREDIBILITY_FILTERS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
        {OVERLAY_OPTIONS.map((opt) => (
          <label key={opt.id} className="chip-row" style={{ fontSize: 12, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={layerConfig.enabled_overlays.includes(opt.id)}
              onChange={() => toggleOverlay(opt.id)}
            />
            {opt.label_zh}
          </label>
        ))}
      </div>

      <div className="panel-section">
        <div className="panel-title">
          <span>双语排版与避让质量</span>
          <span className="pill-badge">
            显示 {props.labelReport.placed.filter((p) => p.visible).length}/{props.labelReport.placed.length}
          </span>
        </div>
        <div className="field-row">
          <span>国号字体</span>
          <select
            className="select-control"
            style={{ width: 175 }}
            value={typo.polity_font}
            onChange={(e) => props.onPatchStyle({ typography: { polity_font: e.target.value } })}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row" style={{ marginTop: 6 }}>
          <span>城市字体</span>
          <select
            className="select-control"
            style={{ width: 175 }}
            value={typo.city_font}
            onChange={(e) => props.onPatchStyle({ typography: { city_font: e.target.value } })}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row" style={{ marginTop: 6 }}>
          <span>双语排版</span>
          <select
            className="select-control"
            style={{ width: 140 }}
            value={typo.bilingual_mode}
            onChange={(e) =>
              props.onPatchStyle({
                typography: { bilingual_mode: e.target.value as ComposableStylePack["typography"]["bilingual_mode"] },
              })
            }
          >
            <option value="STACKED">双行堆叠 (STACKED)</option>
            <option value="INLINE">单行括号 (INLINE)</option>
            <option value="NONE">仅中文 (NONE)</option>
          </select>
        </div>
        <div className="field-row" style={{ marginTop: 6 }}>
          <span>城市符包</span>
          <select
            className="select-control"
            style={{ width: 140 }}
            value={typo.city_symbol_pack}
            onChange={(e) =>
              props.onPatchStyle({
                typography: {
                  city_symbol_pack: e.target.value as ComposableStylePack["typography"]["city_symbol_pack"],
                },
              })
            }
          >
            <option value="PILL_BADGE">半透明圆角胶囊</option>
            <option value="BLUE_RING">现代蓝环白点</option>
            <option value="ANTIQUE_DOUBLE_RING">传统双圈城垣</option>
            <option value="YELLOW_SQUARE">战棋黄色方点</option>
          </select>
        </div>
        <div className="field-row" style={{ marginTop: 6 }}>
          <span>国号字距 ({typo.letter_spacing_em.toFixed(2)}em)</span>
          <input
            type="range"
            min={0}
            max={0.8}
            step={0.05}
            value={typo.letter_spacing_em}
            onChange={(e) => props.onPatchStyle({ typography: { letter_spacing_em: Number(e.target.value) } })}
          />
        </div>
        <div className="grid-two" style={{ marginTop: 6 }}>
          <label className="chip-row" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={typo.curved_along_spine}
              onChange={(e) => props.onPatchStyle({ typography: { curved_along_spine: e.target.checked } })}
            />
            沿中轴线弯曲
          </label>
          <label className="chip-row" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={typo.show_uncertainty_question_mark}
              onChange={(e) => props.onPatchStyle({ typography: { show_uncertainty_question_mark: e.target.checked } })}
            />
            存疑地名标「?」
          </label>
        </div>
      </div>
    </aside>
  );
}
