import type {
  DirectorKeyframe,
  LayerVisibilityConfig,
  VideoExportJobSpec,
} from "@historical-cartography/shared-schema";
import type { PaletteSolveReport } from "../core/color/ciede2000.ts";
import { DEMO_SCENE_BUNDLES, resolveSceneBundleByJdn } from "../core/data/demo-dataset.ts";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import {
  generateVideoStoryboard,
  importRecordingTelemetry,
  type HudWidgetSpec,
  type TelemetrySample,
} from "../core/director/recorder-and-hud.ts";
import { configureBottomTimeline, type BottomTimelineConfig, type TimelineViewport } from "../core/director/timeline-math.ts";
import { composeMapStyle, type StylePackPatch } from "../core/styles/style-presets.ts";
import { generateStandaloneSvgExport } from "./export-generators.ts";

export interface CartoMcpBridgeHandlers {
  getBundle: () => EpochSceneBundle;
  getStyleState: () => { style_id: string; layer_config: LayerVisibilityConfig };
  getPaletteReport: () => PaletteSolveReport;
  getTimelineViewport: () => TimelineViewport;
  getKeyframes: () => DirectorKeyframe[];
  getHudWidgets: () => HudWidgetSpec[];
  getAspectRatio: () => VideoExportJobSpec["aspect_ratio"];
  getAudioNarrationUri: () => string;
  captureMapPng: () => string | null;
  applyComposedStyle: (styleId: string, overrides?: StylePackPatch, layerConfig?: LayerVisibilityConfig) => void;
  applyPaletteUpdate: (params: {
    palette_id?: string;
    auto_four_color_solver?: boolean;
    manual_overrides?: Record<string, string>;
    opacity_multiplier?: number;
    saturation_multiplier?: number;
  }) => void;
  applyTimelineCursor: (cursorJdn: number, granularity?: TimelineViewport["granularity"]) => void;
  applyStoryboard: (keyframes: DirectorKeyframe[], widgets: HudWidgetSpec[]) => void;
}

export function attachCartoMcpTools(h: CartoMcpBridgeHandlers): Record<string, unknown> {
  const api = {
    compose_map_style: (params: {
      style_id: string;
      overrides?: StylePackPatch;
      layer_config?: LayerVisibilityConfig;
    }) => {
      const current = h.getStyleState();
      const targetLayer = params.layer_config ?? current.layer_config;
      const result = composeMapStyle({
        style_id: params.style_id,
        ...(params.overrides ? { overrides: params.overrides } : {}),
        layer_config: targetLayer,
      });
      h.applyComposedStyle(params.style_id, params.overrides, targetLayer);
      return result;
    },

    update_polity_palette: (params: {
      palette_id?: string;
      auto_four_color_solver?: boolean;
      manual_overrides?: Record<string, string>;
      opacity_multiplier?: number;
      saturation_multiplier?: number;
    }) => {
      h.applyPaletteUpdate(params);
      return h.getPaletteReport();
    },

    configure_bottom_timeline: (params: Partial<BottomTimelineConfig> & { cursor_jdn?: number; granularity?: TimelineViewport["granularity"] }) => {
      if (params.cursor_jdn !== undefined) {
        h.applyTimelineCursor(params.cursor_jdn, params.granularity);
      }
      const bundle = h.getBundle();
      return configureBottomTimeline({
        viewport: params.viewport ?? h.getTimelineViewport(),
        director_track_expanded: params.director_track_expanded ?? true,
        dynasty_bands: params.dynasty_bands ?? [],
        figures: params.figures ?? bundle.figures,
        events: params.events ?? bundle.events,
        keyframes: params.keyframes ?? h.getKeyframes(),
      });
    },

    generate_video_storyboard: (params: { script_lines?: string[]; style_id?: string; aspect_ratio?: VideoExportJobSpec["aspect_ratio"]; epoch_id?: string }) => {
      const targetBundle = params.epoch_id
        ? DEMO_SCENE_BUNDLES.find((b) => b.epoch.epoch_id === params.epoch_id) ?? h.getBundle()
        : h.getBundle();
      const board = generateVideoStoryboard({
        events: targetBundle.events,
        ...(params.script_lines ? { script_lines: params.script_lines } : {}),
        ...(params.style_id ? { style_id: params.style_id } : {}),
        aspect_ratio: params.aspect_ratio ?? h.getAspectRatio(),
        bundle: targetBundle,
      });
      h.applyStoryboard(board.keyframes, board.hud_widgets);
      return board;
    },

    import_recording_telemetry: (params: { samples: TelemetrySample[]; tolerance_deg?: number }) => {
      const imported = importRecordingTelemetry(params.samples, params.tolerance_deg);
      h.applyStoryboard(imported, h.getHudWidgets());
      return { keyframe_count: imported.length, keyframes: imported };
    },

    export_historical_map: (params: { format: "PNG" | "SVG" | "GEOJSON"; historical_jdn?: number }) => {
      const targetBundle = params.historical_jdn !== undefined
        ? resolveSceneBundleByJdn(params.historical_jdn) ?? h.getBundle()
        : h.getBundle();
      if (params.format === "PNG") {
        return { format: "PNG", epoch_id: targetBundle.epoch.epoch_id, data_url: h.captureMapPng() };
      }
      if (params.format === "GEOJSON") {
        return { format: "GEOJSON", epoch_id: targetBundle.epoch.epoch_id, snapshot: targetBundle.snapshot };
      }
      const composed = composeMapStyle({
        style_id: h.getStyleState().style_id,
        layer_config: h.getStyleState().layer_config,
      });
      return {
        format: "SVG",
        epoch_id: targetBundle.epoch.epoch_id,
        svg: generateStandaloneSvgExport(
          targetBundle,
          targetBundle.snapshot,
          composed.resolved_style,
          h.getPaletteReport().colors_by_polity,
        ),
      };
    },

    render_video_export: (params?: { resolution?: VideoExportJobSpec["resolution"]; fps?: VideoExportJobSpec["fps"]; output_format?: VideoExportJobSpec["output_format"] }) => {
      const bundle = h.getBundle();
      const audio = h.getAudioNarrationUri();
      const spec: VideoExportJobSpec = {
        project_id: `proj-${bundle.epoch.epoch_id}`,
        aspect_ratio: h.getAspectRatio(),
        resolution: params?.resolution ?? "1080p",
        fps: params?.fps ?? 60,
        output_format: params?.output_format ?? "MP4_H264",
        keyframes: h.getKeyframes(),
        hud_widgets: h.getHudWidgets(),
        ...(audio ? { audio_narration_uri: audio } : {}),
        auto_generate_srt: true,
        auto_generate_bibliography_credits: true,
      };
      return spec;
    },
  };

  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__CARTO_MCP__ = api;
  }
  return api;
}
