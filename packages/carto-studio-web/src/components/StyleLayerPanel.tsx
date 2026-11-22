import type {
  BasemapId,
  BorderShaderMode,
  ComposableStylePack,
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
  { id: "physical_paleo_geo", label_zh: "古水系/丝绸之路覆写层" },
];

export function StyleLayerPanel(props: StyleLayerPanelProps) {
  const { resolvedStyle, layerConfig } = props;

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
        <h3 className="panel-title">
          <span>10 套可继承风格预设</span>
          {resolvedStyle.extends_style_id && (
            <small style={{ color: "#38bdf8", fontWeight: 500 }}>
              继承自 {resolvedStyle.extends_style_id}
            </small>
          )}
        </h3>
        <div className="preset-grid">
          {FLAGSHIP_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.style_id}
              type="button"
              className={`preset-card ${props.activeStyleId === preset.style_id ? "selected" : ""}`}
              onClick={() => props.onSelectStylePreset(preset.style_id)}
            >
              <div>{preset.display_name}</div>
              <small>{preset.basemap.basemap_id}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <h3 className="panel-title">基础底图矩阵 (7 类解耦底图)</h3>
        <select
          aria-label="选择基础底图"
          className="studio-select"
          value={resolvedStyle.basemap.basemap_id}
          onChange={(e) => props.onPatchStyle({ basemap: { basemap_id: e.target.value as BasemapId } })}
        >
          {BASEMAP_CATALOG.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label_zh} ({b.id})
            </option>
          ))}
        </select>

        <label style={{ fontSize: 11, color: "#cbd5e1", display: "flex", justifyContent: "space-between" }}>
          <span>去色度 ({Math.round(resolvedStyle.basemap.desaturation * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={resolvedStyle.basemap.desaturation}
            onChange={(e) => props.onPatchStyle({ basemap: { desaturation: Number(e.target.value) } })}
          />
        </label>

        <label style={{ fontSize: 11, color: "#cbd5e1", display: "flex", justifyContent: "space-between" }}>
          <span>山体阴影夸张度 ({resolvedStyle.basemap.hillshade_exaggeration.toFixed(2)})</span>
          <input
            type="range"
            min={0}
            max={1.2}
            step={0.05}
            value={resolvedStyle.basemap.hillshade_exaggeration}
            onChange={(e) => props.onPatchStyle({ basemap: { hillshade_exaggeration: Number(e.target.value) } })}
          />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={resolvedStyle.basemap.show_graticule_grid}
              onChange={(e) => props.onPatchStyle({ basemap: { show_graticule_grid: e.target.checked } })}
            />
            经纬网
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={resolvedStyle.basemap.show_modern_overlay}
              onChange={(e) => props.onPatchStyle({ basemap: { show_modern_overlay: e.target.checked } })}
            />
            现今省界/国界参照
          </label>
        </div>
      </div>

      <div className="panel-section">
        <h3 className="panel-title">6 种边界着色器 (WebGL / Shader)</h3>
        <select
          aria-label="选择边界着色器"
          className="studio-select"
          value={resolvedStyle.border_shader.mode}
          onChange={(e) =>
            props.onPatchStyle({ border_shader: { mode: e.target.value as BorderShaderMode } })
          }
        >
          {BORDER_SHADER_CATALOG.map((s) => (
            <option key={s.mode} value={s.mode}>
              {s.label_zh} ({s.mode})
            </option>
          ))}
        </select>

        <label style={{ fontSize: 11, color: "#cbd5e1", display: "flex", justifyContent: "space-between" }}>
          <span>外描边宽度 ({resolvedStyle.border_shader.outer_stroke_width_px.toFixed(1)}px)</span>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={resolvedStyle.border_shader.outer_stroke_width_px}
            onChange={(e) =>
              props.onPatchStyle({ border_shader: { outer_stroke_width_px: Number(e.target.value) } })
            }
          />
        </label>

        {layerConfig.base_mode === "CONTROL_INTENSITY" && (
          <select
            aria-label="控制力可视化模式"
            className="studio-select"
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
            <option value="OPACITY_GRADIENT">透明梯度 (OPACITY_GRADIENT)</option>
            <option value="COLOR_RAMP">饱和度色阶 (COLOR_RAMP)</option>
            <option value="CLOSED_ISOPLETH_CONTOURS">嵌套闭合等值线</option>
          </select>
        )}
      </div>

      <div className="panel-section">
        <h3 className="panel-title">专题图层叠加 (Layer Compositor)</h3>
        {OVERLAY_OPTIONS.map((opt) => (
          <label key={opt.id} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={layerConfig.enabled_overlays.includes(opt.id)}
              onChange={() => toggleOverlay(opt.id)}
            />
            <span>{opt.label_zh}</span>
          </label>
        ))}
      </div>

      <div className="panel-section">
        <h3 className="panel-title">
          <span>排版、4 套城标与 G5 碰撞避让</span>
          <span className={`badge-pill ${props.labelReport.high_priority_collision_count === 0 ? "badge-t1" : "badge-error"}`}>
            高优冲突 {props.labelReport.high_priority_collision_count}
          </span>
        </h3>
        <select
          aria-label="城市符号包"
          className="studio-select"
          value={resolvedStyle.typography.city_symbol_pack}
          onChange={(e) =>
            props.onPatchStyle({
              typography: {
                city_symbol_pack: e.target.value as ComposableStylePack["typography"]["city_symbol_pack"],
              },
            })
          }
        >
          <option value="PILL_BADGE">胶囊徽章 (PILL_BADGE)</option>
          <option value="BLUE_RING">蓝白同心圆 (BLUE_RING)</option>
          <option value="ANTIQUE_DOUBLE_RING">古图双环遗址 (ANTIQUE_DOUBLE_RING)</option>
          <option value="YELLOW_SQUARE">明清黄方框府城 (YELLOW_SQUARE)</option>
        </select>

        <select
          aria-label="双语地名排版"
          className="studio-select"
          value={resolvedStyle.typography.bilingual_mode}
          onChange={(e) =>
            props.onPatchStyle({
              typography: {
                bilingual_mode: e.target.value as ComposableStylePack["typography"]["bilingual_mode"],
              },
            })
          }
        >
          <option value="NONE">仅中文地名</option>
          <option value="STACKED">中/原语种堆叠 (STACKED)</option>
          <option value="INLINE">中/原语种同行 (INLINE)</option>
        </select>

        <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={resolvedStyle.typography.show_uncertainty_question_mark}
            onChange={(e) =>
              props.onPatchStyle({ typography: { show_uncertainty_question_mark: e.target.checked } })
            }
          />
          <span>存疑/模糊位置自动标注问号 (?)</span>
        </label>
      </div>
    </aside>
  );
}
