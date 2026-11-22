import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DirectorKeyframe,
  HistoricalEvent,
  HistoricalToponym,
  LayerVisibilityConfig,
  SpatialChangeSet,
  VideoExportJobSpec,
} from "@historical-cartography/shared-schema";
import { solvePolityPalette } from "../core/color/ciede2000.ts";
import {
  DEMO_SCENE_BUNDLES,
  resolveSceneBundleByEpochId,
  resolveSceneBundleByJdn,
} from "../core/data/demo-dataset.ts";
import { JDN_960, JDN_976 } from "../core/data/demo-sources-events.ts";
import type { EpochSceneBundle, HistoricalFigure } from "../core/data/demo-types.ts";
import { classifyTopologyTransition } from "../core/director/morph-engine.ts";
import {
  buildDefaultHudWidgets,
  extractHudWindowsFromTelemetry,
  generateVideoStoryboard,
  importRecordingTelemetry,
  interpolateDirectorState,
  layoutHudWidgetsForAspect,
  type HudWidgetSpec,
  type TelemetrySample,
} from "../core/director/recorder-and-hud.ts";
import {
  buildPresetTimelineSpan,
  panTimelineViewport,
  zoomTimelineViewport,
  type TimelineViewport,
} from "../core/director/timeline-math.ts";
import type { LabelLayoutReport } from "../core/layout/label-collision.ts";
import {
  attachGlobalDeterministicBridge,
  DeterministicFrameBridge,
} from "../core/render/deterministic-bridge.ts";
import {
  DemoSnapshotTransport,
  HttpSnapshotTransport,
  MapSnapshotClient,
  type SnapshotLoadStatus,
} from "../core/services/snapshot-client.ts";
import { resolveStylePack, type StylePackPatch } from "../core/styles/style-presets.ts";
import { BottomTimeline } from "./BottomTimeline.tsx";
import { DirectorExportModal } from "./DirectorExportModal.tsx";
import { DirectorHudOverlay } from "./DirectorHudOverlay.tsx";
import { EvidenceDiffDrawer } from "./EvidenceDiffDrawer.tsx";
import { MapCanvas, type CurtainMode } from "./MapCanvas.tsx";
import type { MorphVisualState } from "./map-svg-overlay.tsx";
import { StyleLayerPanel } from "./StyleLayerPanel.tsx";
import { TopToolbar, type GlobalSearchHit } from "./TopToolbar.tsx";
import { attachCartoMcpTools } from "./studio-mcp-bridge.ts";

const INITIAL_BUNDLE: EpochSceneBundle =
  resolveSceneBundleByEpochId("epoch-960-central-asia") ?? DEMO_SCENE_BUNDLES[0]!;

export function StudioShell() {
  const snapshotClient = useMemo(() => {
    const apiBase = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CARTO_API_BASE;
    return apiBase ? new MapSnapshotClient(new HttpSnapshotTransport(apiBase)) : new MapSnapshotClient(new DemoSnapshotTransport());
  }, []);

  const bridge = useMemo(() => new DeterministicFrameBridge(), []);

  const [bundle, setBundle] = useState<EpochSceneBundle>(INITIAL_BUNDLE);
  const [loadStatus, setLoadStatus] = useState<SnapshotLoadStatus>("READY");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [mapErrorMsg, setMapErrorMsg] = useState<string | null>(null);
  const [isDemoData, setIsDemoData] = useState<boolean>(true);

  const [lockedFaceIds, setLockedFaceIds] = useState<Set<string>>(() => new Set());
  const [lockedArcIds, setLockedArcIds] = useState<Set<string>>(() => new Set());
  const [changesetStatuses, setChangesetStatuses] = useState<Record<string, SpatialChangeSet["status"]>>({});
  const [eventConflictOverrides, setEventConflictOverrides] = useState<Record<string, HistoricalEvent["conflict_status"]>>({});

  const [activeStyleId, setActiveStyleId] = useState<string>("vivid_video_songti");
  const [stylePatch, setStylePatch] = useState<StylePackPatch>({});
  const [layerConfig, setLayerConfig] = useState<LayerVisibilityConfig>({
    base_mode: "PURE_TERRITORY",
    enabled_overlays: ["historical_events", "physical_paleo_geo"],
    control_intensity_render_mode: "OPACITY_GRADIENT",
    min_credibility_filter: "T3_GENERAL_ENCYCLOPEDIA",
  });

  const [paletteThemeOverride, setPaletteThemeOverride] = useState<string | null>(null);
  const [autoFourColor, setAutoFourColor] = useState<boolean>(true);
  const [manualColorOverrides, setManualColorOverrides] = useState<Record<string, string>>({});
  const [opacityMultiplier, setOpacityMultiplier] = useState<number>(1.0);
  const [saturationMultiplier, setSaturationMultiplier] = useState<number>(1.0);

  const [camera, setCamera] = useState({
    center: INITIAL_BUNDLE.default_camera.center,
    zoom: INITIAL_BUNDLE.default_camera.zoom,
    bearing_deg: 0,
    pitch_deg: 0,
  });

  const [timelineViewport, setTimelineViewport] = useState<TimelineViewport>({
    min_jdn: JDN_960 - 365,
    max_jdn: JDN_976 + 180,
    cursor_jdn: JDN_960,
    granularity: "YEAR",
  });

  const [showStylePanel, setShowStylePanel] = useState<boolean>(false);
  const [showEvidencePanel, setShowEvidencePanel] = useState<boolean>(false);
  const [diffPreviewMode, setDiffPreviewMode] = useState<"AFTER" | "BEFORE">("AFTER");
  const [showGhostBorder, setShowGhostBorder] = useState<boolean>(false);
  const [curtainMode, setCurtainMode] = useState<CurtainMode>("NONE");
  const [curtainRatio, setCurtainRatio] = useState<number>(0.5);
  const [resetViewTick, setResetViewTick] = useState<number>(0);

  const [selectedFaceId, setSelectedFaceId] = useState<string | undefined>(undefined);
  const [selectedArcId, setSelectedArcId] = useState<string | undefined>(undefined);
  const [selectedPolityId, setSelectedPolityId] = useState<string | undefined>(undefined);
  const [spotlightPolityId, setSpotlightPolityId] = useState<string | undefined>(undefined);
  const [hoverPolityId, setHoverPolityId] = useState<string | undefined>(undefined);
  const [selectedToponym, setSelectedToponym] = useState<HistoricalToponym | undefined>(undefined);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(INITIAL_BUNDLE.events[0]?.hist_event_id);

  const [aspectRatio, setAspectRatio] = useState<VideoExportJobSpec["aspect_ratio"]>("16:9");
  const [autoReflowVertical, setAutoReflowVertical] = useState<boolean>(true);
  const [showSafeGuides, setShowSafeGuides] = useState<boolean>(false);
  const [directorExpanded, setDirectorExpanded] = useState<boolean>(false);
  const [showDirectorModal, setShowDirectorModal] = useState<boolean>(false);

  const [keyframes, setKeyframes] = useState<DirectorKeyframe[]>(
    () => generateVideoStoryboard({ events: INITIAL_BUNDLE.events, bundle: INITIAL_BUNDLE }).keyframes,
  );
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | undefined>(undefined);
  const [hudWidgets, setHudWidgets] = useState<HudWidgetSpec[]>(() => buildDefaultHudWidgets(6, undefined, INITIAL_BUNDLE));
  const [hudCustomPositions, setHudCustomPositions] = useState<Record<string, { x_pct: number; y_pct: number }>>({});
  const [enabledHudTypes, setEnabledHudTypes] = useState<Set<string>>(
    () => new Set(INITIAL_BUNDLE.recommended_hud_types ?? ["DATE_ERA_BADGE", "FIGURE_PORTRAIT_PIN", "SUBTITLE_BAR"]),
  );
  const [directorTimeSec, setDirectorTimeSec] = useState<number>(0);
  const [audioNarrationUri, setAudioNarrationUri] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [morphVisual, setMorphVisual] = useState<MorphVisualState | undefined>(undefined);

  const [isRecording60Hz, setIsRecording60Hz] = useState<boolean>(false);
  const telemetryRef = useRef<TelemetrySample[]>([]);
  const awaitIdleRef = useRef<(() => Promise<void>) | null>(null);
  const liveProjectorRef = useRef<((lonLat: [number, number]) => [number, number]) | undefined>(undefined);
  const captureMapPngRef = useRef<(() => string | null) | undefined>(undefined);
  const [liveMoveTick, setLiveMoveTick] = useState<number>(0);
  const [telemetryCount, setTelemetryCount] = useState<number>(0);

  const [labelReport, setLabelReport] = useState<LabelLayoutReport>({
    viewport: { width: 1080, height: 640, zoom: camera.zoom },
    high_priority_threshold: 80,
    placed: [],
    hidden_ids: [],
    high_priority_collision_count: 0,
    g5_label_gate: { gate: "G5", passed: true, issues: [] },
  });

  // Apply human review / lock overrides declaratively onto active bundle
  const effectiveBundle = useMemo<EpochSceneBundle>(() => {
    const csStatus = changesetStatuses[bundle.epoch.epoch_id];
    return {
      ...bundle,
      canonical_faces: bundle.canonical_faces.map((f) =>
        lockedFaceIds.has(f.face_id) ? { ...f, human_locked_override: !f.human_locked_override } : f,
      ),
      canonical_arcs: bundle.canonical_arcs.map((a) =>
        lockedArcIds.has(a.arc_id) ? { ...a, human_locked_override: !a.human_locked_override } : a,
      ),
      events: bundle.events.map((e) =>
        eventConflictOverrides[e.hist_event_id] ? { ...e, conflict_status: eventConflictOverrides[e.hist_event_id]! } : e,
      ),
      ...(bundle.diff_record
        ? {
            diff_record: {
              ...bundle.diff_record,
              changeset: { ...bundle.diff_record.changeset, status: csStatus ?? bundle.diff_record.changeset.status },
            },
          }
        : {}),
    };
  }, [bundle, lockedFaceIds, lockedArcIds, changesetStatuses, eventConflictOverrides]);

  const resolvedStyle = useMemo(() => resolveStylePack(activeStyleId, [], stylePatch), [activeStyleId, stylePatch]);
  const activePaletteId = paletteThemeOverride ?? resolvedStyle.color_palette_id;

  const displaySnapshot = useMemo(() => {
    if (diffPreviewMode === "BEFORE" && effectiveBundle.diff_record) {
      return effectiveBundle.diff_record.before_snapshot;
    }
    return effectiveBundle.snapshot;
  }, [effectiveBundle, diffPreviewMode]);

  const paletteReport = useMemo(
    () =>
      solvePolityPalette({
        snapshot: displaySnapshot,
        polities: effectiveBundle.polities,
        palette_id: activePaletteId,
        auto_four_color_solver: autoFourColor,
        manual_overrides: manualColorOverrides,
      }),
    [displaySnapshot, effectiveBundle.polities, activePaletteId, autoFourColor, manualColorOverrides],
  );

  const hudLayout = useMemo(
    () =>
      layoutHudWidgetsForAspect({
        widgets: hudWidgets.filter((w) => enabledHudTypes.has(w.type)),
        aspect_ratio: aspectRatio,
        video_time_sec: directorTimeSec,
        auto_reflow_vertical: autoReflowVertical,
        custom_positions: hudCustomPositions,
        figure_pins: effectiveBundle.figures
          .filter((f): f is HistoricalFigure & { coordinates: [number, number] } => Boolean(f.coordinates))
          .map((f) => ({ figure_id: f.figure_id, coordinates: f.coordinates })),
        ...(liveProjectorRef.current ? { project_map_coord: liveProjectorRef.current } : {}),
      }),
    [hudWidgets, enabledHudTypes, aspectRatio, directorTimeSec, autoReflowVertical, hudCustomPositions, effectiveBundle.figures, liveMoveTick],
  );

  const applyBundleTransition = useCallback((nextBundle: EpochSceneBundle, resetCamera = true) => {
    setBundle(nextBundle);
    setDiffPreviewMode("AFTER");
    setSelectedEventId(nextBundle.events[0]?.hist_event_id);
    setSelectedFaceId(undefined);
    setSelectedArcId(undefined);
    setHudCustomPositions({});
    setHudWidgets(buildDefaultHudWidgets(6, undefined, nextBundle));
    if (nextBundle.recommended_style_id) {
      setActiveStyleId(nextBundle.recommended_style_id);
      setStylePatch({});
      setPaletteThemeOverride(null);
    }
    if (nextBundle.recommended_hud_types) {
      setEnabledHudTypes(new Set(nextBundle.recommended_hud_types));
    }
    if (resetCamera) {
      setCamera((prev) => ({
        ...prev,
        center: nextBundle.default_camera.center,
        zoom: nextBundle.default_camera.zoom,
      }));
    }
  }, []);

  const requestSnapshotAtJdn = useCallback(
    async (jdn: number, revisionHint = "latest", resetCamera = true): Promise<EpochSceneBundle | null> => {
      setLoadStatus("LOADING");
      const out = await snapshotClient.loadSnapshot({ historical_jdn: jdn, revision_id: revisionHint });
      if (out.stale_discarded) return null;
      if (out.status === "ERROR") {
        setLoadStatus("ERROR");
        setStatusMessage(out.error_message ?? "加载失败");
        return null;
      }
      if (out.status === "NO_DATA" || !out.bundle) {
        setLoadStatus("NO_DATA");
        setStatusMessage(out.error_message ?? "暂无资料");
        return null;
      }
      setLoadStatus("READY");
      setStatusMessage("");
      setIsDemoData(out.is_demo_data);
      applyBundleTransition(out.bundle, resetCamera);
      return out.bundle;
    },
    [snapshotClient, applyBundleTransition],
  );

  const handleSelectEpoch = useCallback(
    (epochId: string) => {
      const target = resolveSceneBundleByEpochId(epochId);
      if (!target) return;
      setTimelineViewport((prev) => ({ ...prev, cursor_jdn: target.epoch.valid_from_jdn }));
      void requestSnapshotAtJdn(target.epoch.valid_from_jdn, target.revision_id, false);
    },
    [requestSnapshotAtJdn],
  );

  const totalDurationSec = useMemo(
    () => Math.max(6, ...keyframes.map((k) => k.video_time_sec), ...hudWidgets.map((w) => w.visible_to_sec)),
    [keyframes, hudWidgets],
  );

  // Latest state ref keeps 60Hz telemetry recorder stable across pan/zoom
  const latestStateRef = useRef({
    timelineViewport,
    camera,
    activeStyleId,
    layerConfig,
    enabledHudTypes,
    effectiveBundle,
    paletteReport,
    hudWidgets,
    keyframes,
    aspectRatio,
    audioNarrationUri,
  });
  latestStateRef.current = {
    timelineViewport,
    camera,
    activeStyleId,
    layerConfig,
    enabledHudTypes,
    effectiveBundle,
    paletteReport,
    hudWidgets,
    keyframes,
    aspectRatio,
    audioNarrationUri,
  };

  useEffect(() => {
    if (!isRecording60Hz) return;
    const startPerf = performance.now();
    telemetryRef.current = [];
    let rafId = 0;
    const sampleFrame = () => {
      const cur = latestStateRef.current;
      telemetryRef.current.push({
        elapsed_ms: performance.now() - startPerf,
        historical_jdn: cur.timelineViewport.cursor_jdn,
        camera: { ...cur.camera, center: [cur.camera.center[0], cur.camera.center[1]] },
        style_id: cur.activeStyleId,
        layer_config: cur.layerConfig,
        active_hud_ids: [...cur.enabledHudTypes],
      });
      setTelemetryCount(telemetryRef.current.length);
      rafId = requestAnimationFrame(sampleFrame);
    };
    rafId = requestAnimationFrame(sampleFrame);
    return () => cancelAnimationFrame(rafId);
  }, [isRecording60Hz]);

  const handleToggleRecording = () => {
    if (isRecording60Hz) {
      setIsRecording60Hz(false);
      const samples = telemetryRef.current;
      if (samples.length > 0) {
        const imported = importRecordingTelemetry(samples);
        if (imported.length > 0) setKeyframes(imported);
        setHudWidgets((prev) => extractHudWindowsFromTelemetry(samples, prev));
        setDirectorExpanded(true);
      }
    } else {
      setIsRecording60Hz(true);
    }
  };

  // Helper to apply interpolated director state & two-stage morph
  const applyDirectorTimeFrame = useCallback(
    async (sec: number, waitForRender: boolean) => {
      setDirectorTimeSec(sec);
      const state = interpolateDirectorState(keyframes, sec);
      setCamera(state.camera);
      setTimelineViewport((prev) => ({ ...prev, cursor_jdn: state.historical_jdn }));
      if (state.style_id) setActiveStyleId(state.style_id);
      if (state.layer_config) setLayerConfig(state.layer_config);
      setShowGhostBorder(state.enable_ghost_previous_border);

      const fromBundle = state.active_keyframe ? resolveSceneBundleByJdn(state.active_keyframe.historical_jdn) : undefined;
      const toBundle = state.next_keyframe ? resolveSceneBundleByJdn(state.next_keyframe.historical_jdn) : undefined;
      if (fromBundle && toBundle && state.morph_progress > 0 && state.morph_progress < 1) {
        const fromSnap = fromBundle.diff_record?.before_snapshot ?? fromBundle.snapshot;
        const toSnap = toBundle.diff_record?.after_snapshot ?? toBundle.snapshot;
        const fallback = state.next_keyframe?.topology_change_fallback ?? "OCCUPATION_RIPPLE";
        const plan = classifyTopologyTransition(fromSnap, toSnap, fallback);
        setMorphVisual({ from_snapshot: fromSnap, to_snapshot: toSnap, progress: state.morph_progress, plan, fallback });
      } else {
        setMorphVisual(undefined);
      }

      const curBundle = latestStateRef.current.effectiveBundle;
      if (
        (state.historical_jdn < curBundle.epoch.valid_from_jdn || state.historical_jdn >= curBundle.epoch.valid_to_jdn)
        && waitForRender
      ) {
        await requestSnapshotAtJdn(state.historical_jdn, "latest", false);
      }

      if (waitForRender) {
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        if (awaitIdleRef.current) await awaitIdleRef.current();
      }
    },
    [keyframes, requestSnapshotAtJdn],
  );

  // Director playback loop
  useEffect(() => {
    if (!isPlaying) return;
    let lastPerf = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const dt = (now - lastPerf) / 1000;
      lastPerf = now;
      setDirectorTimeSec((prev) => {
        const next = prev + dt * playbackRate;
        if (next >= totalDurationSec) {
          setIsPlaying(false);
          return totalDurationSec;
        }
        const st = interpolateDirectorState(keyframes, next);
        setCamera(st.camera);
        setTimelineViewport((vp) => ({ ...vp, cursor_jdn: st.historical_jdn }));
        if (st.style_id) setActiveStyleId(st.style_id);
        if (st.layer_config) setLayerConfig(st.layer_config);
        setShowGhostBorder(st.enable_ghost_previous_border);
        const target = resolveSceneBundleByJdn(st.historical_jdn);
        if (target && target.epoch.epoch_id !== latestStateRef.current.effectiveBundle.epoch.epoch_id) {
          applyBundleTransition(target, false);
        }
        if (st.active_keyframe && st.next_keyframe && st.morph_progress > 0 && st.morph_progress < 1) {
          const fromB = resolveSceneBundleByJdn(st.active_keyframe.historical_jdn);
          const toB = resolveSceneBundleByJdn(st.next_keyframe.historical_jdn);
          if (fromB && toB) {
            const fb = st.next_keyframe.topology_change_fallback ?? "OCCUPATION_RIPPLE";
            setMorphVisual({
              from_snapshot: fromB.diff_record?.before_snapshot ?? fromB.snapshot,
              to_snapshot: toB.diff_record?.after_snapshot ?? toB.snapshot,
              progress: st.morph_progress,
              plan: classifyTopologyTransition(fromB.snapshot, toB.snapshot, fb),
              fallback: fb,
            });
          }
        } else {
          setMorphVisual(undefined);
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, playbackRate, totalDurationSec, keyframes, applyBundleTransition]);

  // Deterministic frame bridge (__STEP_FRAME__) & SPEC §10 MCP interface
  useEffect(() => {
    bridge.setSignals({ style_version: activeStyleId, resource_version: effectiveBundle.revision_id });
    bridge.registerHandlers({
      onStep: async (timeMs) => applyDirectorTimeFrame(timeMs / 1000, true),
      getLabelReport: () => labelReport,
      getHudLayout: () => hudLayout,
    });
    attachGlobalDeterministicBridge(bridge);
  }, [bridge, activeStyleId, effectiveBundle.revision_id, applyDirectorTimeFrame, labelReport, hudLayout]);

  useEffect(() => {
    attachCartoMcpTools({
      getBundle: () => latestStateRef.current.effectiveBundle,
      getStyleState: () => ({ style_id: latestStateRef.current.activeStyleId, layer_config: latestStateRef.current.layerConfig }),
      getPaletteReport: () => latestStateRef.current.paletteReport,
      getTimelineViewport: () => latestStateRef.current.timelineViewport,
      getKeyframes: () => latestStateRef.current.keyframes,
      getHudWidgets: () => latestStateRef.current.hudWidgets,
      getAspectRatio: () => latestStateRef.current.aspectRatio,
      getAudioNarrationUri: () => latestStateRef.current.audioNarrationUri,
      captureMapPng: () => captureMapPngRef.current?.() ?? null,
      applyComposedStyle: (sid, ov, lc) => {
        setActiveStyleId(sid);
        if (ov) setStylePatch(ov);
        if (lc) setLayerConfig(lc);
      },
      applyPaletteUpdate: (p) => {
        if (p.palette_id !== undefined) setPaletteThemeOverride(p.palette_id);
        if (p.auto_four_color_solver !== undefined) setAutoFourColor(p.auto_four_color_solver);
        if (p.manual_overrides) setManualColorOverrides((prev) => ({ ...prev, ...p.manual_overrides }));
        if (p.opacity_multiplier !== undefined) setOpacityMultiplier(p.opacity_multiplier);
        if (p.saturation_multiplier !== undefined) setSaturationMultiplier(p.saturation_multiplier);
      },
      applyTimelineCursor: (jdn, gran) => {
        setTimelineViewport((vp) => ({ ...vp, cursor_jdn: jdn, ...(gran ? { granularity: gran } : {}) }));
        void requestSnapshotAtJdn(jdn, "latest", true);
      },
      applyStoryboard: (kfs, wids) => {
        setKeyframes(kfs);
        setHudWidgets(wids);
        setDirectorExpanded(true);
      },
    });
  }, [requestSnapshotAtJdn]);

  const handleSelectSearchHit = (hit: GlobalSearchHit) => {
    if (hit.jdn !== undefined) setTimelineViewport((vp) => ({ ...vp, cursor_jdn: hit.jdn! }));
    const target = resolveSceneBundleByEpochId(hit.epoch_id);
    if (target) {
      applyBundleTransition(target, false);
      if (hit.coordinates) setCamera((prev) => ({ ...prev, center: hit.coordinates!, zoom: 6.2 }));
    }
    setSelectedPolityId(hit.polity_id);
    setSelectedEventId(hit.event_id);
    if (hit.toponym_id && target) {
      setSelectedToponym(target.toponyms.find((t) => t.toponym_id === hit.toponym_id));
    }
    setShowEvidencePanel(true);
  };

  const handleSelectEvent = (event: HistoricalEvent) => {
    setSelectedEventId(event.hist_event_id);
    setShowEvidencePanel(true);
    setTimelineViewport((prev) => ({ ...prev, cursor_jdn: event.time_start.julian_day_number }));
    void requestSnapshotAtJdn(event.time_start.julian_day_number, "latest");
  };

  const handleSelectFigure = (fig: HistoricalFigure) => {
    setSpotlightPolityId((cur) => (cur === fig.polity_id ? undefined : fig.polity_id));
    setSelectedPolityId(fig.polity_id);
    setEnabledHudTypes((prev) => {
      const next = new Set(prev);
      next.add("FIGURE_PORTRAIT_PIN");
      return next;
    });
  };

  const g5OverallPassed = labelReport.g5_label_gate.passed && hudLayout.g5_hud_gate.passed;
  const aspectClass =
    aspectRatio === "9:16" ? "ratio-9-16" : aspectRatio === "1:1" ? "ratio-1-1" : aspectRatio === "21:9" ? "ratio-21-9" : "ratio-16-9";

  return (
    <div className="studio-shell">
      <TopToolbar
        selectedEpochId={effectiveBundle.epoch.epoch_id}
        allBundles={DEMO_SCENE_BUNDLES}
        onSelectEpoch={handleSelectEpoch}
        onSelectSearchHit={handleSelectSearchHit}
        loadStatus={loadStatus}
        bundle={effectiveBundle}
        isDemoData={isDemoData}
        revisionId={displaySnapshot.revision_id}
        baseMode={layerConfig.base_mode}
        onToggleBaseMode={() =>
          setLayerConfig((prev) => ({ ...prev, base_mode: prev.base_mode === "PURE_TERRITORY" ? "CONTROL_INTENSITY" : "PURE_TERRITORY" }))
        }
        showGhostBorder={showGhostBorder}
        onToggleGhostBorder={() => setShowGhostBorder((v) => !v)}
        curtainMode={curtainMode}
        onChangeCurtainMode={setCurtainMode}
        aspectRatio={aspectRatio}
        onChangeAspectRatio={(r) => {
          setAspectRatio(r);
          if (r === "9:16") setShowSafeGuides(true);
        }}
        showStylePanel={showStylePanel}
        onToggleStylePanel={() => setShowStylePanel((v) => !v)}
        showEvidencePanel={showEvidencePanel}
        onToggleEvidencePanel={() => setShowEvidencePanel((v) => !v)}
        isRecording60Hz={isRecording60Hz}
        onToggleRecording={handleToggleRecording}
        onOpenDirectorModal={() => setShowDirectorModal(true)}
        onRetrySnapshot={() => void requestSnapshotAtJdn(timelineViewport.cursor_jdn, effectiveBundle.revision_id)}
        g5GatePassed={g5OverallPassed}
      />

      <main className="workspace-main">
        {showStylePanel && (
          <StyleLayerPanel
            activeStyleId={activeStyleId}
            resolvedStyle={resolvedStyle}
            layerConfig={layerConfig}
            labelReport={labelReport}
            onSelectStylePreset={(id) => {
              setActiveStyleId(id);
              setStylePatch({});
              setPaletteThemeOverride(null);
            }}
            onPatchStyle={(patch) =>
              setStylePatch((prev) => ({
                ...prev,
                ...patch,
                basemap: { ...prev.basemap, ...patch.basemap },
                border_shader: { ...prev.border_shader, ...patch.border_shader },
                territory_rendering: { ...prev.territory_rendering, ...patch.territory_rendering },
                typography: { ...prev.typography, ...patch.typography },
              }))
            }
            onUpdateLayerConfig={setLayerConfig}
          />
        )}

        <div className="viewport-stage">
          <div className={`aspect-frame ${aspectClass}`}>
            <MapCanvas
              bundle={effectiveBundle}
              displaySnapshot={displaySnapshot}
              ghostSnapshot={effectiveBundle.diff_record?.before_snapshot}
              morphVisual={morphVisual}
              currentJdn={timelineViewport.cursor_jdn}
              stylePack={resolvedStyle}
              layerConfig={layerConfig}
              polityColors={paletteReport.colors_by_polity}
              opacityMultiplier={opacityMultiplier}
              saturationMultiplier={saturationMultiplier}
              camera={camera}
              spotlightPolityId={spotlightPolityId ?? hoverPolityId}
              selectedPolityId={selectedPolityId}
              selectedEventId={selectedEventId}
              showGhostBorder={showGhostBorder}
              curtainMode={curtainMode}
              curtainRatio={curtainRatio}
              resetViewTick={resetViewTick}
              onCurtainRatioChange={setCurtainRatio}
              onCameraChange={setCamera}
              onLiveProjectorReady={(fn) => {
                liveProjectorRef.current = fn;
              }}
              onLiveFrameMove={setLiveMoveTick}
              onSelectFace={(faceId, polityId) => {
                setSelectedFaceId(faceId);
                setSelectedArcId(undefined);
                setSelectedPolityId(polityId);
                setShowEvidencePanel(true);
              }}
              onSelectArc={(arcId) => {
                setSelectedArcId(arcId);
                setShowEvidencePanel(true);
              }}
              onSelectToponym={(top) => {
                setSelectedToponym(top);
                setShowEvidencePanel(true);
              }}
              onSelectEventId={(evId) => {
                setSelectedEventId(evId);
                setShowEvidencePanel(true);
              }}
              onLabelReport={setLabelReport}
              onRegisterAwaitIdle={(fn) => {
                awaitIdleRef.current = fn;
              }}
              onMapError={setMapErrorMsg}
              onCanvasReady={(fn) => {
                captureMapPngRef.current = fn;
              }}
              bridge={bridge}
            />

            <DirectorHudOverlay
              bundle={effectiveBundle}
              displaySnapshot={displaySnapshot}
              stylePack={resolvedStyle}
              hudLayout={hudLayout}
              enabledHudTypes={enabledHudTypes}
              showSafeGuides={showSafeGuides}
              polityColors={paletteReport.colors_by_polity}
              camera={camera}
              selectedPolityId={selectedPolityId}
              spotlightPolityId={spotlightPolityId}
              {...(liveProjectorRef.current ? { projectCoord: liveProjectorRef.current } : {})}
              liveMoveTick={liveMoveTick}
              onMoveWidget={(wid, pos) => setHudCustomPositions((prev) => ({ ...prev, [wid]: pos }))}
            />
          </div>

          {(loadStatus === "NO_DATA" || loadStatus === "ERROR" || mapErrorMsg) && (
            <div className="status-banner" style={{ borderColor: loadStatus === "ERROR" || mapErrorMsg ? "#ef4444" : "#f59e0b" }}>
              <span>{mapErrorMsg ?? statusMessage}</span>
              {mapErrorMsg && (
                <button type="button" className="studio-btn" style={{ padding: "2px 6px", fontSize: 10 }} onClick={() => setMapErrorMsg(null)}>
                  忽略
                </button>
              )}
              {loadStatus !== "READY" && (
                <button type="button" className="studio-btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => handleSelectEpoch("epoch-960-central-asia")}>
                  返回公元 960 年中亚基线
                </button>
              )}
            </div>
          )}
        </div>

        {showEvidencePanel && (
          <EvidenceDiffDrawer
            bundle={effectiveBundle}
            snapshotClient={snapshotClient}
            selectedFaceId={selectedFaceId}
            selectedArcId={selectedArcId}
            selectedPolityId={selectedPolityId}
            spotlightPolityId={spotlightPolityId}
            selectedToponym={selectedToponym}
            selectedEventId={selectedEventId}
            diffPreviewMode={diffPreviewMode}
            onChangeDiffPreviewMode={setDiffPreviewMode}
            onEnableDiffCurtain={() => setCurtainMode("BEFORE_AFTER")}
            onSelectEvent={setSelectedEventId}
            onToggleSpotlightPolity={(pid) => setSpotlightPolityId((cur) => (cur === pid ? undefined : pid))}
            onToggleLockFace={(fid) =>
              setLockedFaceIds((prev) => {
                const next = new Set(prev);
                if (next.has(fid)) next.delete(fid);
                else next.add(fid);
                return next;
              })
            }
            onToggleLockArc={(aid) =>
              setLockedArcIds((prev) => {
                const next = new Set(prev);
                if (next.has(aid)) next.delete(aid);
                else next.add(aid);
                return next;
              })
            }
            onReviewChangeset={(status) => setChangesetStatuses((prev) => ({ ...prev, [effectiveBundle.epoch.epoch_id]: status }))}
            onArbitrateEvent={(eid, nextSt) => setEventConflictOverrides((prev) => ({ ...prev, [eid]: nextSt }))}
            onFlyToCoords={(coords, zoom) => setCamera((prev) => ({ ...prev, center: coords, zoom: zoom ?? prev.zoom }))}
            onClose={() => setShowEvidencePanel(false)}
          />
        )}
      </main>

      <BottomTimeline
        bundle={effectiveBundle}
        allBundles={DEMO_SCENE_BUNDLES}
        viewport={timelineViewport}
        keyframes={keyframes}
        selectedKeyframeId={selectedKeyframeId}
        directorExpanded={directorExpanded}
        directorTimeSec={directorTimeSec}
        totalDurationSec={totalDurationSec}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        isRecording60Hz={isRecording60Hz}
        audioNarrationUri={audioNarrationUri}
        paletteId={activePaletteId}
        autoFourColor={autoFourColor}
        paletteReport={paletteReport}
        opacityMultiplier={opacityMultiplier}
        saturationMultiplier={saturationMultiplier}
        spotlightPolityId={spotlightPolityId ?? hoverPolityId}
        onChangeViewport={(next) => {
          setTimelineViewport(next);
          if (Math.abs(next.cursor_jdn - timelineViewport.cursor_jdn) > 0.05) {
            void requestSnapshotAtJdn(next.cursor_jdn, "latest", false);
          }
        }}
        onPanTimeline={(deltaRatio) => setTimelineViewport((prev) => panTimelineViewport(prev, deltaRatio))}
        onZoomWheel={(ratio, deltaY) =>
          setTimelineViewport((prev) => zoomTimelineViewport(prev, ratio, deltaY < 0 ? 0.76 : 1.32))
        }
        onSelectGranularity={(gran) => setTimelineViewport((prev) => buildPresetTimelineSpan(gran, prev.cursor_jdn))}
        onResetFullTimeline={() => {
          setTimelineViewport({ min_jdn: JDN_960 - 365, max_jdn: JDN_976 + 180, cursor_jdn: timelineViewport.cursor_jdn, granularity: "YEAR" });
          setResetViewTick((t) => t + 1);
        }}
        onSelectEvent={handleSelectEvent}
        onSelectFigure={handleSelectFigure}
        onSelectKeyframe={(kf) => {
          setSelectedKeyframeId(kf.keyframe_id);
          void applyDirectorTimeFrame(kf.video_time_sec, false);
        }}
        onAddKeyframe={() => {
          const id = `kf-custom-${Date.now()}`;
          const newKf: DirectorKeyframe = {
            keyframe_id: id,
            video_time_sec: Number(directorTimeSec.toFixed(2)),
            historical_jdn: timelineViewport.cursor_jdn,
            camera: { ...camera, center: [camera.center[0], camera.center[1]] as [number, number] },
            easing: "CAMERA_FLY_TO",
            style_id: activeStyleId,
            layer_config: layerConfig,
            enable_ghost_previous_border: showGhostBorder,
            topology_change_fallback: "OCCUPATION_RIPPLE",
          };
          setKeyframes((prev) => [...prev, newKf].sort((a, b) => a.video_time_sec - b.video_time_sec));
          setSelectedKeyframeId(id);
        }}
        onDeleteKeyframe={(kfId) => setKeyframes((prev) => prev.filter((k) => k.keyframe_id !== kfId))}
        onMoveKeyframeTime={(kfId, nextSec) =>
          setKeyframes((prev) =>
            prev.map((k) => (k.keyframe_id === kfId ? { ...k, video_time_sec: nextSec } : k)).sort((a, b) => a.video_time_sec - b.video_time_sec),
          )
        }
        onScrubDirectorTime={(sec) => void applyDirectorTimeFrame(sec, false)}
        onTogglePlay={() => {
          if (!isPlaying && directorTimeSec >= totalDurationSec - 0.05) setDirectorTimeSec(0);
          setIsPlaying((v) => !v);
        }}
        onChangePlaybackRate={setPlaybackRate}
        onStepEpoch={(dir) => {
          const idx = DEMO_SCENE_BUNDLES.findIndex((b) => b.epoch.epoch_id === effectiveBundle.epoch.epoch_id);
          const nextIdx = (idx + dir + DEMO_SCENE_BUNDLES.length) % DEMO_SCENE_BUNDLES.length;
          handleSelectEpoch(DEMO_SCENE_BUNDLES[nextIdx]!.epoch.epoch_id);
        }}
        onToggleRecord60Hz={handleToggleRecording}
        onOpenExportModal={() => setShowDirectorModal(true)}
        onToggleDirectorExpanded={() => setDirectorExpanded((v) => !v)}
        onSelectPaletteTheme={(pid) => setPaletteThemeOverride(pid)}
        onToggleAutoFourColor={() => setAutoFourColor((v) => !v)}
        onOverridePolityColor={(polityId, hex) => setManualColorOverrides((prev) => ({ ...prev, [polityId]: hex }))}
        onResetPolityOverrides={() => {
          setManualColorOverrides({});
          setOpacityMultiplier(1.0);
          setSaturationMultiplier(1.0);
        }}
        onChangeOpacityMultiplier={setOpacityMultiplier}
        onChangeSaturationMultiplier={setSaturationMultiplier}
        onHoverPolity={setHoverPolityId}
      />

      {showDirectorModal && (
        <DirectorExportModal
          bundle={effectiveBundle}
          displaySnapshot={displaySnapshot}
          stylePack={resolvedStyle}
          polityColors={paletteReport.colors_by_polity}
          keyframes={keyframes}
          hudWidgets={hudWidgets}
          hudLayout={hudLayout}
          enabledHudTypes={enabledHudTypes}
          aspectRatio={aspectRatio}
          autoReflowVertical={autoReflowVertical}
          showSafeGuides={showSafeGuides}
          telemetryCount={telemetryCount}
          audioNarrationUri={audioNarrationUri}
          bridge={bridge}
          captureMapPng={() => captureMapPngRef.current?.() ?? null}
          onToggleHudType={(t) =>
            setEnabledHudTypes((prev) => {
              const next = new Set(prev);
              if (next.has(t)) next.delete(t);
              else next.add(t);
              return next;
            })
          }
          onChangeAspectRatio={(r) => {
            setAspectRatio(r);
            if (r === "9:16") setShowSafeGuides(true);
          }}
          onToggleAutoReflowVertical={() => setAutoReflowVertical((v) => !v)}
          onToggleSafeGuides={() => setShowSafeGuides((v) => !v)}
          onChangeAudioNarrationUri={setAudioNarrationUri}
          onGenerateStoryboardFromEvents={(lines) => {
            const generated = generateVideoStoryboard({
              events: effectiveBundle.events,
              script_lines: lines,
              style_id: activeStyleId,
              aspect_ratio: aspectRatio,
              bundle: effectiveBundle,
            });
            setKeyframes(generated.keyframes);
            setHudWidgets(generated.hud_widgets);
            setDirectorExpanded(true);
          }}
          onUpdateKeyframe={(kfId, patch) =>
            setKeyframes((prev) => prev.map((k) => (k.keyframe_id === kfId ? { ...k, ...patch } : k)))
          }
          onUpdateHudWidget={(wid, patch) =>
            setHudWidgets((prev) => prev.map((w) => (w.widget_id === wid ? { ...w, ...patch } : w)))
          }
          onPreviewKeyframe={(kf) => void applyDirectorTimeFrame(kf.video_time_sec, false)}
          onClose={() => setShowDirectorModal(false)}
        />
      )}
    </div>
  );
}
