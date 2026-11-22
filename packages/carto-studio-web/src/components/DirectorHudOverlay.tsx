import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import type { AspectSafeAreaLayout } from "../core/director/recorder-and-hud.ts";

export interface DirectorHudOverlayProps {
  bundle: EpochSceneBundle;
  hudLayout: AspectSafeAreaLayout;
  enabledHudTypes: ReadonlySet<string>;
  showSafeGuides: boolean;
  polityColors: Record<string, string>;
}

export function DirectorHudOverlay(props: DirectorHudOverlayProps) {
  const { hudLayout } = props;
  const toPctX = (px: number): string => `${((px / hudLayout.canvas_width) * 100).toFixed(2)}%`;
  const toPctY = (py: number): string => `${((py / hudLayout.canvas_height) * 100).toFixed(2)}%`;

  return (
    <div className="hud-layer" aria-label="影视级 HUD 挂件叠加层">
      {props.showSafeGuides &&
        hudLayout.restricted_zones.map((zone) => (
          <div
            key={zone.id}
            className="hud-safe-zone-guide"
            style={{
              left: toPctX(zone.bbox.x),
              top: toPctY(zone.bbox.y),
              width: toPctX(zone.bbox.width),
              height: toPctY(zone.bbox.height),
            }}
          >
            {zone.label_zh}
          </div>
        ))}

      {hudLayout.placed_widgets.map((placed) => {
        const { widget } = placed;
        if (!placed.visible_at_time || !props.enabledHudTypes.has(widget.type)) {
          return null;
        }
        const style: React.CSSProperties = {
          left: toPctX(placed.bbox.x),
          top: toPctY(placed.bbox.y),
          maxWidth: toPctX(placed.bbox.width),
        };
        const violClass = placed.in_safe_area ? "" : "violated";

        if (widget.type === "DATE_ERA_BADGE") {
          return (
            <div key={widget.widget_id} className={`hud-widget ${violClass}`} style={style}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fbbf24" }}>
                {props.bundle.historical_year_display}
              </div>
              <div style={{ fontSize: 10, color: "#cbd5e1" }}>{props.bundle.calendar_era_note}</div>
            </div>
          );
        }

        if (widget.type === "FIGURE_PORTRAIT_PIN") {
          const fig = props.bundle.figures[0];
          const label = fig?.name_zh ?? (widget.data_binding.label as string | undefined) ?? "历史人物";
          return (
            <div
              key={widget.widget_id}
              className={`hud-widget ${violClass}`}
              style={{ ...style, borderColor: "#b45309", background: "rgba(120, 53, 15, 0.9)" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: fig?.accent_hex ?? "#d97706",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    border: "1.5px solid #fde68a",
                  }}
                >
                  {fig?.portrait_monogram ?? "史"}
                </span>
                <div>
                  <div style={{ fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 10, color: "#fde68a" }}>{fig?.title ?? "地图坐标立绘钉"}</div>
                </div>
              </div>
            </div>
          );
        }

        if (widget.type === "COALITION_ROSTER_SIDEBAR") {
          return (
            <div key={widget.widget_id} className={`hud-widget ${violClass}`} style={style}>
              <div style={{ fontWeight: 700, marginBottom: placed.collapsed_for_vertical ? 0 : 4 }}>
                {placed.collapsed_for_vertical ? "参战阵营 (竖屏折叠)" : "参战阵营花名册"}
              </div>
              {!placed.collapsed_for_vertical && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {props.bundle.snapshot.territories.features
                    .slice(0, 4)
                    .map((f) => {
                      const pid = f.properties.polity_id ?? f.properties.face_id;
                      const meta = props.bundle.polities.find((p) => p.polity_id === pid);
                      return (
                        <div key={f.properties.face_id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
                          <span className="swatch-dot" style={{ background: props.polityColors[pid] ?? "#64748b" }} />
                          <span>{meta?.name_zh ?? pid}</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        }

        if (widget.type === "POLITY_DASHBOARD_PANEL") {
          const primaryPolity = props.bundle.polities.find((p) =>
            props.bundle.snapshot.territories.features.some((f) => f.properties.polity_id === p.polity_id),
          );
          return (
            <div key={widget.widget_id} className={`hud-widget ${violClass}`} style={style}>
              <div style={{ fontWeight: 700, color: "#7dd3fc" }}>
                {primaryPolity?.name_zh ?? "政权仪表盘"}
              </div>
              {!placed.collapsed_for_vertical && (
                <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 2 }}>
                  君主：{primaryPolity?.monarch_name ?? "—"} · 纪年：{primaryPolity?.era_label ?? "—"}
                </div>
              )}
            </div>
          );
        }

        if (widget.type === "CHRONICLE_TEXT_OVERLAY") {
          const ev = props.bundle.events[0];
          return (
            <div key={widget.widget_id} className={`hud-widget ${violClass}`} style={style}>
              <div style={{ fontWeight: 700, color: "#e2e8f0" }}>
                {placed.collapsed_for_vertical ? `史记: ${ev?.title.slice(0, 16) ?? "编年摘要"}` : "海面编年史专栏"}
              </div>
              {!placed.collapsed_for_vertical && (
                <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 3 }}>
                  {ev?.summary ?? "按共享弧段与 T1 文献构建之历史地理专栏。"}
                </div>
              )}
            </div>
          );
        }

        if (widget.type === "SUBTITLE_BAR") {
          const text =
            (widget.data_binding.text as string | undefined)
            ?? props.bundle.events[0]?.summary
            ?? "";
          return (
            <div
              key={widget.widget_id}
              className={`hud-widget ${violClass}`}
              style={{
                ...style,
                width: toPctX(placed.bbox.width),
                textAlign: "center",
                fontSize: 13,
                fontWeight: 600,
                background: "rgba(9, 13, 20, 0.88)",
              }}
            >
              {text}
            </div>
          );
        }

        return (
          <div key={widget.widget_id} className={`hud-widget ${violClass}`} style={style}>
            <div style={{ fontWeight: 700, fontSize: 10, color: "#38bdf8" }}>PIP 画中画局部战区</div>
            <div style={{ fontSize: 10, color: "#cbd5e1" }}>
              {(widget.data_binding.focus_label as string | undefined) ?? "关键局部"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
