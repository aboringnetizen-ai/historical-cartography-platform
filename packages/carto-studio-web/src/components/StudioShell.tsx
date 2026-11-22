import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DirectorKeyframe,
  HistoricalEvent,
  HistoricalToponym,
  LayerVisibilityConfig,
  VideoExportJobSpec,
} from "@historical-cartography/shared-schema";
import { solvePolityPalette } from "../core/color/ciede2000.ts";
import { DEMO_SCENE_BUNDLES, resolveSceneBundleByEpochId } from "../core/data/demo-dataset.ts";
import { JDN_1BCE, JDN_928_AUG, JDN_929 } from "../core/data/demo-sources-events.ts";
import type { EpochSceneBundle, HistoricalFigure } from "../core/data/demo-types.ts";
import {
  buildDefaultHudWidgets,
  generateVideoStoryboard,
  importRecordingTelemetry,
  interpolateDirectorState,
  layoutHudWidgetsForAspect,
  type HudWidgetSpec,
  type TelemetrySample,
} from "../core/director/recorder-and-hud.ts";
import {
  buildPresetTimelineSpan,
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
import { StyleLayerPanel } from "./StyleLayerPanel.tsx";
import { TopToolbar } from "./TopToolbar.tsx";

const INITIAL_BUNDLE: EpochSceneBundle =
  resolveSceneBundleByEpochId("epoch-928-samanid-ziyarid") ?? DEMO_SCENE_BUNDLES[0]!;

export function StudioShell() {
  const snapshotClient = useMemo(() => {
    const apiBase = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_CARTO_API_BASE;
    return apiBase
      ? new MapSnapshotClient(new HttpSnapshotTransport(apiBase))
      : new MapSnapshotClient(new DemoSnapshotTransport());
  }, []);

  const bridge = useMemo(() => new DeterministicFrameBridge(), []);

  const [bundle, setBundle] = useState<EpochSceneBundle>(INITIAL_BUNDLE);
  const [loadStatus, setLoadStatus] = useState<SnapshotLoadStatus>("READY");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isDemoData, setIsDemoData] = useState<boolean>(true);

  const [activeStyleId, setActiveStyleId] = useState<string>("vivid_video_songti");
  const [stylePatch, setStylePatch] = useState<StylePackPatch>({});
  const [layerConfig, setLayerConfig] = useState<LayerVisibilityConfig>({
    base_mode: "PURE_TERRITORY",
    enabled_overlays: ["admin_divisions", "historical_events", "physical_paleo_geo"],
    control_intensity_render_mode: "OPACITY_GRADIENT",
  });

  const [paletteThemeOverride, setPaletteThemeOverride] = useState<string | null>(null);
  const [autoFourColor, setAutoFourColor] = useState<boolean>(true);
  const [manualColorOverrides, setManualColorOverrides] = useState<Record<string, string>>({});

  const [camera, setCamera] = useState({
    center: INITIAL_BUNDLE.default_camera.center,
    zoom: INITIAL_BUNDLE.default_camera.zoom,
    bearing_deg: 0,
    pitch_deg: 0,
  });

  const [timelineViewport, setTimelineViewport] = useState<TimelineViewport>({
    min_jdn: JDN_1BCE - 365 * 20,
    max_jdn: JDN_929 + 365 * 40,
    cursor_jdn: JDN_928_AUG,
    granularity: "CENTURY",
  });

  const [showStylePanel, setShowStylePanel] = useState<boolean>(true);
  const [showEvidencePanel, setShowEvidencePanel] = useState<boolean>(true);
  const [diffPreviewMode, setDiffPreviewMode] = useState<"AFTER" | "BEFORE">("AFTER");
  const [showGhostBorder, setShowGhostBorder] = useState<boolean>(false);
  const [curtainMode, setCurtainMode] = useState<CurtainMode>("NONE");
  const [curtainRatio, setCurtainRatio] = useState<number>(0.5);

  const [selectedFaceId, setSelectedFaceId] = useState<string | undefined>(undefined);
  const [selectedPolityId, setSelectedPolityId] = useState<string | undefined>(undefined);
  const [spotlightPolityId, setSpotlightPolityId] = useState<string | undefined>(undefined);
  const [selectedToponym, setSelectedToponym] = useState<HistoricalToponym | undefined>(undefined);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(
    INITIAL_BUNDLE.events[0]?.hist_event_id,
  );

  const [aspectRatio, setAspectRatio] = useState<VideoExportJobSpec["aspect_ratio"]>("16:9");
  const [autoReflowVertical, setAutoReflowVertical] = useState<boolean>(true);
  const [showSafeGuides, setShowSafeGuides] = useState<boolean>(false);
  const [directorExpanded, setDirectorExpanded] = useState<boolean>(false);
  const [showDirectorModal, setShowDirectorModal] = useState<boolean>(false);

  const [keyframes, setKeyframes] = useState<DirectorKeyframe[]>(
    () => generateVideoStoryboard({ events: INITIAL_BUNDLE.events }).keyframes,
  );
  const [hudWidgets, setHudWidgets] = useState<HudWidgetSpec[]>(() => buildDefaultHudWidgets(6));
  const [enabledHudTypes, setEnabledHudTypes] = useState<Set<string>>(
    () => new Set(["DATE_ERA_BADGE", "SUBTITLE_BAR"]),
  );
  const [directorTimeSec, setDirectorTimeSec] = useState<number>(0);

  const [isRecording60Hz, setIsRecording60Hz] = useState<boolean>(false);
  const telemetryRef = useRef<TelemetrySample[]>([]);
  const awaitIdleRef = useRef<(() => Promise<void>) | null>(null);
  const [telemetryCount, setTelemetryCount] = useState<number>(0);

  const [labelReport, setLabelReport] = useState<LabelLayoutReport>({
    viewport: { width: 1080, height: 640, zoom: camera.zoom },
    high_priority_threshold: 80,
    placed: [],
    hidden_ids: [],
    high_priority_collision_count: 0,
    g5_label_gate: { gate: "G5", passed: true, issues: [] },
  });

  const resolvedStyle = useMemo(
    () => resolveStylePack(activeStyleId, [], stylePatch),
    [activeStyleId, stylePatch],
  );

  const activePaletteId = paletteThemeOverride ?? resolvedStyle.color_palette_id;

  const displaySnapshot = useMemo(() => {
    if (diffPreviewMode === "BEFORE" && bundle.diff_record) {
      return bundle.diff_record.before_snapshot;
    }
    return bundle.snapshot;
  }, [bundle, diffPreviewMode]);

  const paletteReport = useMemo(
    () =>
      solvePolityPalette({
        snapshot: displaySnapshot,
        polities: bundle.polities,
        palette_id: activePaletteId,
        auto_four_color_solver: autoFourColor,
        manual_overrides: manualColorOverrides,
      }),
    [displaySnapshot, bundle.polities, activePaletteId, autoFourColor, manualColorOverrides],
  );

  const hudLayout = useMemo(
    () =>
      layoutHudWidgetsForAspect({
        widgets: hudWidgets.filter((w) => enabledHudTypes.has(w.type)),
        aspect_ratio: aspectRatio,
        video_time_sec: directorTimeSec,
        auto_reflow_vertical: autoReflowVertical,
      }),
    [hudWidgets, enabledHudTypes, aspectRatio, directorTimeSec, autoReflowVertical],
  );

  const requestSnapshotAtJdn = useCallback(
    async (jdn: number, revisionHint = "latest") => {
      setLoadStatus("LOADING");
      const out = await snapshotClient.loadSnapshot({
        historical_jdn: jdn,
        revision_id: revisionHint,
      });
      if (out.stale_discarded) return;
      if (out.status === "ERROR") {
        setLoadStatus("ERROR");
        setStatusMessage(out.error_message ?? "加载失败");
        return;
      }
      if (out.status === "NO_DATA" || !out.bundle) {
        setLoadStatus("NO_DATA");
        setStatusMessage(out.error_message ?? "暂无资料");
        return;
      }
      setLoadStatus("READY");
      setStatusMessage("");
      setIsDemoData(out.is_demo_data);
      setBundle(out.bundle);
      setDiffPreviewMode("AFTER");
      setSelectedEventId(out.bundle.events[0]?.hist_event_id);
      setCamera((prev) => ({
        ...prev,
        center: out.bundle!.default_camera.center,
        zoom: out.bundle!.default_camera.zoom,
      }));
    },
    [snapshotClient],
  );

  const handleSelectEpoch = useCallback(
    (epochId: string) => {
      const target = resolveSceneBundleByEpochId(epochId);
      if (!target) return;
      setTimelineViewport((prev) => ({ ...prev, cursor_jdn: target.epoch.valid_from_jdn }));
      void requestSnapshotAtJdn(target.epoch.valid_from_jdn, target.revision_id);
    },
    [requestSnapshotAtJdn],
  );

  // 60Hz telemetry live recording sampler
  useEffect(() => {
    if (!isRecording60Hz) return;
    const startPerf = performance.now();
    telemetryRef.current = [];
    let rafId = 0;
    let lastSamplePerf = 0;

    const tick = (now: number) => {
      if (now - lastSamplePerf >= 16) {
        lastSamplePerf = now;
        telemetryRef.current.push({
          elapsed_ms: now - startPerf,
          historical_jdn: timelineViewport.cursor_jdn,
          camera,
          style_id: activeStyleId,
          layer_config: layerConfig,
          active_hud_ids: Array.from(enabledHudTypes),
        });
        setTelemetryCount(telemetryRef.current.length);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isRecording60Hz, timelineViewport.cursor_jdn, camera, activeStyleId, layerConfig, enabledHudTypes]);

  const handleToggleRecording = () => {
    if (isRecording60Hz) {
      setIsRecording60Hz(false);
      const filtered = importRecordingTelemetry(telemetryRef.current);
      if (filtered.length > 0) {
        setKeyframes(filtered);
        setDirectorExpanded(true);
      }
    } else {
      setIsRecording60Hz(true);
    }
  };

  // Register deterministic headless rendering bridge (`window.__STEP_FRAME__`)
  useEffect(() => {
    bridge.registerHandlers({
      onStep: async (timeMs) => {
        const sec = timeMs / 1000;
        setDirectorTimeSec(sec);
        const state = interpolateDirectorState(keyframes, sec);
        setCamera(state.camera);
        setTimelineViewport((prev) => ({ ...prev, cursor_jdn: state.historical_jdn }));
        if (awaitIdleRef.current) {
          await awaitIdleRef.current();
        }
      },
      getLabelReport: () => labelReport,
      getHudLayout: () => hudLayout,
    });
    attachGlobalDeterministicBridge(bridge);
  }, [bridge, keyframes, labelReport, hudLayout]);

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
      if (next.has("FIGURE_PORTRAIT_PIN")) next.delete("FIGURE_PORTRAIT_PIN");
      else next.add("FIGURE_PORTRAIT_PIN");
      return next;
    });
  };

  const g5OverallPassed = labelReport.g5_label_gate.passed && hudLayout.g5_hud_gate.passed;
  const aspectClass =
    aspectRatio === "9:16"
      ? "ratio-9-16"
      : aspectRatio === "1:1"
        ? "ratio-1-1"
        : aspectRatio === "21:9"
          ? "ratio-21-9"
          : "";

  return (
    <div className="studio-shell">
      <TopToolbar
        selectedEpochId={bundle.epoch.epoch_id}
        onSelectEpoch={handleSelectEpoch}
        loadStatus={loadStatus}
        bundle={bundle}
        isDemoData={isDemoData}
        revisionId={displaySnapshot.revision_id}
        baseMode={layerConfig.base_mode}
        onToggleBaseMode={() =>
          setLayerConfig((prev) => ({
            ...prev,
            base_mode: prev.base_mode === "PURE_TERRITORY" ? "CONTROL_INTENSITY" : "PURE_TERRITORY",
          }))
        }
        showGhostBorder={showGhostBorder}
        onToggleGhostBorder={() => setShowGhostBorder((v) => !v)}
        curtainMode={curtainMode}
        onCycleCurtainMode={() =>
          setCurtainMode((m) =>
            m === "NONE" ? "BEFORE_AFTER" : m === "BEFORE_AFTER" ? "PURE_VS_CONTROL" : "NONE",
          )
        }
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
        onRetrySnapshot={() => void requestSnapshotAtJdn(timelineViewport.cursor_jdn, bundle.revision_id)}
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

        <section className="viewport-stage" aria-label="历史地图画布与画幅预览舞台">
          {loadStatus !== "READY" && (
            <div className="status-banner">
              <span>{loadStatus === "LOADING" ? "正在同步时空快照…" : statusMessage}</span>
              {loadStatus === "ERROR" && (
                <button
                  type="button"
                  className="studio-btn warn"
                  onClick={() => void requestSnapshotAtJdn(timelineViewport.cursor_jdn, bundle.revision_id)}
                >
                  重试
                </button>
              )}
            </div>
          )}

          <div className={`aspect-frame ${aspectClass}`}>
            <MapCanvas
              bundle={bundle}
              displaySnapshot={displaySnapshot}
              ghostSnapshot={bundle.diff_record?.before_snapshot}
              stylePack={resolvedStyle}
              layerConfig={layerConfig}
              polityColors={paletteReport.colors_by_polity}
              camera={camera}
              spotlightPolityId={spotlightPolityId ?? selectedPolityId}
              selectedPolityId={selectedPolityId}
              selectedEventId={selectedEventId}
              showGhostBorder={showGhostBorder}
              curtainMode={curtainMode}
              curtainRatio={curtainRatio}
              onCurtainRatioChange={setCurtainRatio}
              onCameraChange={setCamera}
              onSelectFace={(faceId, polityId) => {
                setSelectedFaceId(faceId);
                setSelectedPolityId(polityId);
                setShowEvidencePanel(true);
              }}
              onSelectToponym={(top) => {
                setSelectedToponym(top);
                setShowEvidencePanel(true);
              }}
              onLabelReport={setLabelReport}
              onRegisterAwaitIdle={(fn) => {
                awaitIdleRef.current = fn;
              }}
              bridge={bridge}
            />

            <DirectorHudOverlay
              bundle={bundle}
              hudLayout={hudLayout}
              enabledHudTypes={enabledHudTypes}
              showSafeGuides={showSafeGuides}
              polityColors={paletteReport.colors_by_polity}
            />
          </div>
        </section>

        {showEvidencePanel && (
          <EvidenceDiffDrawer
            bundle={bundle}
            snapshotClient={snapshotClient}
            selectedFaceId={selectedFaceId}
            selectedPolityId={selectedPolityId}
            selectedToponym={selectedToponym}
            selectedEventId={selectedEventId}
            diffPreviewMode={diffPreviewMode}
            onChangeDiffPreviewMode={setDiffPreviewMode}
            onEnableDiffCurtain={() => {
              setCurtainMode("BEFORE_AFTER");
              setShowGhostBorder(true);
            }}
            onSelectEvent={(evId) => {
              const ev = bundle.events.find((item) => item.hist_event_id === evId);
              if (ev) handleSelectEvent(ev);
              else setSelectedEventId(evId);
            }}
            onClose={() => setShowEvidencePanel(false)}
          />
        )}
      </main>

      <BottomTimeline
        bundle={bundle}
        viewport={timelineViewport}
        keyframes={keyframes}
        directorExpanded={directorExpanded}
        paletteId={activePaletteId}
        autoFourColor={autoFourColor}
        paletteReport={paletteReport}
        spotlightPolityId={spotlightPolityId}
        onChangeViewport={(next) => {
          setTimelineViewport(next);
          void requestSnapshotAtJdn(next.cursor_jdn, "latest");
        }}
        onZoomWheel={(anchorRatio, deltaY) => {
          const factor = deltaY > 0 ? 1.25 : 0.8;
          setTimelineViewport((prev) => zoomTimelineViewport(prev, anchorRatio, factor));
        }}
        onSelectGranularity={(granularity) => {
          setTimelineViewport((prev) => buildPresetTimelineSpan(granularity, prev.cursor_jdn));
        }}
        onResetFullTimeline={() =>
          setTimelineViewport((prev) => ({
            ...prev,
            min_jdn: JDN_1BCE - 365 * 20,
            max_jdn: JDN_929 + 365 * 40,
            granularity: "CENTURY",
          }))
        }
        onSelectEvent={handleSelectEvent}
        onSelectFigure={handleSelectFigure}
        onSelectKeyframe={(kf) => {
          setDirectorTimeSec(kf.video_time_sec);
          setCamera(kf.camera);
          setTimelineViewport((prev) => ({ ...prev, cursor_jdn: kf.historical_jdn }));
        }}
        onToggleDirectorExpanded={() => setDirectorExpanded((v) => !v)}
        onSelectPaletteTheme={(id) => setPaletteThemeOverride(id)}
        onToggleAutoFourColor={() => setAutoFourColor((v) => !v)}
        onOverridePolityColor={(polityId, hex) =>
          setManualColorOverrides((prev) => ({ ...prev, [polityId]: hex }))
        }
        onHoverPolity={(pid) => setSpotlightPolityId(pid)}
      />

      {showDirectorModal && (
        <DirectorExportModal
          bundle={bundle}
          keyframes={keyframes}
          hudWidgets={hudWidgets}
          hudLayout={hudLayout}
          enabledHudTypes={enabledHudTypes}
          aspectRatio={aspectRatio}
          autoReflowVertical={autoReflowVertical}
          showSafeGuides={showSafeGuides}
          telemetryCount={telemetryCount}
          bridge={bridge}
          onToggleHudType={(t) =>
            setEnabledHudTypes((prev) => {
              const next = new Set(prev);
              if (next.has(t)) next.delete(t);
              else next.add(t);
              return next;
            })
          }
          onChangeAspectRatio={setAspectRatio}
          onToggleAutoReflowVertical={() => setAutoReflowVertical((v) => !v)}
          onToggleSafeGuides={() => setShowSafeGuides((v) => !v)}
          onGenerateStoryboardFromEvents={(scriptLines) => {
            const generated = generateVideoStoryboard({
              events: bundle.events,
              script_lines: scriptLines,
              style_id: activeStyleId,
              aspect_ratio: aspectRatio,
            });
            setKeyframes(generated.keyframes);
            setHudWidgets(generated.hud_widgets);
            setDirectorExpanded(true);
            setEnabledHudTypes(new Set(generated.hud_widgets.map((w) => w.type)));
          }}
          onUpdateKeyframeFallback={(kfId, fallback) =>
            setKeyframes((prev) =>
              prev.map((k) =>
                k.keyframe_id === kfId ? { ...k, topology_change_fallback: fallback } : k,
              ),
            )
          }
          onPreviewKeyframe={(kf) => {
            setDirectorTimeSec(kf.video_time_sec);
            setCamera(kf.camera);
            setTimelineViewport((prev) => ({ ...prev, cursor_jdn: kf.historical_jdn }));
          }}
          onClose={() => setShowDirectorModal(false)}
        />
      )}
    </div>
  );
}
