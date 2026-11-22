import type {
  AdminUnit,
  ComposableStylePack,
  DirectorKeyframe,
  HistoricalToponym,
  LayerVisibilityConfig,
  MapSnapshot,
} from "@historical-cartography/shared-schema";
import type { Feature, LineString, Polygon, Position } from "geojson";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import type { TopologyTransitionPlan } from "../core/director/morph-engine.ts";
import type { PlacedToponymLabel } from "../core/layout/label-collision.ts";
import { computePolylabel } from "../core/layout/label-collision.ts";
import { resolveHudPresetTheme } from "../core/styles/style-presets.ts";

export interface SpineLabelFeature
  extends Feature<
    LineString,
    {
      polity_id: string;
      label_text: string;
      label_primary: string;
      label_secondary?: string;
      center: [number, number];
      letter_spacing_em: number;
      rank_weight: number;
    }
  > {}

export interface MorphVisualState {
  from_snapshot: MapSnapshot;
  to_snapshot: MapSnapshot;
  progress: number;
  plan: TopologyTransitionPlan;
  fallback: NonNullable<DirectorKeyframe["topology_change_fallback"]>;
}

export interface MapSvgOverlayProps {
  bundle: EpochSceneBundle;
  snapshot: MapSnapshot;
  stylePack: ComposableStylePack;
  layerConfig: LayerVisibilityConfig;
  polityColors: Record<string, string>;
  viewportSize: { width: number; height: number };
  liveZoom: number;
  basemapIsDark: boolean;
  webglFallback: boolean;
  spineLabels: SpineLabelFeature[];
  placedToponyms: PlacedToponymLabel[];
  affectedToponymIds: readonly string[];
  adminUnits: readonly AdminUnit[];
  paleoLabels?: Array<{ id: string; label_zh: string; feature_type: string; coords: [number, number] }>;
  morphVisual?: MorphVisualState | undefined;
  projectCoord: (lonLat: [number, number]) => [number, number];
  onSelectFace: (faceId: string, polityId?: string) => void;
  onSelectToponym: (toponym: HistoricalToponym) => void;
  onSelectEventId?: (eventId: string) => void;
}

function buildSmoothSvgPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
  if (pts.length === 2) {
    return `M ${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)} L ${pts[1]![0].toFixed(1)} ${pts[1]![1].toFixed(1)}`;
  }
  let d = `M ${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i]![0] + pts[i + 1]![0]) / 2;
    const midY = (pts[i]![1] + pts[i + 1]![1]) / 2;
    d += ` Q ${pts[i]![0].toFixed(1)} ${pts[i]![1].toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = pts[pts.length - 1]!;
  d += ` L ${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  return d;
}

export function MapSvgOverlay(props: MapSvgOverlayProps) {
  const hudTheme = resolveHudPresetTheme(props.stylePack);
  const darkLabels = props.basemapIsDark || hudTheme.prefer_light_map_label;
  const showEvents = props.layerConfig.enabled_overlays.includes("historical_events");
  const showAdmin = props.layerConfig.enabled_overlays.includes("admin_divisions");
  const affectedTopSet = new Set(props.affectedToponymIds);

  const graticuleTicks = props.stylePack.basemap.show_graticule_grid
    ? {
        lons: [-20, 0, 20, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140],
        lats: [10, 20, 30, 40, 50, 60],
      }
    : null;

  return (
    <>
      <svg
        width={props.viewportSize.width}
        height={props.viewportSize.height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}
      >
        <defs>
          <marker id="march-arrow-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#dc2626" stroke="#ffffff" strokeWidth="0.7" />
          </marker>
          <pattern id="svg-hatch-pattern" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="10" stroke="#dc2626" strokeWidth="3" strokeOpacity="0.48" />
          </pattern>
          {props.morphVisual && !props.morphVisual.plan.is_homeomorphic && props.morphVisual.fallback === "WIPE_MASK" && (
            <clipPath id="morph-wipe-clip">
              <rect
                x="0"
                y="0"
                width={Math.round(props.viewportSize.width * Math.max(0.02, Math.min(1, props.morphVisual.progress)))}
                height={props.viewportSize.height}
              />
            </clipPath>
          )}
          {props.spineLabels.map((feat) => {
            const pts = feat.geometry.coordinates.map((pt) => props.projectCoord([pt[0] ?? 0, pt[1] ?? 0]));
            if (pts.length < 3) return null;
            const d = `M ${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)} Q ${pts[1]![0].toFixed(1)} ${pts[1]![1].toFixed(1)} ${pts[2]![0].toFixed(1)} ${pts[2]![1].toFixed(1)}`;
            return <path key={feat.properties.polity_id} id={`spine-path-${feat.properties.polity_id}`} d={d} />;
          })}
        </defs>

        {/* Non-webgl structural SVG fallback */}
        {props.webglFallback &&
          props.snapshot.territories.features.map((feat) => {
            const ptsStr = (feat.geometry.coordinates[0] ?? [])
              .map((pt) => props.projectCoord([pt[0] ?? 0, pt[1] ?? 0]))
              .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
              .join(" ");
            const pid = feat.properties.polity_id ?? feat.properties.face_id;
            return (
              <polygon
                key={feat.properties.face_id}
                points={ptsStr}
                fill={props.polityColors[pid] ?? "#2dbd66"}
                fillOpacity={props.stylePack.territory_rendering.pure_mode_fill_opacity}
                stroke={props.stylePack.border_shader.outer_stroke_hex}
                strokeWidth={props.stylePack.border_shader.outer_stroke_width_px}
                style={{ pointerEvents: "auto", cursor: "pointer" }}
                onClick={() => props.onSelectFace(feat.properties.face_id, feat.properties.polity_id)}
              />
            );
          })}

        {/* Stage 2 fallback animation during topological split/merge transitions */}
        {props.morphVisual && !props.morphVisual.plan.is_homeomorphic && props.morphVisual.progress > 0 && props.morphVisual.progress < 1 && (
          <g
            clipPath={props.morphVisual.fallback === "WIPE_MASK" ? "url(#morph-wipe-clip)" : undefined}
            opacity={props.morphVisual.fallback === "CROSS_DISSOLVE" ? props.morphVisual.progress : 0.85}
          >
            {props.morphVisual.to_snapshot.territories.features.map((feat) => {
              const ring = feat.geometry.coordinates[0] ?? [];
              const ptsStr = ring
                .map((pt) => props.projectCoord([pt[0] ?? 0, pt[1] ?? 0]))
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(" ");
              const c = computePolylabel(ring).center;
              const [cx, cy] = props.projectCoord(c);
              return (
                <g key={`morph-${feat.properties.face_id}`}>
                  {props.morphVisual!.fallback === "OCCUPATION_RIPPLE" && (
                    <>
                      <polygon points={ptsStr} fill="url(#svg-hatch-pattern)" opacity={0.4 + 0.5 * props.morphVisual!.progress} />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={Math.max(12, props.morphVisual!.progress * 110)}
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth={2.5}
                        strokeOpacity={1 - props.morphVisual!.progress}
                      />
                    </>
                  )}
                  {props.morphVisual!.fallback === "WIPE_MASK" && (
                    <polygon points={ptsStr} fill={props.polityColors[feat.properties.polity_id ?? feat.properties.face_id] ?? "#ef4444"} fillOpacity={0.38} stroke="#fef08a" strokeWidth={2} />
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* Degree grid tick labels along viewport top & left borders */}
        {graticuleTicks && (
          <g>
            {graticuleTicks.lons.map((lon) => {
              const [sx] = props.projectCoord([lon, 35]);
              if (sx < 24 || sx > props.viewportSize.width - 24) return null;
              return (
                <text key={`lon-${lon}`} x={sx} y={13} fill={props.basemapIsDark ? "#94a3b8" : "#475569"} fontSize={9.5} fontWeight={600} textAnchor="middle">
                  {lon >= 0 ? `${lon}°E` : `${Math.abs(lon)}°W`}
                </text>
              );
            })}
            {graticuleTicks.lats.map((lat) => {
              const [, sy] = props.projectCoord([50, lat]);
              if (sy < 20 || sy > props.viewportSize.height - 20) return null;
              return (
                <text key={`lat-${lat}`} x={6} y={sy + 3} fill={props.basemapIsDark ? "#94a3b8" : "#475569"} fontSize={9.5} fontWeight={600}>
                  {lat}°N
                </text>
              );
            })}
          </g>
        )}

        {/* Figure historical routes & animated campaign arrows */}
        {showEvents &&
          props.bundle.figures.map((fig) => {
            if (!fig.route_points || fig.route_points.length < 2) return null;
            const d = buildSmoothSvgPath(fig.route_points.map((pt) => props.projectCoord(pt)));
            return (
              <path
                key={`fig-route-${fig.figure_id}`}
                d={d}
                fill="none"
                stroke={fig.accent_hex}
                strokeWidth={2}
                strokeDasharray="5 4"
                strokeOpacity={0.72}
              />
            );
          })}

        {showEvents &&
          props.bundle.marching_routes.map((route) => {
            const screenPts = route.coordinates.map((c) => props.projectCoord(c));
            if (screenPts.length < 2) return null;
            const d = buildSmoothSvgPath(screenPts);
            const bPt = route.battle_point ? props.projectCoord(route.battle_point) : null;
            return (
              <g key={`march-svg-${route.route_id}`}>
                <path d={d} fill="none" stroke="#ffffff" strokeWidth={5.2} strokeLinecap="round" strokeOpacity={0.82} />
                <path
                  d={d}
                  fill="none"
                  className="march-flow-line"
                  stroke={route.color_hex}
                  strokeWidth={3.2}
                  strokeLinecap="round"
                  markerEnd="url(#march-arrow-head)"
                />
                {bPt && (
                  <g
                    style={{ pointerEvents: "auto", cursor: "pointer" }}
                    onClick={() => props.onSelectEventId?.(route.hist_event_id)}
                  >
                    <circle className="battle-ripple-ring" cx={bPt[0]} cy={bPt[1]} r={12} fill="none" stroke="#ef4444" strokeWidth={2.2} />
                    <circle cx={bPt[0]} cy={bPt[1]} r={15} fill="none" stroke="#f59e0b" strokeWidth={1.6} strokeOpacity={0.72} />
                    <circle cx={bPt[0]} cy={bPt[1]} r={5.5} fill="#dc2626" stroke="#ffffff" strokeWidth={1.5} />
                  </g>
                )}
              </g>
            );
          })}

        {/* Water body annotations */}
        {(props.bundle.water_labels ?? []).map((wl) => {
          const [wx, wy] = props.projectCoord(wl.coordinates);
          return (
            <text
              key={wl.id}
              x={wx}
              y={wy}
              fill={props.basemapIsDark ? "#94a3b8" : "#ffffff"}
              stroke={props.basemapIsDark ? "none" : "rgba(59, 68, 130, 0.58)"}
              strokeWidth={2.2}
              paintOrder="stroke"
              fontFamily={props.stylePack.typography.polity_font}
              fontSize={wl.kind === "SEA" ? 18 : 13}
              fontWeight={600}
              letterSpacing="0.22em"
              textAnchor="middle"
            >
              {wl.name_zh}
            </text>
          );
        })}

        {/* Admin division district labels when admin_divisions overlay is ON */}
        {showAdmin &&
          props.adminUnits.map((unit) => {
            const seat = props.bundle.toponyms.find((t) => t.toponym_id === unit.seat_toponym_id);
            if (!seat) return null;
            const [ax, ay] = props.projectCoord([seat.coordinates[0], seat.coordinates[1] + 0.45]);
            return (
              <text
                key={`adm-lbl-${unit.admin_unit_id}`}
                x={ax}
                y={ay}
                fill={darkLabels ? "#e2e8f0" : "#334155"}
                stroke={darkLabels ? "rgba(15,23,42,0.75)" : "rgba(255,255,255,0.75)"}
                strokeWidth={2}
                paintOrder="stroke"
                fontFamily={props.stylePack.typography.city_font}
                fontSize={10.5}
                fontWeight={600}
                textAnchor="middle"
                opacity={0.86}
              >
                〔{unit.name_historical}〕
              </text>
            );
          })}

        {/* Paleo-geography, Silk Road & Ethnic Tribe annotations */}
        {(props.paleoLabels ?? []).map((item) => {
          const [px, py] = props.projectCoord(item.coords);
          const isTribe = item.feature_type === "ETHNIC_TRIBE";
          const isSilk = item.feature_type === "SILK_ROAD";
          const isHub = item.feature_type === "POPULATION_HUB";
          return (
            <text
              key={`paleo-lbl-${item.id}`}
              x={px}
              y={py}
              fill={isTribe ? "#78350f" : isSilk ? "#b45309" : isHub ? "#be123c" : "#1d4ed8"}
              stroke="rgba(255,255,255,0.82)"
              strokeWidth={2}
              paintOrder="stroke"
              fontFamily={props.stylePack.typography.polity_font}
              fontStyle={isTribe ? "italic" : "normal"}
              fontSize={isTribe ? 12.5 : 10.5}
              fontWeight={600}
              letterSpacing={isTribe ? "0.18em" : "0.06em"}
              textAnchor="middle"
            >
              {isHub ? `◉ ${item.label_zh}` : item.label_zh}
            </text>
          );
        })}

        {/* Polity main titles (adaptive viewport scaling, anti-clip curved fallback & safe viewport clamping) */}
        {props.spineLabels.map((feat) => {
          const vpW = Math.max(320, props.viewportSize.width);
          const vpH = Math.max(200, props.viewportSize.height);
          const vpScale = Math.max(0.56, Math.min(1.0, Math.min(vpW / 1280, vpH / 480)));
          const pts = feat.geometry.coordinates.map((pt) => props.projectCoord([pt[0] ?? 0, pt[1] ?? 0]));
          const [rawCx, rawCy] = props.projectCoord(feat.properties.center);
          const rankWeight = feat.properties.rank_weight ?? 200;
          const areaScale = Math.max(0.76, Math.min(1.06, 0.72 + Math.log10(Math.max(10, rankWeight)) * 0.12));
          const fontSize = Math.max(9.8, Math.min(22, (9.6 + props.liveZoom * 1.65) * areaScale * vpScale));

          const primaryText = feat.properties.label_primary;
          const baseSpacing = feat.properties.letter_spacing_em * vpScale;
          const compactEstW = primaryText.length * fontSize * 1.06;
          const halfW = compactEstW * 0.52;
          const safeLeft = 8;
          const safeRight = vpW - 8;
          const safeTop = vpH < 340 ? 16 : 22;
          const safeBottom = vpH - (vpH < 340 ? 44 : 58);

          const p0 = pts[0];
          const p1 = pts[1];
          const p2 = pts[2];
          const spinePxLen = p0 && p1 && p2
            ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
            : 0;
          const spacedGlyphPx = primaryText.length * fontSize * (1.06 + Math.max(0, baseSpacing));
          const endsInsideSafe = Boolean(
            p0
            && p2
            && p0[0] >= safeLeft + 10
            && p0[0] <= safeRight - 10
            && p2[0] >= safeLeft + 10
            && p2[0] <= safeRight - 10
            && p0[1] >= safeTop + fontSize * 0.7
            && p0[1] <= safeBottom - fontSize * 0.4
            && p2[1] >= safeTop + fontSize * 0.7
            && p2[1] <= safeBottom - fontSize * 0.4,
          );
          const canUseCurved =
            props.stylePack.typography.curved_along_spine
            && pts.length >= 3
            && endsInsideSafe
            && spinePxLen >= spacedGlyphPx * 1.38;

          // Compute projected polygon screen bounds for safe clamping in flat fallback
          let polyMinX = Infinity;
          let polyMaxX = -Infinity;
          let polyMinY = Infinity;
          let polyMaxY = -Infinity;
          for (const tf of props.snapshot.territories.features) {
            if ((tf.properties.polity_id ?? tf.properties.face_id) !== feat.properties.polity_id) continue;
            for (const c of tf.geometry.coordinates[0] ?? []) {
              const [px, py] = props.projectCoord([c[0] ?? 0, c[1] ?? 0]);
              if (px < polyMinX) polyMinX = px;
              if (px > polyMaxX) polyMaxX = px;
              if (py < polyMinY) polyMinY = py;
              if (py > polyMaxY) polyMaxY = py;
            }
          }
          if (
            Number.isFinite(polyMinX)
            && (polyMaxX < safeLeft + 8 || polyMinX > safeRight - 8 || polyMaxY < safeTop + 6 || polyMinY > safeBottom + 6)
          ) {
            return null;
          }

          let cx = rawCx;
          let cy = rawCy;
          if (!canUseCurved && Number.isFinite(polyMinX)) {
            const minClampX = safeLeft + halfW;
            const maxClampX = safeRight - halfW;
            if (minClampX <= maxClampX) {
              const visMinX = Math.max(minClampX, polyMinX + Math.min(halfW * 0.6, (polyMaxX - polyMinX) * 0.25));
              const visMaxX = Math.min(maxClampX, polyMaxX - Math.min(halfW * 0.6, (polyMaxX - polyMinX) * 0.25));
              cx = visMinX <= visMaxX
                ? Math.max(visMinX, Math.min(visMaxX, rawCx))
                : Math.max(minClampX, Math.min(maxClampX, rawCx));
            }
            const minClampY = safeTop + fontSize * 0.65;
            const maxClampY = safeBottom - fontSize * 0.45;
            if (minClampY <= maxClampY) {
              const visMinY = Math.max(minClampY, polyMinY + fontSize * 0.55);
              const visMaxY = Math.min(maxClampY, polyMaxY - fontSize * 0.35);
              cy = visMinY <= visMaxY
                ? Math.max(visMinY, Math.min(visMaxY, rawCy))
                : Math.max(minClampY, Math.min(maxClampY, rawCy));
            }
          }

          const effectiveSpacing = canUseCurved
            ? `${baseSpacing.toFixed(2)}em`
            : `${Math.min(0.06, baseSpacing).toFixed(2)}em`;

          const fillCol = darkLabels ? "#ffffff" : "#1f2937";
          const haloCol = darkLabels ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.88)";
          const secondary = feat.properties.label_secondary;

          return (
            <g
              key={`label-${feat.properties.polity_id}`}
              style={{ pointerEvents: "auto", cursor: "pointer" }}
              onClick={() => props.onSelectFace(`polity:${feat.properties.polity_id}`, feat.properties.polity_id)}
            >
              <text
                x={canUseCurved ? undefined : cx}
                y={canUseCurved ? undefined : cy}
                dy={canUseCurved ? undefined : "0.35em"}
                fill={fillCol}
                stroke={haloCol}
                strokeWidth={(darkLabels ? 3.8 : 2.6) * vpScale}
                paintOrder="stroke"
                fontFamily={props.stylePack.typography.polity_font}
                fontSize={fontSize}
                fontWeight={700}
                letterSpacing={effectiveSpacing}
                textAnchor="middle"
              >
                {canUseCurved ? (
                  <textPath href={`#spine-path-${feat.properties.polity_id}`} startOffset="50%">
                    {primaryText}
                  </textPath>
                ) : (
                  primaryText
                )}
              </text>
              {secondary && (
                <text
                  x={cx}
                  y={cy + fontSize * 1.02}
                  fill={fillCol}
                  stroke={haloCol}
                  strokeWidth={(darkLabels ? 3.0 : 2.0) * vpScale}
                  paintOrder="stroke"
                  fontFamily={props.stylePack.typography.polity_font}
                  fontSize={Math.max(9, fontSize * 0.6)}
                  fontWeight={600}
                  textAnchor="middle"
                >
                  {secondary}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* City Markers: 4 symbol packs + PILL_BADGE geographic dot + Diff highlight halo */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 8 }}>
        {props.placedToponyms
          .filter((item) => item.visible)
          .map((item) => {
            const top = props.bundle.toponyms.find((t) => t.toponym_id === item.toponym_id);
            if (!top) return null;
            const pack = props.stylePack.typography.city_symbol_pack;
            const isCap = item.entity_rank === "CAPITAL";
            const isAffected = affectedTopSet.has(top.toponym_id);
            return (
              <button
                key={item.toponym_id}
                type="button"
                onClick={() => props.onSelectToponym(top)}
                style={{
                  position: "absolute",
                  left: item.screen_x,
                  top: item.screen_y,
                  transform: "translate(-50%, -50%)",
                  pointerEvents: "auto",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <span
                  style={{
                    width: isCap ? 12 : pack === "PILL_BADGE" ? 7 : 9,
                    height: isCap ? 12 : pack === "PILL_BADGE" ? 7 : 9,
                    borderRadius: pack === "YELLOW_SQUARE" ? 1 : "50%",
                    background:
                      pack === "YELLOW_SQUARE"
                        ? "#facc15"
                        : pack === "ANTIQUE_DOUBLE_RING"
                          ? "#fef3c7"
                          : pack === "PILL_BADGE"
                            ? (isCap ? "#ef4444" : "#38bdf8")
                            : "#ffffff",
                    border:
                      pack === "YELLOW_SQUARE"
                        ? "1.5px solid #1e293b"
                        : pack === "ANTIQUE_DOUBLE_RING"
                          ? "2px solid #78350f"
                          : pack === "PILL_BADGE"
                            ? "1.5px solid #ffffff"
                            : isCap
                              ? "2.8px solid #dc2626"
                              : "2.4px solid #2563eb",
                    outline: pack === "ANTIQUE_DOUBLE_RING" ? "1.5px solid #78350f" : undefined,
                    outlineOffset: pack === "ANTIQUE_DOUBLE_RING" ? 2 : undefined,
                    boxShadow: isAffected
                      ? "0 0 0 4px rgba(251, 191, 36, 0.75)"
                      : "0 0 6px rgba(15, 23, 42, 0.55)",
                  }}
                />
                <span
                  style={{
                    fontFamily: props.stylePack.typography.city_font,
                    fontSize: isCap ? 11.5 : 10.5,
                    fontWeight: isCap ? 700 : 600,
                    padding: pack === "PILL_BADGE" ? "1px 5px" : "0 3px",
                    borderRadius: pack === "PILL_BADGE" ? 999 : 3,
                    background:
                      pack === "PILL_BADGE"
                        ? "rgba(15, 23, 42, 0.76)"
                        : props.basemapIsDark
                          ? "rgba(15, 23, 42, 0.65)"
                          : "rgba(255, 255, 255, 0.72)",
                    color: pack === "PILL_BADGE" || props.basemapIsDark ? "#f8fafc" : "#0f172a",
                    border: isAffected
                      ? "1px solid #fbbf24"
                      : pack === "PILL_BADGE"
                        ? "1px solid rgba(255,255,255,0.28)"
                        : "none",
                    whiteSpace: "pre",
                    textAlign: "center",
                    lineHeight: 1.15,
                    textShadow: pack === "PILL_BADGE" ? "0 1px 2px rgba(0,0,0,0.85)" : "none",
                  }}
                >
                  {item.display_text}
                </span>
              </button>
            );
          })}
      </div>
    </>
  );
}
