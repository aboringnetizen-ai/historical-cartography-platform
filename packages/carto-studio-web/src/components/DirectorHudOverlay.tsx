import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import type { AspectSafeAreaLayout } from "../core/director/recorder-and-hud.ts";

export interface DirectorHudOverlayProps {
  bundle: EpochSceneBundle;
  hudLayout: AspectSafeAreaLayout;
  enabledHudTypes: ReadonlySet<string>;
  showSafeGuides: boolean;
  polityColors: Record<string, string>;
  projectCoord?: (lonLat: [number, number]) => [number, number];
  liveMoveTick?: number;
}

export function DirectorHudOverlay(props: DirectorHudOverlayProps) {
  const { hudLayout } = props;
  const toPctX = (px: number): string => `${((px / hudLayout.canvas_width) * 100).toFixed(2)}%`;
  const toPctY = (py: number): string => `${((py / hudLayout.canvas_height) * 100).toFixed(2)}%`;

  const is1841 = props.bundle.epoch.epoch_id === "epoch-1841-qing-atlas";
  const is842 = props.bundle.epoch.epoch_id === "epoch-842-samanid";
  const is1672 = props.bundle.epoch.epoch_id === "epoch-1672-rampjaar";

  return (
    <div className="hud-layer" aria-label="影视级 HUD 挂件叠加层" data-frame={props.liveMoveTick ?? 0}>
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
          if (is1841) {
            return (
              <div
                key={widget.widget_id}
                className={`hud-widget ${violClass}`}
                style={{
                  left: "auto",
                  right: "2%",
                  top: "2.5%",
                  background: "rgba(255, 255, 255, 0.85)",
                  border: "1px solid rgba(15, 23, 42, 0.25)",
                  color: "#1e293b",
                  fontFamily: "Noto Serif SC, Songti SC, serif",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 800, color: "#1d4ed8" }}>
                  {props.bundle.historical_year_display}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#b91c1c" }}>
                  {props.bundle.calendar_era_note}
                </div>
              </div>
            );
          }
          if (is842) {
            return (
              <div
                key={widget.widget_id}
                className={`hud-widget ${violClass}`}
                style={{
                  ...style,
                  background: "linear-gradient(135deg, #27221b, #14120e)",
                  border: "2px solid #d4af37",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
                  padding: "6px 14px",
                }}
              >
                <div style={{ fontSize: 17, fontWeight: 800, color: "#fef3c7", letterSpacing: 1 }}>
                  {props.bundle.historical_year_display}
                </div>
              </div>
            );
          }
          if (is1672) {
            return (
              <div
                key={widget.widget_id}
                className={`hud-widget ${violClass}`}
                style={{
                  left: "1%",
                  top: "1.5%",
                  background: "#f5e6c4",
                  border: "2px solid #8b6914",
                  color: "#3b2810",
                  fontFamily: "Noto Serif SC, serif",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 800 }}>{props.bundle.historical_year_display}</div>
              </div>
            );
          }
          return (
            <div
              key={widget.widget_id}
              className={`hud-widget ${violClass}`}
              style={{
                ...style,
                background: "linear-gradient(135deg, rgba(30, 38, 52, 0.92), rgba(15, 21, 32, 0.95))",
                borderLeft: "4px solid #38bdf8",
                padding: "7px 14px",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: "#ffffff", letterSpacing: 0.5 }}>
                {props.bundle.historical_year_display}
              </div>
              <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>
                {props.bundle.calendar_era_note}
              </div>
            </div>
          );
        }

        // Render ALL figures pinned to their live geographic map coordinates at 60fps!
        if (widget.type === "FIGURE_PORTRAIT_PIN") {
          const figs = props.bundle.figures;
          if (figs.length === 0) return null;
          return (
            <div key={widget.widget_id} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              {figs.map((fig) => {
                const coord = fig.coordinates ?? widget.map_coordinates;
                if (!coord) return null;
                const [sx, sy] = props.projectCoord
                  ? props.projectCoord(coord)
                  : [placed.bbox.x, placed.bbox.y];

                if (is842) {
                  return (
                    <div
                      key={fig.figure_id}
                      className={`hud-widget ${violClass}`}
                      style={{
                        left: sx,
                        top: sy,
                        transform: "translate(-50%, -100%)",
                        background: "linear-gradient(180deg, #8b1e1e, #4a1212)",
                        border: "2px solid #eab308",
                        borderRadius: "6px 6px 24px 24px",
                        padding: "5px 10px 8px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#fde68a", marginBottom: 4 }}>
                        {fig.name_zh}
                      </div>
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          margin: "0 auto",
                          borderRadius: "50%",
                          background: fig.accent_hex,
                          border: "2px solid #fde68a",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 15,
                          fontWeight: 800,
                          color: "#fff",
                        }}
                      >
                        {fig.portrait_monogram}
                      </div>
                    </div>
                  );
                }

                const isHighlightEvent = fig.figure_id === "fig-mardavij";
                return (
                  <div
                    key={fig.figure_id}
                    className={`hud-widget ${violClass}`}
                    style={{
                      left: sx,
                      top: sy,
                      transform: "translate(-50%, -95%)",
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: "50%",
                        background: `radial-gradient(circle at 35% 30%, #f59e0b, ${fig.accent_hex})`,
                        border: "2.5px solid #fef3c7",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.55)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        fontWeight: 800,
                        color: "#fff",
                      }}
                    >
                      {fig.portrait_monogram}
                    </div>
                    <div
                      style={{
                        background: isHighlightEvent ? "rgba(180, 83, 9, 0.94)" : "rgba(15, 23, 42, 0.88)",
                        border: `1px solid ${isHighlightEvent ? "#fde68a" : "rgba(255,255,255,0.45)"}`,
                        color: "#ffffff",
                        padding: "1px 7px",
                        borderRadius: 4,
                        fontSize: 10.5,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fig.name_zh}
                    </div>
                    {isHighlightEvent && (
                      <div
                        style={{
                          background: "rgba(255, 255, 255, 0.95)",
                          color: "#1e293b",
                          padding: "1px 7px",
                          borderRadius: 4,
                          fontSize: 10.5,
                          fontWeight: 800,
                          whiteSpace: "nowrap",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                        }}
                      >
                        {fig.title}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        }

        if (widget.type === "COALITION_ROSTER_SIDEBAR") {
          const sides = props.bundle.coalition_sides;
          return (
            <div
              key={widget.widget_id}
              className={`hud-widget ${violClass}`}
              style={{
                left: placed.collapsed_for_vertical ? toPctX(placed.bbox.x) : "1%",
                top: placed.collapsed_for_vertical ? toPctY(placed.bbox.y) : "11%",
                bottom: placed.collapsed_for_vertical ? undefined : "4%",
                width: placed.collapsed_for_vertical ? toPctX(placed.bbox.width) : 215,
                background: "linear-gradient(180deg, #f3e2bc, #e9d2a2)",
                border: "2px solid #9a7426",
                color: "#2c1e0c",
                fontFamily: "Noto Serif SC, Songti SC, serif",
                overflowY: "auto",
              }}
            >
              {sides ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sides.map((side) => (
                    <div key={side.title_zh}>
                      <div
                        style={{
                          borderBottom: `2px solid ${side.accent_hex}`,
                          paddingBottom: 3,
                          marginBottom: 5,
                          fontWeight: 800,
                          fontSize: 12,
                        }}
                      >
                        <div>{side.title_zh}</div>
                        <div style={{ fontSize: 10, color: "#6b4f24" }}>{side.title_en}</div>
                      </div>
                      {!placed.collapsed_for_vertical && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {side.members.map((m) => (
                            <div key={m.name_zh} style={{ fontSize: 10.5, lineHeight: 1.3 }}>
                              <strong>· {m.name_zh}</strong>
                              <div style={{ color: "#574325", fontSize: 9.5, paddingLeft: 8 }}>
                                {m.name_orig} {m.commander ? `(${m.commander})` : ""}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontWeight: 700 }}>参战阵营名录</div>
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
          const notes = props.bundle.chronicle_notes;
          return (
            <div
              key={widget.widget_id}
              className={`hud-widget ${violClass}`}
              style={{
                left: placed.collapsed_for_vertical ? toPctX(placed.bbox.x) : "auto",
                right: placed.collapsed_for_vertical ? undefined : "2%",
                top: placed.collapsed_for_vertical ? toPctY(placed.bbox.y) : "20%",
                maxWidth: placed.collapsed_for_vertical ? toPctX(placed.bbox.width) : 230,
                background: is1841 ? "rgba(255, 255, 255, 0.86)" : "rgba(15, 23, 42, 0.85)",
                color: is1841 ? "#1e293b" : "#f8fafc",
                border: is1841 ? "1px solid rgba(15, 23, 42, 0.18)" : undefined,
                fontFamily: "Noto Serif SC, Songti SC, serif",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
                {notes?.heading ?? props.bundle.events[0]?.title ?? "编年史专栏"}
              </div>
              {!placed.collapsed_for_vertical && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5, lineHeight: 1.55 }}>
                  {(notes?.paragraphs ?? [props.bundle.events[0]?.summary ?? ""]).map((p, idx) => (
                    <div key={idx}>{p}</div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        if (widget.type === "SUBTITLE_BAR") {
          const text =
            props.bundle.subtitle_default
            ?? (widget.data_binding.text as string | undefined)
            ?? props.bundle.events[0]?.summary
            ?? "";
          return (
            <div
              key={widget.widget_id}
              className={`hud-widget ${violClass}`}
              style={{
                left: "50%",
                bottom: toPctY(hudLayout.canvas_height - (placed.bbox.y + placed.bbox.height)),
                transform: "translateX(-50%)",
                width: "auto",
                maxWidth: "82%",
                background: is842 ? "transparent" : "rgba(12, 16, 24, 0.78)",
                border: is842 ? "none" : "1px solid rgba(255,255,255,0.16)",
                boxShadow: is842 ? "none" : undefined,
                padding: is842 ? "2px 8px" : "5px 18px",
                textAlign: "center",
                fontSize: 17,
                fontWeight: 700,
                color: "#ffffff",
                textShadow: is842 ? "0 0 4px #000, 0 1px 4px #000" : "0 1px 2px rgba(0,0,0,0.8)",
                whiteSpace: "nowrap",
              }}
            >
              {text}
            </div>
          );
        }

        return (
          <div
            key={widget.widget_id}
            className={`hud-widget ${violClass}`}
            style={{
              left: placed.collapsed_for_vertical ? toPctX(placed.bbox.x) : "auto",
              right: placed.collapsed_for_vertical ? undefined : "20%",
              bottom: placed.collapsed_for_vertical ? undefined : "4%",
              top: placed.collapsed_for_vertical ? toPctY(placed.bbox.y) : undefined,
              width: 118,
              height: 92,
              background: "#c2dbf2",
              border: "2px solid #334155",
              color: "#0f172a",
              padding: 4,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 9.5 }}>南海诸岛附图</div>
            <div style={{ fontSize: 9, color: "#334155" }}>
              {(widget.data_binding.focus_label as string | undefined) ?? "画中画小地图"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
