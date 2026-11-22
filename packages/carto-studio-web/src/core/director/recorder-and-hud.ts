import type {
  DirectorKeyframe,
  GateIssue,
  GateResult,
  HistoricalEvent,
  HistoricalToponym,
  LayerVisibilityConfig,
  MapSnapshot,
  VideoExportJobSpec,
} from "@historical-cartography/shared-schema";
import type { EpochSceneBundle } from "../data/demo-types.ts";
import { JDN_960, JDN_975 } from "../data/demo-sources-events.ts";
import type { ScreenBox } from "../layout/label-collision.ts";
import { boxesIntersect, computePolylabel } from "../layout/label-collision.ts";

export {
  classifyTopologyTransition,
  interpolateMorphSnapshot,
  resampleLineString,
  type TopologyTransitionPlan,
} from "./morph-engine.ts";

export interface TelemetrySample {
  elapsed_ms: number;
  historical_jdn: number;
  camera: DirectorKeyframe["camera"];
  style_id: string;
  layer_config: LayerVisibilityConfig;
  active_hud_ids: string[];
}

export type HudWidgetSpec = VideoExportJobSpec["hud_widgets"][number];

export interface PlacedHudWidget {
  widget: HudWidgetSpec;
  effective_anchor: HudWidgetSpec["anchor"];
  collapsed_for_vertical: boolean;
  visible_at_time: boolean;
  bbox: ScreenBox;
  in_safe_area: boolean;
  violation_reason?: string;
}

export interface AspectSafeAreaLayout {
  aspect_ratio: VideoExportJobSpec["aspect_ratio"];
  canvas_width: number;
  canvas_height: number;
  safe_margins: { top: number; right: number; bottom: number; left: number };
  restricted_zones: Array<{ id: string; label_zh: string; bbox: ScreenBox }>;
  placed_widgets: PlacedHudWidget[];
  g5_hud_gate: GateResult;
}

export function getResolutionDimensions(
  aspectRatio: VideoExportJobSpec["aspect_ratio"],
  resolution: VideoExportJobSpec["resolution"] = "1080p",
): { width: number; height: number } {
  const shortSide = resolution === "4K" ? 2160 : resolution === "1440p" ? 1440 : 1080;
  switch (aspectRatio) {
    case "16:9": return { width: Math.round((shortSide * 16) / 9), height: shortSide };
    case "9:16": return { width: shortSide, height: Math.round((shortSide * 16) / 9) };
    case "1:1": return { width: shortSide, height: shortSide };
    case "21:9": return { width: Math.round((shortSide * 21) / 9), height: shortSide };
  }
}

export function extractHudWindowsFromTelemetry(
  samples: readonly TelemetrySample[],
  baseWidgets: readonly HudWidgetSpec[],
): HudWidgetSpec[] {
  if (samples.length === 0) return [...baseWidgets];
  const minT = samples[0]!.elapsed_ms / 1000;
  const maxT = Math.max(minT + 0.5, samples[samples.length - 1]!.elapsed_ms / 1000);
  const firstActive = new Map<string, number>();
  const lastActive = new Map<string, number>();

  for (const s of samples) {
    const t = Number((s.elapsed_ms / 1000).toFixed(3));
    for (const key of s.active_hud_ids) {
      if (!firstActive.has(key)) firstActive.set(key, t);
      lastActive.set(key, t);
    }
  }

  return baseWidgets.map((w) => {
    const fromT = firstActive.get(w.type) ?? firstActive.get(w.widget_id);
    const toT = lastActive.get(w.type) ?? lastActive.get(w.widget_id);
    if (fromT === undefined || toT === undefined) {
      return { ...w, visible_from_sec: 0, visible_to_sec: 0 };
    }
    return {
      ...w,
      visible_from_sec: fromT,
      visible_to_sec: Math.max(fromT + 0.4, toT === minT ? maxT : toT),
    };
  });
}

/**
 * Filter 60Hz raw telemetry into smoothed editable DirectorKeyframe[].
 * Smooths lon, lat, zoom, bearing_deg, and pitch_deg, preserving HUD/style/layer transitions.
 */
export function importRecordingTelemetry(
  samples: readonly TelemetrySample[],
  toleranceDeg = 0.25,
): DirectorKeyframe[] {
  if (samples.length === 0) return [];
  if (samples.length === 1) {
    const s = samples[0]!;
    return [
      {
        keyframe_id: "kf-rec-001",
        video_time_sec: Number((s.elapsed_ms / 1000).toFixed(3)),
        historical_jdn: s.historical_jdn,
        camera: { ...s.camera, center: [s.camera.center[0], s.camera.center[1]] },
        easing: "EASE_IN_OUT_CUBIC",
        style_id: s.style_id,
        layer_config: s.layer_config,
        enable_ghost_previous_border: true,
        morph_transition_sec: 0.9,
        topology_change_fallback: "OCCUPATION_RIPPLE",
      },
    ];
  }

  const smoothed = samples.map((cur, idx) => {
    const prev = samples[Math.max(0, idx - 1)]!;
    const next = samples[Math.min(samples.length - 1, idx + 1)]!;
    const blend = (a: number, b: number, c: number): number => 0.25 * a + 0.5 * b + 0.25 * c;
    return {
      ...cur,
      camera: {
        center: [
          Number(blend(prev.camera.center[0], cur.camera.center[0], next.camera.center[0]).toFixed(4)),
          Number(blend(prev.camera.center[1], cur.camera.center[1], next.camera.center[1]).toFixed(4)),
        ] as [number, number],
        zoom: Number(blend(prev.camera.zoom, cur.camera.zoom, next.camera.zoom).toFixed(3)),
        bearing_deg: Number(blend(prev.camera.bearing_deg, cur.camera.bearing_deg, next.camera.bearing_deg).toFixed(1)),
        pitch_deg: Number(blend(prev.camera.pitch_deg, cur.camera.pitch_deg, next.camera.pitch_deg).toFixed(1)),
      },
    };
  });

  const kept: TelemetrySample[] = [smoothed[0]!];
  for (let i = 1; i < smoothed.length - 1; i++) {
    const prevKept = kept[kept.length - 1]!;
    const cur = smoothed[i]!;
    const dtSec = (cur.elapsed_ms - prevKept.elapsed_ms) / 1000;
    const dPos = Math.hypot(cur.camera.center[0] - prevKept.camera.center[0], cur.camera.center[1] - prevKept.camera.center[1]);
    const dZoom = Math.abs(cur.camera.zoom - prevKept.camera.zoom);
    const dRot = Math.abs(cur.camera.bearing_deg - prevKept.camera.bearing_deg)
      + Math.abs(cur.camera.pitch_deg - prevKept.camera.pitch_deg);
    const hudChanged = cur.active_hud_ids.join("|") !== prevKept.active_hud_ids.join("|");
    const stateChanged =
      cur.style_id !== prevKept.style_id
      || cur.layer_config.base_mode !== prevKept.layer_config.base_mode
      || cur.layer_config.enabled_overlays.join(",") !== prevKept.layer_config.enabled_overlays.join(",")
      || Math.abs(cur.historical_jdn - prevKept.historical_jdn) > 0.5
      || hudChanged;

    if (stateChanged || dtSec >= 0.8 || dPos >= toleranceDeg || dZoom >= 0.25 || dRot >= 3.0) {
      kept.push(cur);
    }
  }
  const last = smoothed[smoothed.length - 1]!;
  if (last.elapsed_ms > kept[kept.length - 1]!.elapsed_ms) {
    kept.push(last);
  }

  return kept.map((sample, idx) => ({
    keyframe_id: `kf-rec-${String(idx + 1).padStart(3, "0")}`,
    video_time_sec: Number((sample.elapsed_ms / 1000).toFixed(3)),
    historical_jdn: sample.historical_jdn,
    camera: sample.camera,
    easing: idx === 0 ? "LINEAR" : "EASE_IN_OUT_CUBIC",
    style_id: sample.style_id,
    layer_config: sample.layer_config,
    enable_ghost_previous_border: true,
    morph_transition_sec: 1.0,
    topology_change_fallback: "OCCUPATION_RIPPLE",
  }));
}

function computeEventAutoFrame(
  ev: HistoricalEvent,
  bundle?: {
    toponyms?: readonly HistoricalToponym[];
    snapshot?: MapSnapshot;
    default_camera?: { center: [number, number]; zoom: number };
  },
): { center: [number, number]; zoom: number } {
  const pts: Array<[number, number]> = [];
  if (bundle?.toponyms) {
    const tSet = new Set(ev.involved_toponym_ids);
    for (const top of bundle.toponyms) {
      if (tSet.has(top.toponym_id)) pts.push(top.coordinates);
    }
  }
  if (bundle?.snapshot && pts.length < 2) {
    const pSet = new Set(ev.involved_polity_ids);
    for (const face of bundle.snapshot.territories.features) {
      if (face.properties.polity_id && pSet.has(face.properties.polity_id)) {
        for (const p of face.geometry.coordinates[0] ?? []) {
          pts.push([p[0] ?? 0, p[1] ?? 0]);
        }
      }
    }
  }
  if (pts.length === 0) {
    return bundle?.default_camera ?? { center: [62.2, 38.0], zoom: 4.5 };
  }
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const spanLon = Math.max(1.8, maxLon - minLon);
  const spanLat = Math.max(1.2, maxLat - minLat);
  const zoom = Math.max(2.6, Math.min(6.4, Math.log2(160 / Math.max(spanLon, spanLat * 1.45))));
  return {
    center: [Number(((minLon + maxLon) / 2).toFixed(2)), Number(((minLat + maxLat) / 2).toFixed(2))],
    zoom: Number(zoom.toFixed(2)),
  };
}

/**
 * Generate an auto-framed storyboard (`DirectorKeyframe[]` + 7 HUD widgets)
 * strictly from event entities, toponym bounds, and script lines.
 */
export function generateVideoStoryboard(params: {
  events: readonly HistoricalEvent[];
  script_lines?: readonly string[];
  style_id?: string;
  aspect_ratio?: VideoExportJobSpec["aspect_ratio"];
  bundle?: EpochSceneBundle;
}): { keyframes: DirectorKeyframe[]; hud_widgets: HudWidgetSpec[]; duration_sec: number } {
  const orderedEvents = [...params.events].sort(
    (a, b) => a.time_start.julian_day_number - b.time_start.julian_day_number,
  );
  const styleId = params.style_id ?? params.bundle?.recommended_style_id ?? "vivid_video_songti";
  const keyframes: DirectorKeyframe[] = [];
  const hudWidgets: HudWidgetSpec[] = [];

  if (orderedEvents.length === 0) {
    const cam = params.bundle?.default_camera ?? { center: [67.5, 37.5] as [number, number], zoom: 4.1 };
    const startJdn = params.bundle?.epoch.valid_from_jdn ?? JDN_960;
    const endJdn = params.bundle ? params.bundle.epoch.valid_to_jdn - 1 : JDN_975;
    keyframes.push(
      {
        keyframe_id: "kf-auto-001",
        video_time_sec: 0,
        historical_jdn: startJdn,
        camera: { center: cam.center, zoom: cam.zoom, bearing_deg: 0, pitch_deg: 0 },
        easing: "EASE_IN_OUT_CUBIC",
        style_id: styleId,
        enable_ghost_previous_border: true,
        morph_transition_sec: 1.2,
        topology_change_fallback: "OCCUPATION_RIPPLE",
      },
      {
        keyframe_id: "kf-auto-002",
        video_time_sec: 3,
        historical_jdn: endJdn,
        camera: { center: [cam.center[0] - 1.5, cam.center[1]], zoom: cam.zoom + 0.4, bearing_deg: -5, pitch_deg: 16 },
        easing: "CAMERA_FLY_TO",
        style_id: styleId,
        enable_ghost_previous_border: true,
        morph_transition_sec: 1.2,
        topology_change_fallback: "WIPE_MASK",
      },
    );
    return {
      keyframes,
      hud_widgets: buildDefaultHudWidgets(3, params.script_lines, params.bundle),
      duration_sec: 3,
    };
  }

  let timeCursor = 0;
  for (let i = 0; i < orderedEvents.length; i++) {
    const ev = orderedEvents[i]!;
    const frame = computeEventAutoFrame(ev, params.bundle);
    keyframes.push({
      keyframe_id: `kf-ev-${String(i + 1).padStart(3, "0")}`,
      video_time_sec: timeCursor,
      historical_jdn: ev.time_start.julian_day_number,
      camera: {
        center: frame.center,
        zoom: frame.zoom,
        bearing_deg: i % 2 === 0 ? 0 : -5,
        pitch_deg: i % 2 === 0 ? 6 : 18,
      },
      easing: i === 0 ? "LINEAR" : "CAMERA_FLY_TO",
      style_id: styleId,
      layer_config: {
        base_mode: "PURE_TERRITORY",
        enabled_overlays: ["admin_divisions", "historical_events", "physical_paleo_geo"],
      },
      enable_ghost_previous_border: true,
      morph_transition_sec: 1.1,
      topology_change_fallback: ev.conflict_status === "T1_SCHOLARLY_DISPUTE" ? "WIPE_MASK" : "OCCUPATION_RIPPLE",
    });

    const segEnd = timeCursor + 3.0;
    const narration = params.script_lines?.[i] ?? ev.summary;
    hudWidgets.push({
      widget_id: `hud-sub-${i + 1}`,
      type: "SUBTITLE_BAR",
      anchor: "BOTTOM_CENTER",
      visible_from_sec: timeCursor,
      visible_to_sec: segEnd,
      data_binding: { text: narration, hist_event_id: ev.hist_event_id },
    });
    timeCursor = segEnd;
  }

  const baseWidgets = buildDefaultHudWidgets(Math.max(3, timeCursor), params.script_lines, params.bundle)
    .filter((w) => w.type !== "SUBTITLE_BAR");

  return {
    keyframes,
    hud_widgets: [...baseWidgets, ...hudWidgets],
    duration_sec: timeCursor,
  };
}

export function buildDefaultHudWidgets(
  durationSec = 6,
  scriptLines?: readonly string[],
  bundle?: EpochSceneBundle,
): HudWidgetSpec[] {
  const firstFig = bundle?.figures[0];
  const activePolityIds = Array.from(
    new Set(
      (bundle?.snapshot.territories.features ?? [])
        .map((f) => f.properties.polity_id)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const primaryPolityId = activePolityIds[0] ?? "polity-samanid";
  const disputed = bundle?.snapshot.territories.features.find((f) => f.properties.zone_semantics === "DISPUTED_OVERLAP");
  const pipFocus = (() => {
    const sea = bundle?.water_labels?.find((w) => w.kind === "SEA" && w.coordinates[1] < 22);
    if (sea) return { label: sea.name_zh, center: sea.coordinates, zoom: 4.1 };
    if (disputed) {
      const center = computePolylabel(disputed.geometry.coordinates[0] ?? []).center;
      return { label: "争议焦点放大", center, zoom: 5.8 };
    }
    const frontier = bundle?.toponyms.find((t) => t.entity_rank === "PASS_FORT" || t.entity_rank === "MAJOR_CITY");
    if (frontier) return { label: `${frontier.name_zh} 局部`, center: frontier.coordinates, zoom: 5.5 };
    return {
      label: "区域局部小图",
      center: bundle?.default_camera.center ?? ([52.2, 35.8] as [number, number]),
      zoom: (bundle?.default_camera.zoom ?? 4.5) + 1.1,
    };
  })();

  return [
    {
      widget_id: "hud-date-era",
      type: "DATE_ERA_BADGE",
      anchor: "TOP_LEFT",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { show_era_note: true, format: "historical_year_display" },
    },
    {
      widget_id: "hud-figure-pin",
      type: "FIGURE_PORTRAIT_PIN",
      anchor: "MAP_COORDINATE",
      map_coordinates: firstFig?.coordinates ?? bundle?.default_camera.center ?? [68.2, 41.6],
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { figure_id: firstFig?.figure_id ?? "default-fig", label: firstFig?.name_zh ?? "历史人物" },
    },
    {
      widget_id: "hud-coalition-sidebar",
      type: "COALITION_ROSTER_SIDEBAR",
      anchor: "LEFT_SIDEBAR",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { title: "参战/核心政权名录", polity_ids: activePolityIds.slice(0, 6) },
    },
    {
      widget_id: "hud-polity-dashboard",
      type: "POLITY_DASHBOARD_PANEL",
      anchor: "TOP_RIGHT",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { polity_id: primaryPolityId, show_capital: true, show_area_index: true },
    },
    {
      widget_id: "hud-chronicle-overlay",
      type: "CHRONICLE_TEXT_OVERLAY",
      anchor: "RIGHT_SIDEBAR",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { title: bundle?.chronicle_notes?.heading ?? "编年大事记", max_items: 3 },
    },
    {
      widget_id: "hud-subtitle-main",
      type: "SUBTITLE_BAR",
      anchor: "BOTTOM_CENTER",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: {
        text: scriptLines?.[0] ?? bundle?.subtitle_default ?? bundle?.events[0]?.summary ?? "",
      },
    },
    {
      widget_id: "hud-pip-inset",
      type: "PIP_INSET_MAP",
      anchor: "BOTTOM_CENTER",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { focus_label: pipFocus.label, center: pipFocus.center, zoom: pipFocus.zoom },
    },
  ];
}

export function interpolateDirectorState(
  keyframes: readonly DirectorKeyframe[],
  videoTimeSec: number,
): {
  camera: DirectorKeyframe["camera"];
  historical_jdn: number;
  active_keyframe: DirectorKeyframe | undefined;
  next_keyframe: DirectorKeyframe | undefined;
  morph_progress: number;
  style_id?: string;
  layer_config?: LayerVisibilityConfig;
  enable_ghost_previous_border: boolean;
} {
  if (keyframes.length === 0) {
    return {
      camera: { center: [67.5, 37.5], zoom: 4.1, bearing_deg: 0, pitch_deg: 0 },
      historical_jdn: JDN_960,
      active_keyframe: undefined,
      next_keyframe: undefined,
      morph_progress: 1,
      enable_ghost_previous_border: false,
    };
  }
  const sorted = [...keyframes].sort((a, b) => a.video_time_sec - b.video_time_sec);
  if (videoTimeSec <= sorted[0]!.video_time_sec) {
    const k = sorted[0]!;
    return {
      camera: k.camera,
      historical_jdn: k.historical_jdn,
      active_keyframe: k,
      next_keyframe: sorted[1],
      morph_progress: 0,
      ...(k.style_id ? { style_id: k.style_id } : {}),
      ...(k.layer_config ? { layer_config: k.layer_config } : {}),
      enable_ghost_previous_border: Boolean(k.enable_ghost_previous_border),
    };
  }
  const last = sorted[sorted.length - 1]!;
  if (videoTimeSec >= last.video_time_sec) {
    return {
      camera: last.camera,
      historical_jdn: last.historical_jdn,
      active_keyframe: last,
      next_keyframe: undefined,
      morph_progress: 1,
      ...(last.style_id ? { style_id: last.style_id } : {}),
      ...(last.layer_config ? { layer_config: last.layer_config } : {}),
      enable_ghost_previous_border: Boolean(last.enable_ghost_previous_border),
    };
  }

  let k0 = sorted[0]!;
  let k1 = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (videoTimeSec >= sorted[i]!.video_time_sec && videoTimeSec <= sorted[i + 1]!.video_time_sec) {
      k0 = sorted[i]!;
      k1 = sorted[i + 1]!;
      break;
    }
  }

  const span = Math.max(1e-6, k1.video_time_sec - k0.video_time_sec);
  const u = Math.max(0, Math.min(1, (videoTimeSec - k0.video_time_sec) / span));
  const eased = k1.easing === "LINEAR"
    ? u
    : u < 0.5
      ? 4 * u * u * u
      : 1 - ((-2 * u + 2) ** 3) / 2;

  // Parabolic zoom dip during CAMERA_FLY_TO long pans
  const dist = Math.hypot(k1.camera.center[0] - k0.camera.center[0], k1.camera.center[1] - k0.camera.center[1]);
  const flyDip = k1.easing === "CAMERA_FLY_TO" ? Math.min(0.85, dist * 0.04) * Math.sin(Math.PI * u) : 0;

  const morphWindow = Math.max(0.25, Math.min(span, k1.morph_transition_sec ?? span));
  const morphProgress = Math.max(0, Math.min(1, (videoTimeSec - k0.video_time_sec) / morphWindow));

  return {
    camera: {
      center: [
        k0.camera.center[0] + (k1.camera.center[0] - k0.camera.center[0]) * eased,
        k0.camera.center[1] + (k1.camera.center[1] - k0.camera.center[1]) * eased,
      ],
      zoom: Number((k0.camera.zoom + (k1.camera.zoom - k0.camera.zoom) * eased - flyDip).toFixed(3)),
      bearing_deg: k0.camera.bearing_deg + (k1.camera.bearing_deg - k0.camera.bearing_deg) * eased,
      pitch_deg: k0.camera.pitch_deg + (k1.camera.pitch_deg - k0.camera.pitch_deg) * eased,
    },
    historical_jdn: k0.historical_jdn + (k1.historical_jdn - k0.historical_jdn) * eased,
    active_keyframe: k0,
    next_keyframe: k1,
    morph_progress: morphProgress,
    ...(k0.style_id ? { style_id: k0.style_id } : {}),
    ...(k0.layer_config ? { layer_config: k0.layer_config } : {}),
    enable_ghost_previous_border: Boolean(k1.enable_ghost_previous_border ?? k0.enable_ghost_previous_border),
  };
}

export function layoutHudWidgetsForAspect(params: {
  widgets: readonly HudWidgetSpec[];
  aspect_ratio: VideoExportJobSpec["aspect_ratio"];
  video_time_sec: number;
  canvas_width?: number;
  canvas_height?: number;
  auto_reflow_vertical?: boolean;
  custom_positions?: Readonly<Record<string, { x_pct: number; y_pct: number }>>;
  figure_pins?: ReadonlyArray<{ figure_id: string; coordinates: [number, number] }>;
  project_map_coord?: (lonLat: [number, number]) => [number, number];
}): AspectSafeAreaLayout {
  const defaultDims = getResolutionDimensions(params.aspect_ratio, "1080p");
  const width = params.canvas_width ?? defaultDims.width;
  const height = params.canvas_height ?? defaultDims.height;
  const isVertical = params.aspect_ratio === "9:16";
  const autoReflow = params.auto_reflow_vertical ?? true;

  const safeMargins = isVertical
    ? {
        top: Math.round(height * 0.08),
        right: Math.round(width * 0.14),
        bottom: Math.round(height * 0.18),
        left: Math.round(width * 0.04),
      }
    : {
        top: Math.round(height * 0.04),
        right: Math.round(width * 0.04),
        bottom: Math.round(height * 0.05),
        left: Math.round(width * 0.04),
      };

  const placementMargins = isVertical && !autoReflow
    ? {
        top: Math.round(height * 0.04),
        right: Math.round(width * 0.04),
        bottom: Math.round(height * 0.05),
        left: Math.round(width * 0.04),
      }
    : safeMargins;

  const restrictedZones: Array<{ id: string; label_zh: string; bbox: ScreenBox }> = [];
  if (isVertical) {
    restrictedZones.push(
      {
        id: "vertical-right-action-rail",
        label_zh: "抖音/B站竖屏右侧点赞互动遮挡区",
        bbox: {
          x: width - safeMargins.right,
          y: Math.round(height * 0.34),
          width: safeMargins.right,
          height: Math.round(height * 0.48),
        },
      },
      {
        id: "vertical-bottom-caption-rail",
        label_zh: "竖屏底部文案/标题遮挡区",
        bbox: {
          x: 0,
          y: height - safeMargins.bottom,
          width,
          height: safeMargins.bottom,
        },
      },
    );
  }

  const placed: PlacedHudWidget[] = [];
  const activeBoxes: Array<{ id: string; bbox: ScreenBox }> = [];
  const issues: GateIssue[] = [];

  const scaleX = width / (isVertical ? 1080 : 1920);
  const scaleY = height / (isVertical ? 1920 : 1080);
  const subtitleHeight = Math.round(78 * scaleY);
  const hasVisibleSubtitle = params.widgets.some(
    (w) => w.type === "SUBTITLE_BAR" && params.video_time_sec >= w.visible_from_sec && params.video_time_sec <= w.visible_to_sec,
  );
  const subtitleReserve = hasVisibleSubtitle ? subtitleHeight + 18 : 8;

  let topStackY = placementMargins.top;
  let bottomPipOffset = 0;

  const checkBox = (id: string, type: string, bbox: ScreenBox, visible: boolean): { inSafeArea: boolean; violationReason?: string } => {
    let inSafeArea =
      bbox.x >= safeMargins.left - 1
      && bbox.y >= safeMargins.top - 1
      && bbox.x + bbox.width <= width - safeMargins.right + 1
      && bbox.y + bbox.height <= height - safeMargins.bottom + 1;
    let violationReason: string | undefined;

    if (visible) {
      for (const zone of restrictedZones) {
        if (boxesIntersect(bbox, zone.bbox, 0)) {
          inSafeArea = false;
          violationReason = `与「${zone.label_zh}」重叠`;
          break;
        }
      }
      if (!inSafeArea && !violationReason) {
        violationReason = "超出当前画幅安全边界";
      }
      for (const other of activeBoxes) {
        if (boxesIntersect(bbox, other.bbox, 2)) {
          inSafeArea = false;
          violationReason = `与 HUD 挂件 ${other.id} 重叠`;
          break;
        }
      }
      activeBoxes.push({ id, bbox });
      if (!inSafeArea) {
        issues.push({
          gate: "G5",
          code: "HUD_SAFE_AREA_VIOLATION",
          entity_id: id,
          message: `HUD 挂件 ${id} (${type}) 在 ${params.aspect_ratio} 画幅下校验失败：${violationReason}`,
        });
      }
    }
    return { inSafeArea, ...(violationReason !== undefined ? { violationReason } : {}) };
  };

  for (const widget of params.widgets) {
    const visible = params.video_time_sec >= widget.visible_from_sec && params.video_time_sec <= widget.visible_to_sec;
    let effectiveAnchor = widget.anchor;
    let collapsedForVertical = false;
    if (isVertical && autoReflow) {
      if (widget.anchor === "LEFT_SIDEBAR" || widget.anchor === "RIGHT_SIDEBAR" || widget.anchor === "TOP_RIGHT") {
        effectiveAnchor = "TOP_LEFT";
        collapsedForVertical = true;
      }
    }

    let bbox: ScreenBox;
    if (widget.type === "DATE_ERA_BADGE") {
      const w = isVertical ? Math.round(740 * scaleX) : Math.round(280 * scaleX);
      const h = isVertical ? Math.round(180 * scaleY) : Math.round(64 * scaleY);
      bbox = { x: placementMargins.left, y: topStackY, width: w, height: h };
      if (visible) topStackY += h + (isVertical ? 28 : 10);
    } else if (widget.type === "SUBTITLE_BAR") {
      const w = Math.round(width - placementMargins.left - placementMargins.right);
      bbox = {
        x: placementMargins.left,
        y: height - placementMargins.bottom - subtitleHeight - 8,
        width: Math.max(200, w),
        height: subtitleHeight,
      };
    } else if (widget.type === "PIP_INSET_MAP") {
      const w = isVertical ? Math.round(380 * scaleX) : Math.round(220 * scaleX);
      const h = isVertical ? Math.round(220 * scaleY) : Math.round(140 * scaleY);
      bbox = {
        x: isVertical && autoReflow ? placementMargins.left : width - placementMargins.right - w,
        y: height - placementMargins.bottom - subtitleReserve - h - bottomPipOffset,
        width: w,
        height: h,
      };
      if (visible) bottomPipOffset += h + 10;
    } else if (widget.type === "FIGURE_PORTRAIT_PIN") {
      const w = Math.round(150 * scaleX);
      const h = Math.round(84 * scaleY);
      const pins = params.figure_pins && params.figure_pins.length > 0
        ? params.figure_pins
        : [{ figure_id: widget.widget_id, coordinates: widget.map_coordinates ?? ([64, 38] as [number, number]) }];
      const minClearY = isVertical && autoReflow ? Math.max(placementMargins.top, topStackY + 8) : placementMargins.top;
      let primaryBbox: ScreenBox = { x: placementMargins.left, y: minClearY, width: w, height: h };
      let allPinsSafe = true;
      let firstReason: string | undefined;

      pins.forEach((pin, idx) => {
        const [px, py] = params.project_map_coord
          ? params.project_map_coord(pin.coordinates)
          : [Math.round(width * (0.4 + idx * 0.14)), Math.round(height * 0.48)];
        const pBox: ScreenBox = {
          x: Math.max(placementMargins.left, Math.min(width - placementMargins.right - w, Math.round(px - w / 2))),
          y: Math.max(minClearY, Math.min(height - placementMargins.bottom - subtitleReserve - h, Math.round(py - h / 2))),
          width: w,
          height: h,
        };
        if (idx === 0) primaryBbox = pBox;
        const res = checkBox(idx === 0 ? widget.widget_id : `${widget.widget_id}:${pin.figure_id}`, widget.type, pBox, visible);
        if (!res.inSafeArea) {
          allPinsSafe = false;
          firstReason ??= res.violationReason;
        }
      });

      placed.push({
        widget,
        effective_anchor: effectiveAnchor,
        collapsed_for_vertical: collapsedForVertical,
        visible_at_time: visible,
        bbox: primaryBbox,
        in_safe_area: allPinsSafe,
        ...(firstReason !== undefined ? { violation_reason: firstReason } : {}),
      });
      continue;
    } else if (effectiveAnchor === "LEFT_SIDEBAR") {
      const w = Math.round(250 * scaleX);
      const h = Math.round(260 * scaleY);
      bbox = { x: placementMargins.left, y: Math.round(height * 0.22), width: w, height: h };
    } else if (effectiveAnchor === "RIGHT_SIDEBAR") {
      const w = Math.round(270 * scaleX);
      const h = Math.round(220 * scaleY);
      bbox = { x: width - placementMargins.right - w, y: Math.round(height * 0.24), width: w, height: h };
    } else if (effectiveAnchor === "TOP_RIGHT") {
      const w = Math.round(290 * scaleX);
      const h = Math.round(135 * scaleY);
      bbox = { x: width - placementMargins.right - w, y: placementMargins.top, width: w, height: h };
    } else {
      const w = Math.round((width - placementMargins.left - placementMargins.right) * 0.92);
      const h = collapsedForVertical ? Math.round(150 * scaleY) : Math.round(110 * scaleY);
      bbox = { x: placementMargins.left, y: topStackY, width: Math.max(180, w), height: h };
      if (visible) topStackY += h + (isVertical ? 14 : 8);
    }

    const custom = params.custom_positions?.[widget.widget_id];
    if (custom && !(isVertical && collapsedForVertical)) {
      bbox = {
        ...bbox,
        x: Math.round((custom.x_pct / 100) * width),
        y: Math.round((custom.y_pct / 100) * height),
      };
    }

    const res = checkBox(widget.widget_id, widget.type, bbox, visible);
    placed.push({
      widget,
      effective_anchor: effectiveAnchor,
      collapsed_for_vertical: collapsedForVertical,
      visible_at_time: visible,
      bbox,
      in_safe_area: res.inSafeArea,
      ...(res.violationReason !== undefined ? { violation_reason: res.violationReason } : {}),
    });
  }

  return {
    aspect_ratio: params.aspect_ratio,
    canvas_width: width,
    canvas_height: height,
    safe_margins: safeMargins,
    restricted_zones: restrictedZones,
    placed_widgets: placed,
    g5_hud_gate: { gate: "G5", passed: issues.length === 0, issues },
  };
}
