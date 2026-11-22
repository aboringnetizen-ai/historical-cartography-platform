import type {
  DirectorKeyframe,
  GateIssue,
  GateResult,
  HistoricalEvent,
  LayerVisibilityConfig,
  MapSnapshot,
  VideoExportJobSpec,
} from "@historical-cartography/shared-schema";
import { JDN_842, JDN_928_JAN, JDN_928_NOV } from "../data/demo-sources-events.ts";
import type { ScreenBox } from "../layout/label-collision.ts";
import { boxesIntersect } from "../layout/label-collision.ts";

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

export interface TopologyTransitionPlan {
  is_homeomorphic: boolean;
  mode: "STREAMLINE_ARC_MORPH" | NonNullable<DirectorKeyframe["topology_change_fallback"]>;
  shared_arc_ids: string[];
  added_or_removed_arcs: string[];
  reason_zh: string;
}

export function getResolutionDimensions(
  aspectRatio: VideoExportJobSpec["aspect_ratio"],
  resolution: VideoExportJobSpec["resolution"] = "1080p",
): { width: number; height: number } {
  const shortSide = resolution === "4K" ? 2160 : resolution === "1440p" ? 1440 : 1080;
  switch (aspectRatio) {
    case "16:9":
      return { width: Math.round((shortSide * 16) / 9), height: shortSide };
    case "9:16":
      return { width: shortSide, height: Math.round((shortSide * 16) / 9) };
    case "1:1":
      return { width: shortSide, height: shortSide };
    case "21:9":
      return { width: Math.round((shortSide * 21) / 9), height: shortSide };
  }
}

/**
 * Filter 60Hz raw telemetry into smooth editable DirectorKeyframe[].
 * Preserves endpoints, camera extrema, and any JDN / style / layer switches.
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

  // Pass 1: Bezier moving average smoothing across neighboring camera samples
  const smoothed = samples.map((cur, idx) => {
    const prev = samples[Math.max(0, idx - 1)]!;
    const next = samples[Math.min(samples.length - 1, idx + 1)]!;
    const cLon = 0.25 * prev.camera.center[0] + 0.5 * cur.camera.center[0] + 0.25 * next.camera.center[0];
    const cLat = 0.25 * prev.camera.center[1] + 0.5 * cur.camera.center[1] + 0.25 * next.camera.center[1];
    const zoom = 0.25 * prev.camera.zoom + 0.5 * cur.camera.zoom + 0.25 * next.camera.zoom;
    return {
      ...cur,
      camera: {
        center: [Number(cLon.toFixed(4)), Number(cLat.toFixed(4))] as [number, number],
        zoom: Number(zoom.toFixed(3)),
        bearing_deg: cur.camera.bearing_deg,
        pitch_deg: cur.camera.pitch_deg,
      },
    };
  });

  // Pass 2: Keyframe thinning while always keeping discrete style/layer/JDN jumps
  const kept: TelemetrySample[] = [smoothed[0]!];
  for (let i = 1; i < smoothed.length - 1; i++) {
    const prevKept = kept[kept.length - 1]!;
    const cur = smoothed[i]!;
    const dtSec = (cur.elapsed_ms - prevKept.elapsed_ms) / 1000;
    const dPos = Math.hypot(
      cur.camera.center[0] - prevKept.camera.center[0],
      cur.camera.center[1] - prevKept.camera.center[1],
    );
    const dZoom = Math.abs(cur.camera.zoom - prevKept.camera.zoom);
    const stateChanged =
      cur.style_id !== prevKept.style_id
      || cur.layer_config.base_mode !== prevKept.layer_config.base_mode
      || Math.abs(cur.historical_jdn - prevKept.historical_jdn) > 0.5;

    if (stateChanged || dtSec >= 0.8 || dPos >= toleranceDeg || dZoom >= 0.25) {
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

/**
 * Generate an auto-framed storyboard (`DirectorKeyframe[]` + 7 HUD widgets)
 * from selected timeline events or narration script lines (`generate_video_storyboard`).
 */
export function generateVideoStoryboard(params: {
  events: readonly HistoricalEvent[];
  script_lines?: readonly string[];
  style_id?: string;
  aspect_ratio?: VideoExportJobSpec["aspect_ratio"];
}): { keyframes: DirectorKeyframe[]; hud_widgets: HudWidgetSpec[]; duration_sec: number } {
  const orderedEvents = [...params.events].sort(
    (a, b) => a.time_start.julian_day_number - b.time_start.julian_day_number,
  );
  const styleId = params.style_id ?? "vivid_video_songti";
  const keyframes: DirectorKeyframe[] = [];
  const hudWidgets: HudWidgetSpec[] = [];

  if (orderedEvents.length === 0) {
    keyframes.push(
      {
        keyframe_id: "kf-auto-001",
        video_time_sec: 0,
        historical_jdn: JDN_842,
        camera: { center: [63.5, 38.2], zoom: 4.5, bearing_deg: 0, pitch_deg: 0 },
        easing: "EASE_IN_OUT_CUBIC",
        style_id: styleId,
        enable_ghost_previous_border: true,
        morph_transition_sec: 1.2,
        topology_change_fallback: "OCCUPATION_RIPPLE",
      },
      {
        keyframe_id: "kf-auto-002",
        video_time_sec: 3,
        historical_jdn: JDN_928_NOV,
        camera: { center: [58.0, 36.8], zoom: 5.1, bearing_deg: -6, pitch_deg: 18 },
        easing: "CAMERA_FLY_TO",
        style_id: styleId,
        enable_ghost_previous_border: true,
        morph_transition_sec: 1.2,
        topology_change_fallback: "WIPE_MASK",
      },
    );
    return {
      keyframes,
      hud_widgets: buildDefaultHudWidgets(3, params.script_lines),
      duration_sec: 3,
    };
  }

  let timeCursor = 0;
  for (let i = 0; i < orderedEvents.length; i++) {
    const ev = orderedEvents[i]!;
    const isRayy = ev.hist_event_id.includes("928");
    const isHan = ev.hist_event_id.includes("1bce");
    const center: [number, number] = isHan
      ? [84.2, 41.2]
      : isRayy
        ? [56.2, 36.6]
        : [64.4, 39.2];
    const zoom = isRayy ? 5.2 : 4.6;

    keyframes.push({
      keyframe_id: `kf-ev-${String(i + 1).padStart(3, "0")}`,
      video_time_sec: timeCursor,
      historical_jdn: ev.time_start.julian_day_number,
      camera: { center, zoom, bearing_deg: i % 2 === 0 ? 0 : -5, pitch_deg: i % 2 === 0 ? 8 : 20 },
      easing: i === 0 ? "LINEAR" : "CAMERA_FLY_TO",
      style_id: styleId,
      layer_config: {
        base_mode: "PURE_TERRITORY",
        enabled_overlays: ["admin_divisions", "historical_events", "physical_paleo_geo"],
      },
      enable_ghost_previous_border: true,
      morph_transition_sec: 1.1,
      topology_change_fallback: "OCCUPATION_RIPPLE",
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

  const baseWidgets = buildDefaultHudWidgets(Math.max(3, timeCursor), params.script_lines)
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
): HudWidgetSpec[] {
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
      map_coordinates: [68.2, 41.6],
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { figure_id: "fig-ahmad-i", label: "艾哈迈德一世" },
    },
    {
      widget_id: "hud-coalition-sidebar",
      type: "COALITION_ROSTER_SIDEBAR",
      anchor: "LEFT_SIDEBAR",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { title: "参战阵营名录", polity_ids: ["polity-samanid", "polity-ziyarid", "polity-abbasid"] },
    },
    {
      widget_id: "hud-polity-dashboard",
      type: "POLITY_DASHBOARD_PANEL",
      anchor: "TOP_RIGHT",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { polity_id: "polity-samanid", show_capital: true, show_area_index: true },
    },
    {
      widget_id: "hud-chronicle-overlay",
      type: "CHRONICLE_TEXT_OVERLAY",
      anchor: "RIGHT_SIDEBAR",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { title: "编年大事记", max_items: 3 },
    },
    {
      widget_id: "hud-subtitle-main",
      type: "SUBTITLE_BAR",
      anchor: "BOTTOM_CENTER",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: {
        text: scriptLines?.[0] ?? "公元928年，德莱木军南下雷伊，萨曼王朝与齐亚尔王朝共享疆界重组。",
      },
    },
    {
      widget_id: "hud-pip-inset",
      type: "PIP_INSET_MAP",
      anchor: "BOTTOM_CENTER",
      visible_from_sec: 0,
      visible_to_sec: durationSec,
      data_binding: { focus_label: "赫拉特飞地 / 雷伊局部", center: [52.2, 35.8], zoom: 5.8 },
    },
  ];
}

/**
 * Two-stage topology transition classifier (P5 anti-spiderweb safeguard):
 * - Same shared-arc connectivity -> continuous vertex interpolation (`STREAMLINE_ARC_MORPH`)
 * - Structural split/merge/new enclave -> fallback (`OCCUPATION_RIPPLE | WIPE_MASK | CROSS_DISSOLVE`)
 */
export function classifyTopologyTransition(
  fromSnapshot: MapSnapshot,
  toSnapshot: MapSnapshot,
  preferredFallback: NonNullable<DirectorKeyframe["topology_change_fallback"]> = "OCCUPATION_RIPPLE",
): TopologyTransitionPlan {
  const fromArcs = new Set(fromSnapshot.boundaries.features.map((f) => f.properties.arc_id));
  const toArcs = new Set(toSnapshot.boundaries.features.map((f) => f.properties.arc_id));

  const shared: string[] = [];
  const changed: string[] = [];
  for (const id of fromArcs) {
    if (toArcs.has(id)) shared.push(id);
    else changed.push(id);
  }
  for (const id of toArcs) {
    if (!fromArcs.has(id)) changed.push(id);
  }

  const sameFaceTopology =
    fromSnapshot.territories.features.length === toSnapshot.territories.features.length
    && changed.length === 0;

  if (sameFaceTopology) {
    return {
      is_homeomorphic: true,
      mode: "STREAMLINE_ARC_MORPH",
      shared_arc_ids: shared,
      added_or_removed_arcs: [],
      reason_zh: "共享弧段起止节点与面连通性不变，启用等距重采样顶点流式插值。",
    };
  }

  return {
    is_homeomorphic: false,
    mode: preferredFallback,
    shared_arc_ids: shared,
    added_or_removed_arcs: changed,
    reason_zh: `检测到跨纪元拓扑结构变化（${changed.length} 条弧段增减），自动切换为 ${preferredFallback} 防穿帮过渡。`,
  };
}

export function interpolateDirectorState(
  keyframes: readonly DirectorKeyframe[],
  videoTimeSec: number,
): {
  camera: DirectorKeyframe["camera"];
  historical_jdn: number;
  active_keyframe: DirectorKeyframe | undefined;
} {
  if (keyframes.length === 0) {
    return {
      camera: { center: [60.8, 37.5], zoom: 4.5, bearing_deg: 0, pitch_deg: 0 },
      historical_jdn: JDN_928_JAN,
      active_keyframe: undefined,
    };
  }
  const sorted = [...keyframes].sort((a, b) => a.video_time_sec - b.video_time_sec);
  if (videoTimeSec <= sorted[0]!.video_time_sec) {
    return {
      camera: sorted[0]!.camera,
      historical_jdn: sorted[0]!.historical_jdn,
      active_keyframe: sorted[0],
    };
  }
  const last = sorted[sorted.length - 1]!;
  if (videoTimeSec >= last.video_time_sec) {
    return {
      camera: last.camera,
      historical_jdn: last.historical_jdn,
      active_keyframe: last,
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

  return {
    camera: {
      center: [
        k0.camera.center[0] + (k1.camera.center[0] - k0.camera.center[0]) * eased,
        k0.camera.center[1] + (k1.camera.center[1] - k0.camera.center[1]) * eased,
      ],
      zoom: k0.camera.zoom + (k1.camera.zoom - k0.camera.zoom) * eased,
      bearing_deg: k0.camera.bearing_deg + (k1.camera.bearing_deg - k0.camera.bearing_deg) * eased,
      pitch_deg: k0.camera.pitch_deg + (k1.camera.pitch_deg - k0.camera.pitch_deg) * eased,
    },
    historical_jdn: k0.historical_jdn + (k1.historical_jdn - k0.historical_jdn) * eased,
    active_keyframe: k0,
  };
}

/**
 * Compute pixel boxes and G5 safe-area compliance across 16:9 / 9:16 / 1:1 / 21:9.
 * On 9:16 vertical mode, sidebars automatically reflow/collapse away from Douyin/Bilibili
 * right interaction rails and bottom caption zones unless `autoReflow` is explicitly disabled.
 */
export function layoutHudWidgetsForAspect(params: {
  widgets: readonly HudWidgetSpec[];
  aspect_ratio: VideoExportJobSpec["aspect_ratio"];
  video_time_sec: number;
  canvas_width?: number;
  canvas_height?: number;
  auto_reflow_vertical?: boolean;
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
        right: Math.round(width * 0.14), // Douyin / Bilibili right interaction column
        bottom: Math.round(height * 0.18), // Bottom video description & bar
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
    (w) =>
      w.type === "SUBTITLE_BAR"
      && params.video_time_sec >= w.visible_from_sec
      && params.video_time_sec <= w.visible_to_sec,
  );
  const subtitleReserve = hasVisibleSubtitle ? subtitleHeight + 18 : 8;

  let topStackY = placementMargins.top;
  let bottomPipOffset = 0;

  for (const widget of params.widgets) {
    const visible =
      params.video_time_sec >= widget.visible_from_sec
      && params.video_time_sec <= widget.visible_to_sec;

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
      const w = Math.round(280 * scaleX);
      const h = Math.round(64 * scaleY);
      bbox = { x: placementMargins.left, y: topStackY, width: w, height: h };
      if (visible) topStackY += h + 10;
    } else if (widget.type === "SUBTITLE_BAR") {
      const w = Math.round(width - placementMargins.left - placementMargins.right);
      bbox = {
        x: placementMargins.left,
        y: height - placementMargins.bottom - subtitleHeight - 8,
        width: Math.max(200, w),
        height: subtitleHeight,
      };
    } else if (widget.type === "PIP_INSET_MAP") {
      const w = Math.round(220 * scaleX);
      const h = Math.round(140 * scaleY);
      if (isVertical && autoReflow) {
        bbox = {
          x: placementMargins.left,
          y: height - placementMargins.bottom - subtitleReserve - h - bottomPipOffset,
          width: w,
          height: h,
        };
      } else {
        bbox = {
          x: width - placementMargins.right - w,
          y: height - placementMargins.bottom - subtitleReserve - h - bottomPipOffset,
          width: w,
          height: h,
        };
      }
      if (visible) bottomPipOffset += h + 10;
    } else if (widget.type === "FIGURE_PORTRAIT_PIN") {
      const w = Math.round(160 * scaleX);
      const h = Math.round(92 * scaleY);
      const [px, py] = widget.map_coordinates && params.project_map_coord
        ? params.project_map_coord(widget.map_coordinates)
        : [Math.round(width * 0.45), Math.round(height * 0.48)];
      const minClearY = isVertical && autoReflow ? Math.max(placementMargins.top, topStackY + 8) : placementMargins.top;
      bbox = {
        x: Math.max(placementMargins.left, Math.min(width - placementMargins.right - w, Math.round(px - w / 2))),
        y: Math.max(minClearY, Math.min(height - placementMargins.bottom - subtitleReserve - h, Math.round(py - h / 2))),
        width: w,
        height: h,
      };
    } else if (effectiveAnchor === "LEFT_SIDEBAR") {
      const w = Math.round(250 * scaleX);
      const h = Math.round(250 * scaleY);
      bbox = { x: placementMargins.left, y: Math.round(height * 0.22), width: w, height: h };
    } else if (effectiveAnchor === "RIGHT_SIDEBAR") {
      const w = Math.round(280 * scaleX);
      const h = Math.round(230 * scaleY);
      bbox = { x: width - placementMargins.right - w, y: Math.round(height * 0.25), width: w, height: h };
    } else if (effectiveAnchor === "TOP_RIGHT") {
      const w = Math.round(290 * scaleX);
      const h = Math.round(140 * scaleY);
      bbox = { x: width - placementMargins.right - w, y: placementMargins.top, width: w, height: h };
    } else {
      const w = Math.round((width - placementMargins.left - placementMargins.right) * 0.92);
      const h = collapsedForVertical ? Math.round(50 * scaleY) : Math.round(110 * scaleY);
      bbox = { x: placementMargins.left, y: topStackY, width: Math.max(180, w), height: h };
      if (visible) topStackY += h + 8;
    }

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
      activeBoxes.push({ id: widget.widget_id, bbox });

      if (!inSafeArea) {
        issues.push({
          gate: "G5",
          code: "HUD_SAFE_AREA_VIOLATION",
          entity_id: widget.widget_id,
          message: `HUD 挂件 ${widget.widget_id} (${widget.type}) 在 ${params.aspect_ratio} 画幅下校验失败：${violationReason}`,
        });
      }
    }

    placed.push({
      widget,
      effective_anchor: effectiveAnchor,
      collapsed_for_vertical: collapsedForVertical,
      visible_at_time: visible,
      bbox,
      in_safe_area: inSafeArea,
      ...(violationReason !== undefined ? { violation_reason: violationReason } : {}),
    });
  }

  return {
    aspect_ratio: params.aspect_ratio,
    canvas_width: width,
    canvas_height: height,
    safe_margins: safeMargins,
    restricted_zones: restrictedZones,
    placed_widgets: placed,
    g5_hud_gate: {
      gate: "G5",
      passed: issues.length === 0,
      issues,
    },
  };
}
