import { useEffect, useRef, useState } from "react";
import type { ComposableStylePack, MapSnapshot } from "@historical-cartography/shared-schema";
import type { Position } from "geojson";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import type { AspectSafeAreaLayout } from "../core/director/recorder-and-hud.ts";
import { resolveHudPresetTheme } from "../core/styles/style-presets.ts";
import { FigurePortraitSvg } from "./FigurePortraitSvg.tsx";
import { PipMiniMap } from "./PipMiniMap.tsx";

export interface DirectorHudOverlayProps {
  bundle: EpochSceneBundle;
  displaySnapshot: MapSnapshot;
  stylePack: ComposableStylePack;
  hudLayout: AspectSafeAreaLayout;
  enabledHudTypes: ReadonlySet<string>;
  showSafeGuides: boolean;
  polityColors: Record<string, string>;
  camera: { center: [number, number]; zoom: number };
  selectedPolityId?: string | undefined;
  spotlightPolityId?: string | undefined;
  projectCoord?: (lonLat: [number, number]) => [number, number];
  liveMoveTick?: number;
  onMoveWidget?: (widgetId: string, pos: { x_pct: number; y_pct: number }) => void;
}

function approximateRingAreaKm2(ring: readonly Position[]): number {
  if (ring.length < 4) return 0;
  let avgLat = 0;
  for (const p of ring) avgLat += p[1] ?? 0;
  avgLat /= ring.length;
  const kmLat = 111.132;
  const kmLon = 111.32 * Math.max(0.15, Math.cos((avgLat * Math.PI) / 180));
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    area += (a[0] ?? 0) * kmLon * ((b[1] ?? 0) * kmLat) - (b[0] ?? 0) * kmLon * ((a[1] ?? 0) * kmLat);
  }
  return Math.abs(area) * 0.5;
}

export function DirectorHudOverlay(props: DirectorHudOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<{
    widgetId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const { hudLayout, stylePack } = props;
  const theme = resolveHudPresetTheme(stylePack);
  const toPctX = (px: number): string => `${((px / hudLayout.canvas_width) * 100).toFixed(2)}%`;
  const toPctY = (py: number): string => `${((py / hudLayout.canvas_height) * 100).toFixed(2)}%`;

  useEffect(() => {
    if (!dragging || !props.onMoveWidget) return;
    const onMove = (e: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const dxPct = ((e.clientX - dragging.startClientX) / rect.width) * 100;
      const dyPct = ((e.clientY - dragging.startClientY) / rect.height) * 100;
      props.onMoveWidget?.(dragging.widgetId, {
        x_pct: Number(Math.max(1, Math.min(82, dragging.origX + dxPct)).toFixed(2)),
        y_pct: Number(Math.max(1, Math.min(86, dragging.origY + dyPct)).toFixed(2)),
      });
    };
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, props.onMoveWidget]);

  const startWidgetDrag = (e: React.PointerEvent, widgetId: string, xPx: number, yPx: number) => {
    if (!props.onMoveWidget) return;
    e.stopPropagation();
    setDragging({
      widgetId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: (xPx / hudLayout.canvas_width) * 100,
      origY: (yPx / hudLayout.canvas_height) * 100,
    });
  };

  return (
    <div ref={containerRef} className="hud-layer" aria-label="影视级 HUD 挂件叠加层" data-frame={props.liveMoveTick ?? 0}>
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
        const { widget, bbox } = placed;
        if (!placed.visible_at_time || !props.enabledHudTypes.has(widget.type)) return null;

        if (widget.type === "DATE_ERA_BADGE") {
          const isFloatingSerif = theme.date_badge_style === "floating_serif";
          const isGoldSeal = theme.date_badge_style === "gold_seal";
          const compactVert = hudLayout.aspect_ratio === "9:16";
          return (
            <div
              key={widget.widget_id}
              onPointerDown={(e) => startWidgetDrag(e, widget.widget_id, bbox.x, bbox.y)}
              className={`hud-widget ${props.onMoveWidget ? "hud-draggable" : ""}`}
              style={{
                left: toPctX(bbox.x),
                top: toPctY(bbox.y),
                width: toPctX(bbox.width),
                minHeight: compactVert ? undefined : toPctY(bbox.height),
                padding: isFloatingSerif ? "3px 6px" : compactVert ? "4px 8px" : "8px 12px",
                background: isFloatingSerif
                  ? "transparent"
                  : isGoldSeal
                    ? "linear-gradient(135deg, rgba(22, 16, 8, 0.94), rgba(45, 32, 12, 0.92))"
                    : "rgba(15, 23, 42, 0.88)",
                border: isFloatingSerif
                  ? "none"
                  : isGoldSeal
                    ? "1.5px solid #d4af37"
                    : "1px solid rgba(148, 163, 184, 0.35)",
                borderLeft: isFloatingSerif ? "none" : isGoldSeal ? "4px solid #f59e0b" : "4px solid #38bdf8",
                borderRadius: isGoldSeal ? 4 : 7,
              }}
            >
              <div
                style={{
                  fontFamily: stylePack.typography.polity_font,
                  fontSize: compactVert ? 14 : 19,
                  fontWeight: 700,
                  lineHeight: 1.15,
                  color: isFloatingSerif ? "#0f172a" : isGoldSeal ? "#fde68a" : "#f8fafc",
                  textShadow: isFloatingSerif ? "0 1px 2px rgba(255,255,255,0.9)" : undefined,
                  whiteSpace: "nowrap",
                }}
              >
                {props.bundle.historical_year_display}
              </div>
              <div
                style={{
                  fontSize: compactVert ? 10 : 11.5,
                  fontWeight: 600,
                  color: isFloatingSerif ? "#b91c1c" : isGoldSeal ? "#f59e0b" : "#93c5fd",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {compactVert
                  ? props.bundle.calendar_era_note
                  : `${props.bundle.calendar_era_note} · ${props.bundle.epoch_label_zh}`}
              </div>
            </div>
          );
        }

        if (widget.type === "FIGURE_PORTRAIT_PIN") {
          const positionedFigs = props.bundle.figures.filter((f) => Boolean(f.coordinates));
          if (positionedFigs.length === 0) return null;
          return positionedFigs.map((fig) => {
            const coords = fig.coordinates!;
            const [sx, sy] = props.projectCoord ? props.projectCoord(coords) : [bbox.x, bbox.y];
            const rect = containerRef.current?.getBoundingClientRect();
            const cW = rect?.width || hudLayout.canvas_width;
            const cH = rect?.height || hudLayout.canvas_height;
            const compactPins = cW < 1160 || cH < 500;
            const leftPct = Math.max(8, Math.min(92, (sx / cW) * 100));
            const topPct = Math.max(10, Math.min(82, (sy / cH) * 100));
            return (
              <div
                key={`pin-${fig.figure_id}`}
                style={{
                  position: "absolute",
                  left: `${leftPct.toFixed(2)}%`,
                  top: `${topPct.toFixed(2)}%`,
                  transform: "translate(-50%, -100%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  pointerEvents: "none",
                  zIndex: 14,
                }}
              >
                <div
                  style={{
                    fontSize: compactPins ? 9 : 10,
                    fontWeight: 700,
                    padding: compactPins ? "1px 5px" : "2px 8px",
                    marginBottom: compactPins ? 2 : 3,
                    borderRadius: 4,
                    background: "linear-gradient(90deg, #b91c1c, #7f1d1d)",
                    border: "1px solid #fbbf24",
                    color: "#fef3c7",
                    whiteSpace: "nowrap",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
                  }}
                >
                  {fig.name_zh}
                </div>
                <FigurePortraitSvg
                  name={fig.name_zh}
                  monogram={fig.portrait_monogram}
                  accentHex={fig.accent_hex}
                  portraitStyle={fig.portrait_style}
                  variant={theme.figure_pin_style}
                  size={compactPins ? 28 : 40}
                />
                <span style={{ width: 2, height: compactPins ? 5 : 9, background: "#fbbf24" }} />
                <span style={{ width: compactPins ? 5 : 7, height: compactPins ? 5 : 7, borderRadius: "50%", background: "#dc2626", border: "1.5px solid #fff" }} />
              </div>
            );
          });
        }

        if (widget.type === "COALITION_ROSTER_SIDEBAR") {
          const sides = props.bundle.coalition_sides;
          const isParchment = theme.roster_style === "parchment_gold";
          if (placed.collapsed_for_vertical) {
            return (
              <div
                key={widget.widget_id}
                className="hud-widget"
                style={{
                  left: toPctX(bbox.x),
                  top: toPctY(bbox.y),
                  width: toPctX(bbox.width),
                  padding: "6px 10px",
                  background: isParchment ? "rgba(250, 240, 212, 0.94)" : "rgba(15, 23, 42, 0.9)",
                  color: isParchment ? "#1c1917" : "#f8fafc",
                  fontSize: 11,
                }}
              >
                <strong>参战方：</strong>
                {sides
                  ? sides.map((s) => `${s.title_zh}(${s.members.length})`).join(" vs ")
                  : props.bundle.polities.slice(0, 3).map((p) => p.name_zh).join(" · ")}
              </div>
            );
          }

          return (
            <div
              key={widget.widget_id}
              onPointerDown={(e) => startWidgetDrag(e, widget.widget_id, bbox.x, bbox.y)}
              className={`hud-widget ${props.onMoveWidget ? "hud-draggable" : ""}`}
              style={{
                left: toPctX(bbox.x),
                top: toPctY(bbox.y),
                width: toPctX(bbox.width),
                maxHeight: toPctY(Math.max(240, hudLayout.canvas_height * 0.68)),
                overflowY: "auto",
                padding: "10px 11px",
                background: isParchment ? "rgba(250, 240, 212, 0.96)" : "rgba(15, 23, 42, 0.9)",
                border: isParchment ? "2px solid #92400e" : "1px solid rgba(148, 163, 184, 0.3)",
                color: isParchment ? "#1c1917" : "#f8fafc",
                fontSize: 11,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8, borderBottom: "1px solid currentColor", paddingBottom: 4 }}>
                {props.bundle.historical_year_display} · 交战/政权阵营档案
              </div>
              {sides && sides.length > 0 ? (
                sides.map((side, idx) => (
                  <div key={`${side.title_en}-${idx}`} style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, color: side.accent_hex }}>{side.title_zh}</div>
                    <div style={{ fontSize: 10, opacity: 0.78, marginBottom: 4 }}>{side.title_en}</div>
                    {side.swatch_ramp && (
                      <div style={{ display: "flex", gap: 2, marginBottom: 5 }}>
                        {side.swatch_ramp.map((c) => (
                          <span key={c} style={{ flex: 1, height: 5, background: c, borderRadius: 1 }} />
                        ))}
                      </div>
                    )}
                    {side.members.map((m) => (
                      <div key={m.name_zh} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <FigurePortraitSvg
                          name={m.commander ?? m.name_zh}
                          monogram={m.emblem ?? m.name_zh.slice(0, 1)}
                          accentHex={side.accent_hex}
                          portraitStyle={m.portrait_style}
                          variant="portrait_medallion"
                          size={22}
                        />
                        <div style={{ lineHeight: 1.2 }}>
                          <div style={{ fontWeight: 600 }}>{m.name_zh}</div>
                          <div style={{ fontSize: 9.5, opacity: 0.75 }}>{m.name_orig}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                props.bundle.polities.map((pol) => (
                  <div key={pol.polity_id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span
                      style={{
                        width: 11,
                        height: 11,
                        borderRadius: "50%",
                        background: props.polityColors[pol.polity_id] ?? pol.preferred_hex,
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 600 }}>{pol.name_zh}</div>
                      <div style={{ fontSize: 9.5, opacity: 0.75 }}>{pol.monarch_name} · {pol.era_label}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        }

        if (widget.type === "POLITY_DASHBOARD_PANEL") {
          const pid =
            (widget.data_binding.polity_id as string | undefined)
            ?? props.spotlightPolityId
            ?? props.selectedPolityId
            ?? props.bundle.polities[0]?.polity_id;
          const pol = props.bundle.polities.find((p) => p.polity_id === pid) ?? props.bundle.polities[0];
          if (!pol) return null;
          const faces = props.displaySnapshot.territories.features.filter((f) => f.properties.polity_id === pol.polity_id);
          const areaKm2 = faces.reduce((sum, f) => sum + approximateRingAreaKm2(f.geometry.coordinates[0] ?? []), 0);
          const avgCtrl = faces.length > 0
            ? faces.reduce((s, f) => s + f.properties.control_score, 0) / faces.length
            : 80;
          const capital = props.bundle.toponyms.find((t) => t.toponym_id === pol.capital_toponym_id)?.name_zh ?? "—";
          return (
            <div
              key={widget.widget_id}
              onPointerDown={(e) => startWidgetDrag(e, widget.widget_id, bbox.x, bbox.y)}
              className={`hud-widget ${props.onMoveWidget ? "hud-draggable" : ""}`}
              style={{
                left: toPctX(bbox.x),
                top: toPctY(bbox.y),
                width: toPctX(bbox.width),
                minHeight: toPctY(bbox.height),
                padding: "9px 11px",
                background: "rgba(15, 23, 42, 0.88)",
                border: `1px solid ${props.polityColors[pol.polity_id] ?? pol.preferred_hex}`,
                fontSize: 11,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: 13 }}>
                <span>{pol.emblem_symbol ?? "⚑"} {pol.name_zh}</span>
                <span style={{ color: "#fbbf24", fontSize: 10 }}>{pol.era_label}</span>
              </div>
              <div style={{ color: "#cbd5e1", marginTop: 4 }}>
                君主：{pol.monarch_name} · 都城：{capital}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10.5, color: "#93c5fd" }}>
                <span>控制疆域：{(areaKm2 / 10000).toFixed(1)} 万 km²</span>
                <span>均控度：{avgCtrl.toFixed(0)}%</span>
              </div>
              <div style={{ marginTop: 4, height: 5, borderRadius: 99, background: "rgba(148,163,184,0.22)", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, avgCtrl).toFixed(0)}%`, height: "100%", background: props.polityColors[pol.polity_id] ?? pol.preferred_hex }} />
              </div>
            </div>
          );
        }

        if (widget.type === "CHRONICLE_TEXT_OVERLAY") {
          const notes = props.bundle.chronicle_notes;
          if (!notes) return null;
          const isFloating = theme.chronicle_style === "floating_ink";
          return (
            <div
              key={widget.widget_id}
              onPointerDown={(e) => startWidgetDrag(e, widget.widget_id, bbox.x, bbox.y)}
              className={`hud-widget ${props.onMoveWidget ? "hud-draggable" : ""}`}
              style={{
                left: toPctX(bbox.x),
                top: toPctY(bbox.y),
                width: toPctX(bbox.width),
                maxHeight: placed.collapsed_for_vertical ? toPctY(bbox.height) : undefined,
                overflow: placed.collapsed_for_vertical ? "hidden" : undefined,
                padding: placed.collapsed_for_vertical ? "5px 8px" : "9px 11px",
                background: isFloating ? "rgba(255, 252, 244, 0.86)" : "rgba(15, 23, 42, 0.84)",
                border: isFloating ? "1px solid rgba(146, 64, 14, 0.35)" : "1px solid rgba(148,163,184,0.28)",
                color: isFloating ? "#1e293b" : "#f8fafc",
                fontSize: placed.collapsed_for_vertical ? 10 : 11,
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: placed.collapsed_for_vertical ? 11.5 : 13, marginBottom: 3 }}>{notes.heading}</div>
              {(placed.collapsed_for_vertical ? notes.paragraphs.slice(0, 1) : notes.paragraphs).map((p, idx) => (
                <p key={idx} style={{ margin: "2px 0" }}>
                  {p}
                </p>
              ))}
            </div>
          );
        }

        if (widget.type === "SUBTITLE_BAR") {
          const subtitleText =
            (widget.data_binding.text as string | undefined)
            || props.bundle.subtitle_default
            || props.bundle.events[0]?.summary
            || props.bundle.epoch_label_zh;
          const borderless = theme.subtitle_style === "borderless_stroke";
          return (
            <div
              key={widget.widget_id}
              onPointerDown={(e) => startWidgetDrag(e, widget.widget_id, bbox.x, bbox.y)}
              className={`hud-widget ${props.onMoveWidget ? "hud-draggable" : ""}`}
              style={{
                left: toPctX(bbox.x),
                top: toPctY(bbox.y),
                width: toPctX(bbox.width),
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: borderless ? "transparent" : "rgba(9, 13, 20, 0.86)",
                border: borderless ? "none" : "1px solid rgba(255,255,255,0.18)",
                padding: "6px 14px",
              }}
            >
              <span
                style={{
                  fontSize: placed.collapsed_for_vertical ? 13 : 16,
                  fontWeight: 700,
                  color: "#ffffff",
                  textShadow: "0 1px 4px #000, 0 0 8px rgba(0,0,0,0.85)",
                  textAlign: "center",
                }}
              >
                {subtitleText}
              </span>
            </div>
          );
        }

        if (widget.type === "PIP_INSET_MAP") {
          const insetLabel =
            (widget.data_binding.focus_label as string | undefined)
            ?? (widget.data_binding.label as string | undefined)
            ?? "战场局部放大";
          const center = widget.data_binding.center as [number, number] | undefined;
          const zoom = widget.data_binding.zoom as number | undefined;
          return (
            <div
              key={widget.widget_id}
              onPointerDown={(e) => startWidgetDrag(e, widget.widget_id, bbox.x, bbox.y)}
              className={`hud-widget ${props.onMoveWidget ? "hud-draggable" : ""}`}
              style={{
                left: toPctX(bbox.x),
                top: toPctY(bbox.y),
                width: toPctX(bbox.width),
                height: toPctY(bbox.height),
                padding: 0,
                overflow: "hidden",
                border: "1.5px solid rgba(148,163,184,0.55)",
              }}
            >
              <PipMiniMap
                label={insetLabel}
                snapshot={props.displaySnapshot}
                polityColors={props.polityColors}
                mainCamera={props.camera}
                insetFocus={{
                  ...(center ? { center } : {}),
                  ...(zoom ? { zoom } : {}),
                }}
                themeVariant={theme.pip_style}
              />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
