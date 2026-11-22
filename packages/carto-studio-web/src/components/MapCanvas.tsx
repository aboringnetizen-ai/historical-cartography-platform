import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  ComposableStylePack,
  HistoricalToponym,
  LayerVisibilityConfig,
  MapSnapshot,
} from "@historical-cartography/shared-schema";
import type { FeatureCollection, LineString } from "geojson";
import { hexToRgb } from "../core/color/ciede2000.ts";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import { extractPolityOuterPerimeterRings } from "../core/data/topology-builder.ts";
import { interpolateMorphSnapshot } from "../core/director/morph-engine.ts";
import {
  buildPolitySpineLabels,
  estimateTextWidthPx,
  evaluateToponymLayout,
  projectLonLatToScreen,
  type LabelLayoutReport,
  type ScreenBox,
} from "../core/layout/label-collision.ts";
import type { DeterministicFrameBridge } from "../core/render/deterministic-bridge.ts";
import { MapCurtainView } from "./MapCurtainView.tsx";
import {
  buildBoundaryRenderCollection,
  buildFullWorldPolygonGeoJson,
  buildGraticuleGeoJson,
  buildPaleoAndCustomCollections,
  buildTerritoryRenderCollection,
  type CurtainMode,
} from "./map-geojson-builders.ts";
import { MapSvgOverlay, type MorphVisualState } from "./map-svg-overlay.tsx";
import {
  AWS_TERRARIUM_DEM_TILES,
  BorderShaderWebGLLayer,
  buildConcaveSafeInwardRibbonBuffer,
  buildPolygonHatchBuffer,
  buildTerritoryFillBuffer,
  getParchmentPatternData,
  getRealBasemapTheme,
} from "./map-webgl-layers.tsx";

export type { CurtainMode };

export interface MapCanvasProps {
  bundle: EpochSceneBundle;
  displaySnapshot: MapSnapshot;
  ghostSnapshot?: MapSnapshot | undefined;
  morphVisual?: MorphVisualState | undefined;
  currentJdn?: number | undefined;
  stylePack: ComposableStylePack;
  layerConfig: LayerVisibilityConfig;
  polityColors: Record<string, string>;
  opacityMultiplier?: number | undefined;
  saturationMultiplier?: number | undefined;
  camera: { center: [number, number]; zoom: number; bearing_deg: number; pitch_deg: number };
  spotlightPolityId?: string | undefined;
  selectedPolityId?: string | undefined;
  selectedEventId?: string | undefined;
  showGhostBorder: boolean;
  curtainMode: CurtainMode;
  curtainRatio: number;
  resetViewTick?: number | undefined;
  onCurtainRatioChange: (ratio: number) => void;
  onCameraChange: (cam: { center: [number, number]; zoom: number; bearing_deg: number; pitch_deg: number }) => void;
  onLiveProjectorReady?: (projectFn: (lonLat: [number, number]) => [number, number]) => void;
  onLiveFrameMove?: (tick: number) => void;
  onSelectFace: (faceId: string, polityId?: string) => void;
  onSelectArc?: (arcId: string) => void;
  onSelectToponym: (toponym: HistoricalToponym) => void;
  onSelectEventId?: (eventId: string) => void;
  onLabelReport: (report: LabelLayoutReport) => void;
  onRegisterAwaitIdle?: (fn: () => Promise<void>) => void;
  onMapError?: (message: string) => void;
  onCanvasReady?: (capturePng: () => string | null) => void;
  bridge: DeterministicFrameBridge;
}

export function MapCanvas(props: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const shaderLayerRef = useRef<BorderShaderWebGLLayer | null>(null);
  const draggingCurtainRef = useRef(false);
  const currentTileUrlRef = useRef<string>("");
  const onSelectFaceRef = useRef(props.onSelectFace);
  const onSelectArcRef = useRef(props.onSelectArc);
  onSelectFaceRef.current = props.onSelectFace;
  onSelectArcRef.current = props.onSelectArc;

  const [webglFallback, setWebglFallback] = useState(false);
  const [mapStyleReady, setMapStyleReady] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 720 });
  const [liveFrameTick, setLiveFrameTick] = useState(0);
  const [liveView, setLiveView] = useState(props.camera);
  const userNavigatedRef = useRef(false);

  const fitOverviewBounds = useCallback((map: maplibregl.Map | null) => {
    if (!map) return;
    map.fitBounds(
      [
        [44.5, 25.5],
        [91.5, 51.5],
      ],
      {
        padding: { top: 36, bottom: 56, left: 22, right: 22 },
        duration: 0,
      },
    );
  }, []);

  const effectiveSnapshot = useMemo(() => {
    const mv = props.morphVisual;
    if (mv && mv.plan.is_homeomorphic && mv.progress > 0 && mv.progress < 1) {
      return interpolateMorphSnapshot(mv.from_snapshot, mv.to_snapshot, mv.progress, mv.plan);
    }
    return props.displaySnapshot;
  }, [props.morphVisual, props.displaySnapshot]);

  const spotlightActive =
    props.stylePack.border_shader.mode === "spotlight_isolation" && Boolean(props.spotlightPolityId);

  const basemapTheme = useMemo(
    () =>
      getRealBasemapTheme(
        props.stylePack.basemap.basemap_id,
        props.stylePack.basemap.desaturation,
        props.stylePack.basemap.hillshade_exaggeration,
        spotlightActive,
      ),
    [
      props.stylePack.basemap.basemap_id,
      props.stylePack.basemap.desaturation,
      props.stylePack.basemap.hillshade_exaggeration,
      spotlightActive,
    ],
  );

  const projectForOverlay = useCallback(
    (lonLat: [number, number]): [number, number] => {
      const map = mapRef.current;
      if (map && !webglFallback) {
        const pt = map.project(lonLat);
        return [pt.x, pt.y];
      }
      return projectLonLatToScreen(
        lonLat,
        liveView.center,
        liveView.zoom,
        viewportSize.width,
        viewportSize.height,
      );
    },
    [webglFallback, liveView.center, liveView.zoom, viewportSize.width, viewportSize.height, liveFrameTick],
  );

  useEffect(() => {
    props.onLiveProjectorReady?.(projectForOverlay);
  }, [projectForOverlay, props.onLiveProjectorReady]);

  const spineLabels = useMemo(
    () => buildPolitySpineLabels(effectiveSnapshot, props.bundle.polities, props.stylePack.typography),
    [effectiveSnapshot, props.bundle.polities, props.stylePack.typography],
  );

  const obstacleBoxes = useMemo<Array<{ id: string; box: ScreenBox }>>(() => {
    const fontSize = Math.max(15, Math.min(25, 11 + liveView.zoom * 1.9));
    const boxes: Array<{ id: string; box: ScreenBox }> = [];
    for (const s of spineLabels) {
      const [sx, sy] = projectForOverlay(s.properties.center);
      const w = Math.max(48, estimateTextWidthPx(s.properties.label_primary, fontSize) * (1 + s.properties.letter_spacing_em * 0.4));
      const h = s.properties.label_secondary ? fontSize * 2.1 : fontSize * 1.35;
      boxes.push({ id: `polity-${s.properties.polity_id}`, box: { x: sx - w / 2, y: sy - fontSize * 0.8, width: w, height: h } });
    }
    for (const wl of props.bundle.water_labels ?? []) {
      const [wx, wy] = projectForOverlay(wl.coordinates);
      const fs = wl.kind === "SEA" ? 18 : 13;
      const w = estimateTextWidthPx(wl.name_zh, fs) * 1.25;
      boxes.push({ id: `water-${wl.id}`, box: { x: wx - w / 2, y: wy - fs * 0.7, width: w, height: fs * 1.3 } });
    }
    return boxes;
  }, [spineLabels, props.bundle.water_labels, projectForOverlay, liveView.zoom]);

  const labelReport = useMemo(
    () =>
      evaluateToponymLayout({
        toponyms: props.bundle.toponyms,
        typography: props.stylePack.typography,
        center: liveView.center,
        zoom: liveView.zoom,
        viewport: viewportSize,
        current_jdn: props.currentJdn ?? props.bundle.epoch.valid_from_jdn,
        obstacle_boxes: obstacleBoxes,
        projectPoint: projectForOverlay,
      }),
    [
      props.bundle.toponyms,
      props.bundle.epoch.valid_from_jdn,
      props.currentJdn,
      props.stylePack.typography,
      liveView.center,
      liveView.zoom,
      viewportSize,
      obstacleBoxes,
      projectForOverlay,
    ],
  );

  useEffect(() => {
    props.onLabelReport(labelReport);
  }, [labelReport, props.onLabelReport]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setViewportSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
        const map = mapRef.current;
        if (map && !webglFallback) {
          map.resize();
          if (!userNavigatedRef.current && map.getZoom() <= 4.15) {
            fitOverviewBounds(map);
          }
          const c = map.getCenter();
          setLiveView({
            center: [c.lng, c.lat],
            zoom: map.getZoom(),
            bearing_deg: map.getBearing(),
            pitch_deg: map.getPitch(),
          });
          setLiveFrameTick((t) => t + 1);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitOverviewBounds, webglFallback]);

  // Font readiness signal (honest check instead of constant true)
  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) {
      props.bridge.setSignals({ fonts_loaded: true });
      return;
    }
    props.bridge.setSignals({ fonts_loaded: document.fonts.status === "loaded" });
    void document.fonts.ready.then(() => {
      props.bridge.setSignals({ fonts_loaded: document.fonts.status === "loaded" || document.fonts.size > 0 });
    });
  }, [props.bridge]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const graticule = buildGraticuleGeoJson();
    const worldPoly = buildFullWorldPolygonGeoJson();
    const shaderLayer = new BorderShaderWebGLLayer((ready) => {
      props.bridge.setSignals({ shaders_ready: ready });
    });
    shaderLayerRef.current = shaderLayer;

    let map: maplibregl.Map;
    try {
      props.bridge.setSignals({ map_idle: false, tiles_loaded: false, shaders_ready: false });
      map = new maplibregl.Map({
        container,
        center: props.camera.center,
        zoom: props.camera.zoom,
        bearing: props.camera.bearing_deg,
        pitch: props.camera.pitch_deg,
        canvasContextAttributes: { preserveDrawingBuffer: true },
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            "basemap-raster": { type: "raster", tiles: [basemapTheme.tileUrl], tileSize: 256, maxzoom: 12 },
            "terrain-dem-src": { type: "raster-dem", tiles: AWS_TERRARIUM_DEM_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 12 },
            "full-world-src": { type: "geojson", data: worldPoly },
            "ne-ocean-src": { type: "geojson", data: "/gis/ocean.geojson" },
            "ne-lakes-src": { type: "geojson", data: "/gis/lakes.geojson" },
            "ne-rivers-src": { type: "geojson", data: "/gis/rivers.geojson" },
            "ne-modern-borders-src": { type: "geojson", data: "/gis/modern_borders.geojson" },
            "graticule-src": { type: "geojson", data: graticule },
            "ghost-border-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "paleo-lines-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "paleo-polys-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "territories-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "boundaries-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          },
          layers: [
            { id: "bg-base", type: "background", paint: { "background-color": basemapTheme.bgHex } },
            {
              id: "basemap-layer",
              type: "raster",
              source: "basemap-raster",
              paint: {
                "raster-opacity": basemapTheme.rasterOpacity,
                "raster-saturation": basemapTheme.rasterSaturation,
                "raster-brightness-min": basemapTheme.rasterBrightnessMin,
                "raster-brightness-max": basemapTheme.rasterBrightnessMax,
                "raster-contrast": basemapTheme.rasterContrast,
                "raster-hue-rotate": basemapTheme.rasterHueRotate,
              },
            },
            // Relief hillshade stays beneath territory fills & parchment so terrain depth never washes out polity tones
            {
              id: "terrain-hillshade-overlay",
              type: "hillshade",
              source: "terrain-dem-src",
              paint: {
                "hillshade-exaggeration": basemapTheme.hillshadeExaggerationBoost,
                "hillshade-highlight-color": basemapTheme.hillshadeHighlightHex,
                "hillshade-shadow-color": basemapTheme.hillshadeShadowHex,
                "hillshade-accent-color": basemapTheme.hillshadeShadowHex,
              },
            },
            {
              id: "parchment-overlay",
              type: "fill",
              source: "full-world-src",
              paint: { "fill-opacity": basemapTheme.parchmentOpacity },
            },
            {
              id: "territories-fill",
              type: "fill",
              source: "territories-src",
              paint: { "fill-color": ["get", "fill_hex"], "fill-opacity": ["get", "fill_opacity"] },
            },
            {
              id: "territories-credibility-fill",
              type: "fill",
              source: "territories-src",
              paint: { "fill-color": ["get", "credibility_hex"], "fill-opacity": ["get", "credibility_opacity"] },
            },
            {
              id: "territories-disputed-outline",
              type: "line",
              source: "territories-src",
              filter: ["==", ["get", "is_disputed"], 1],
              paint: { "line-color": "#f59e0b", "line-width": 2.4, "line-dasharray": [4, 3] },
            },
            {
              id: "territories-control-isopleth-dotted",
              type: "line",
              source: "territories-src",
              filter: ["==", ["get", "contour_style"], "dotted"],
              layout: { visibility: "none" },
              paint: { "line-color": "#0f172a", "line-width": 1.3, "line-dasharray": [2, 4], "line-opacity": 0.72 },
            },
            {
              id: "territories-control-isopleth-dashed",
              type: "line",
              source: "territories-src",
              filter: ["==", ["get", "contour_style"], "dashed"],
              layout: { visibility: "none" },
              paint: { "line-color": "#0f172a", "line-width": 1.5, "line-dasharray": [5, 3], "line-opacity": 0.78 },
            },
            {
              id: "territories-control-isopleth-long",
              type: "line",
              source: "territories-src",
              filter: ["==", ["get", "contour_style"], "long"],
              layout: { visibility: "none" },
              paint: { "line-color": "#0f172a", "line-width": 1.8, "line-dasharray": [10, 2], "line-opacity": 0.85 },
            },
            {
              id: "graticule-layer",
              type: "line",
              source: "graticule-src",
              layout: { visibility: props.stylePack.basemap.show_graticule_grid ? "visible" : "none" },
              paint: { "line-color": "rgba(71, 85, 105, 0.35)", "line-width": 0.8 },
            },
            {
              id: "ne-rivers-layer",
              type: "line",
              source: "ne-rivers-src",
              paint: {
                "line-color": basemapTheme.riverHex,
                "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 6, 1.4, 9, 2.2],
                "line-opacity": 0.82,
              },
            },
            {
              id: "paleo-geo-fill",
              type: "fill",
              source: "paleo-polys-src",
              paint: { "fill-color": "#2563eb", "fill-opacity": 0.24 },
            },
            {
              id: "paleo-geo-line",
              type: "line",
              source: "paleo-lines-src",
              paint: {
                "line-color": ["match", ["get", "feature_type"], "SILK_ROAD", "#b45309", "ETHNIC_TRIBE", "#92400e", "#1d4ed8"],
                "line-width": ["match", ["get", "feature_type"], "SILK_ROAD", 2.0, 2.4],
                "line-dasharray": [3, 2],
                "line-opacity": 0.88,
              },
            },
            {
              id: "admin-divisions-layer",
              type: "line",
              source: "boundaries-src",
              filter: ["==", ["get", "is_same_polity_internal"], 1],
              paint: { "line-color": "#334155", "line-width": ["get", "stroke_px"], "line-opacity": 0.56, "line-dasharray": [3, 2] },
            },
            {
              id: "boundaries-halo",
              type: "line",
              source: "boundaries-src",
              filter: ["==", ["get", "hide_in_pure"], 0],
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": "rgba(15, 23, 42, 0.36)", "line-width": props.stylePack.border_shader.outer_stroke_width_px + 1.8, "line-opacity": 0.75 },
            },
            {
              id: "boundaries-outer-solid",
              type: "line",
              source: "boundaries-src",
              filter: ["all", ["==", ["get", "hide_in_pure"], 0], ["==", ["get", "certainty_key"], "solid"]],
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": props.stylePack.border_shader.outer_stroke_hex, "line-width": ["get", "stroke_px"], "line-opacity": 0.96 },
            },
            {
              id: "boundaries-outer-approx",
              type: "line",
              source: "boundaries-src",
              filter: ["all", ["==", ["get", "hide_in_pure"], 0], ["==", ["get", "certainty_key"], "approx"]],
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": props.stylePack.border_shader.outer_stroke_hex, "line-width": ["get", "stroke_px"], "line-dasharray": [4, 3], "line-opacity": 0.9 },
            },
            {
              id: "boundaries-outer-disputed",
              type: "line",
              source: "boundaries-src",
              filter: ["all", ["==", ["get", "hide_in_pure"], 0], ["==", ["get", "certainty_key"], "disputed"]],
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": "#f59e0b", "line-width": ["get", "stroke_px"], "line-dasharray": [2, 3], "line-opacity": 0.95 },
            },
            {
              id: "battle-frontline-layer",
              type: "line",
              source: "boundaries-src",
              filter: ["==", ["get", "is_frontline"], 1],
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": "#ef4444", "line-width": 4.2, "line-dasharray": [6, 2], "line-opacity": 0.92 },
            },
            {
              id: "diff-highlight-arcs",
              type: "line",
              source: "boundaries-src",
              filter: ["==", ["get", "is_diff_highlight"], 1],
              paint: { "line-color": "#38bdf8", "line-width": 6.0, "line-opacity": 0.72 },
            },
            {
              id: "boundaries-locked",
              type: "line",
              source: "boundaries-src",
              filter: ["==", ["get", "human_locked"], 1],
              paint: { "line-color": "#fbbf24", "line-width": 3.4, "line-dasharray": [1.5, 1.5] },
            },
            {
              id: "ne-ocean-mask",
              type: "fill",
              source: "ne-ocean-src",
              paint: { "fill-color": basemapTheme.oceanFillHex, "fill-opacity": props.stylePack.basemap.basemap_id === "satellite_natural" ? 0 : 0.96 },
            },
            { id: "ne-ocean-shoreline", type: "line", source: "ne-ocean-src", paint: { "line-color": basemapTheme.shorelineHex, "line-width": 1.35, "line-opacity": 0.94 } },
            {
              id: "ne-lakes-mask",
              type: "fill",
              source: "ne-lakes-src",
              paint: { "fill-color": basemapTheme.oceanFillHex, "fill-opacity": props.stylePack.basemap.basemap_id === "satellite_natural" ? 0 : 0.96 },
            },
            { id: "ne-lakes-shoreline", type: "line", source: "ne-lakes-src", paint: { "line-color": basemapTheme.shorelineHex, "line-width": 1.25, "line-opacity": 0.92 } },
            {
              id: "modern-ref-layer",
              type: "line",
              source: "ne-modern-borders-src",
              layout: { visibility: props.stylePack.basemap.show_modern_overlay ? "visible" : "none" },
              paint: { "line-color": "#dc2626", "line-width": 1.2, "line-dasharray": [3, 2], "line-opacity": 0.68 },
            },
            { id: "ghost-border-layer", type: "line", source: "ghost-border-src", paint: { "line-color": "#e11d48", "line-width": 2.2, "line-dasharray": [5, 4], "line-opacity": 0.8 } },
          ],
        },
      });
    } catch {
      setWebglFallback(true);
      props.bridge.setSignals({ map_idle: true, tiles_loaded: true, shaders_ready: true });
      return;
    }

    mapRef.current = map;
    props.onCanvasReady?.(() => {
      try {
        return map.getCanvas().toDataURL("image/png");
      } catch {
        return null;
      }
    });

    props.onRegisterAwaitIdle?.(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          if (map.loaded() && map.isStyleLoaded() && map.areTilesLoaded()) resolve();
          else map.once("idle", () => resolve());
        });
      });
    });

    const syncLiveFrame = () => {
      const c = map.getCenter();
      setLiveView({ center: [c.lng, c.lat], zoom: map.getZoom(), bearing_deg: map.getBearing(), pitch_deg: map.getPitch() });
      setLiveFrameTick((t) => {
        const next = t + 1;
        props.onLiveFrameMove?.(next);
        return next;
      });
    };

    map.on("load", () => {
      currentTileUrlRef.current = basemapTheme.tileUrl;
      if (!map.hasImage("parchment-grain")) {
        map.addImage("parchment-grain", getParchmentPatternData());
        if (map.getLayer("parchment-overlay")) {
          map.setPaintProperty("parchment-overlay", "fill-pattern", "parchment-grain");
        }
      }
      if (!map.getLayer(shaderLayer.id)) {
        map.addLayer(shaderLayer, "territories-fill");
      }
      setMapStyleReady(true);
      fitOverviewBounds(map);
      syncLiveFrame();
      props.bridge.setSignals({
        map_idle: true,
        tiles_loaded: map.areTilesLoaded(),
        shaders_ready: shaderLayer.isReady(),
      });
    });

    map.on("dragstart", () => {
      userNavigatedRef.current = true;
    });
    map.on("wheel", () => {
      userNavigatedRef.current = true;
    });
    map.on("move", syncLiveFrame);
    map.on("zoom", syncLiveFrame);
    map.on("rotate", syncLiveFrame);
    map.on("pitch", syncLiveFrame);
    map.on("resize", syncLiveFrame);
    map.on("idle", () => {
      props.bridge.setSignals({
        map_idle: true,
        tiles_loaded: map.areTilesLoaded(),
        shaders_ready: shaderLayer.isReady(),
      });
      syncLiveFrame();
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      props.onCameraChange({
        center: [Number(c.lng.toFixed(4)), Number(c.lat.toFixed(4))],
        zoom: Number(map.getZoom().toFixed(2)),
        bearing_deg: Number(map.getBearing().toFixed(1)),
        pitch_deg: Number(map.getPitch().toFixed(1)),
      });
    });
    map.on("click", (ev) => {
      const hitBox: [[number, number], [number, number]] = [
        [ev.point.x - 4, ev.point.y - 4],
        [ev.point.x + 4, ev.point.y + 4],
      ];
      const arcHits = map.queryRenderedFeatures(hitBox, {
        layers: ["boundaries-outer-solid", "boundaries-outer-approx", "boundaries-outer-disputed", "admin-divisions-layer"].filter(
          (id) => Boolean(map.getLayer(id)),
        ),
      });
      const hitArcId = arcHits[0]?.properties?.arc_id as string | undefined;
      if (hitArcId) {
        onSelectArcRef.current?.(hitArcId);
        return;
      }
      if (map.getLayer("territories-fill")) {
        const faceHits = map.queryRenderedFeatures(ev.point, { layers: ["territories-fill"] });
        const topFeature = faceHits[0];
        const faceId = topFeature?.properties?.face_id as string | undefined;
        const polityId = topFeature?.properties?.polity_id as string | undefined;
        if (faceId) onSelectFaceRef.current(faceId, polityId);
      }
    });
    map.on("error", (ev) => {
      const msg = ev?.error?.message;
      if (msg) props.onMapError?.(msg);
    });

    return () => {
      setMapStyleReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Synchronize basemap, shader buffers, merged borders, paleo overrides, and layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || webglFallback || !mapStyleReady) return;

    const rasterSrc = map.getSource("basemap-raster") as maplibregl.RasterTileSource | undefined;
    if (rasterSrc && currentTileUrlRef.current !== basemapTheme.tileUrl && typeof rasterSrc.setTiles === "function") {
      currentTileUrlRef.current = basemapTheme.tileUrl;
      rasterSrc.setTiles([basemapTheme.tileUrl]);
    }

    if (map.getLayer("bg-base")) map.setPaintProperty("bg-base", "background-color", basemapTheme.bgHex);
    if (map.getLayer("basemap-layer")) {
      map.setPaintProperty("basemap-layer", "raster-opacity", basemapTheme.rasterOpacity);
      map.setPaintProperty("basemap-layer", "raster-saturation", basemapTheme.rasterSaturation);
      map.setPaintProperty("basemap-layer", "raster-brightness-min", basemapTheme.rasterBrightnessMin);
      map.setPaintProperty("basemap-layer", "raster-brightness-max", basemapTheme.rasterBrightnessMax);
      map.setPaintProperty("basemap-layer", "raster-contrast", basemapTheme.rasterContrast);
      map.setPaintProperty("basemap-layer", "raster-hue-rotate", basemapTheme.rasterHueRotate);
    }
    if (map.getLayer("parchment-overlay")) {
      map.setPaintProperty("parchment-overlay", "fill-opacity", basemapTheme.parchmentOpacity);
    }
    if (map.getLayer("terrain-hillshade-overlay")) {
      map.setPaintProperty("terrain-hillshade-overlay", "hillshade-exaggeration", basemapTheme.hillshadeExaggerationBoost);
      map.setPaintProperty("terrain-hillshade-overlay", "hillshade-highlight-color", basemapTheme.hillshadeHighlightHex);
      map.setPaintProperty("terrain-hillshade-overlay", "hillshade-shadow-color", basemapTheme.hillshadeShadowHex);
      map.setPaintProperty("terrain-hillshade-overlay", "hillshade-accent-color", basemapTheme.hillshadeShadowHex);
    }
    const waterMaskOpacity = props.stylePack.basemap.basemap_id === "satellite_natural" ? 0 : 0.96;
    if (map.getLayer("ne-ocean-mask")) {
      map.setPaintProperty("ne-ocean-mask", "fill-color", basemapTheme.oceanFillHex);
      map.setPaintProperty("ne-ocean-mask", "fill-opacity", waterMaskOpacity);
    }
    if (map.getLayer("ne-lakes-mask")) {
      map.setPaintProperty("ne-lakes-mask", "fill-color", basemapTheme.oceanFillHex);
      map.setPaintProperty("ne-lakes-mask", "fill-opacity", waterMaskOpacity);
    }
    if (map.getLayer("ne-ocean-shoreline")) map.setPaintProperty("ne-ocean-shoreline", "line-color", basemapTheme.shorelineHex);
    if (map.getLayer("ne-lakes-shoreline")) map.setPaintProperty("ne-lakes-shoreline", "line-color", basemapTheme.shorelineHex);
    if (map.getLayer("ne-rivers-layer")) {
      map.setPaintProperty("ne-rivers-layer", "line-color", basemapTheme.riverHex);
      const paleoActive = props.layerConfig.enabled_overlays.includes("physical_paleo_geo");
      const suppressed = paleoActive ? (props.bundle.superseded_modern_rivers ?? []) : [];
      map.setFilter("ne-rivers-layer", suppressed.length > 0 ? ["!", ["in", ["get", "name"], ["literal", suppressed]]] : null);
    }
    if (map.getLayer("graticule-layer")) {
      map.setLayoutProperty("graticule-layer", "visibility", props.stylePack.basemap.show_graticule_grid ? "visible" : "none");
    }
    if (map.getLayer("modern-ref-layer")) {
      map.setLayoutProperty("modern-ref-layer", "visibility", props.stylePack.basemap.show_modern_overlay ? "visible" : "none");
    }

    const territoryFC = buildTerritoryRenderCollection(
      effectiveSnapshot,
      props.bundle,
      props.stylePack,
      props.layerConfig,
      props.polityColors,
      {
        spotlightPolityId: props.spotlightPolityId,
        opacityMultiplier: props.opacityMultiplier ?? 1,
        saturationMultiplier: props.saturationMultiplier ?? 1,
      },
    );
    (map.getSource("territories-src") as maplibregl.GeoJSONSource | undefined)?.setData(territoryFC);

    const diffArcSet = new Set(props.bundle.diff_record?.affected_arc_ids ?? []);
    const boundariesFC = buildBoundaryRenderCollection(
      effectiveSnapshot,
      props.bundle,
      props.stylePack,
      props.layerConfig,
      diffArcSet,
    );
    (map.getSource("boundaries-src") as maplibregl.GeoJSONSource | undefined)?.setData(boundariesFC);

    for (const bid of ["boundaries-outer-solid", "boundaries-outer-approx"]) {
      if (map.getLayer(bid)) {
        map.setPaintProperty(bid, "line-color", props.stylePack.border_shader.outer_stroke_hex);
      }
    }
    if (map.getLayer("boundaries-halo")) {
      map.setPaintProperty("boundaries-halo", "line-width", props.stylePack.border_shader.outer_stroke_width_px + 1.8);
    }

    const showAdmin =
      props.layerConfig.enabled_overlays.includes("admin_divisions")
      || props.stylePack.border_shader.mode === "multi_tier_ink";
    if (map.getLayer("admin-divisions-layer")) {
      map.setLayoutProperty("admin-divisions-layer", "visibility", showAdmin ? "visible" : "none");
    }

    const showIsopleth =
      props.layerConfig.base_mode === "CONTROL_INTENSITY"
      && props.layerConfig.control_intensity_render_mode === "CLOSED_ISOPLETH_CONTOURS";
    for (const lid of [
      "territories-control-isopleth-dotted",
      "territories-control-isopleth-dashed",
      "territories-control-isopleth-long",
    ]) {
      if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", showIsopleth ? "visible" : "none");
    }

    const ghostData: FeatureCollection<LineString> =
      props.showGhostBorder && props.ghostSnapshot ? props.ghostSnapshot.boundaries : { type: "FeatureCollection", features: [] };
    (map.getSource("ghost-border-src") as maplibregl.GeoJSONSource | undefined)?.setData(ghostData);

    const paleo = buildPaleoAndCustomCollections(props.bundle, props.layerConfig);
    (map.getSource("paleo-lines-src") as maplibregl.GeoJSONSource | undefined)?.setData(paleo.lines);
    (map.getSource("paleo-polys-src") as maplibregl.GeoJSONSource | undefined)?.setData(paleo.polygons);

    if (shaderLayerRef.current) {
      const bandPx = props.stylePack.border_shader.inner_band_width_px ?? 16;
      const zoom = map.getZoom();
      const perimeters =
        props.layerConfig.base_mode === "PURE_TERRITORY"
          ? extractPolityOuterPerimeterRings(effectiveSnapshot)
          : effectiveSnapshot.territories.features.map((feat) => ({
              polity_id: feat.properties.polity_id ?? feat.properties.face_id,
              rings: [feat.geometry.coordinates[0] ?? []],
            }));

      const ribbonPolygons = perimeters.flatMap((entry) => {
        const hex = props.polityColors[entry.polity_id] ?? "#2dbd66";
        const rgb = hexToRgb(hex);
        return entry.rings.map((ring) => buildConcaveSafeInwardRibbonBuffer(ring, rgb, zoom, bandPx));
      });

      const hatchPolygons =
        props.stylePack.border_shader.mode === "occupation_hatch_frontline"
          ? effectiveSnapshot.territories.features
              .filter(
                (feat) =>
                  feat.properties.zone_semantics === "DISPUTED_OVERLAP"
                  || feat.properties.control_score < 65
                  || feat.properties.polity_id === props.spotlightPolityId,
              )
              .map((feat) => {
                const hex = props.polityColors[feat.properties.polity_id ?? feat.properties.face_id] ?? "#ef4444";
                return buildPolygonHatchBuffer(feat.geometry.coordinates[0] ?? [], hexToRgb(hex));
              })
          : [];

      const fillPolygons =
        props.stylePack.basemap.blend_mode !== "normal"
          ? territoryFC.features.map((feat) => {
              const p = feat.properties as { fill_hex: string; webgl_target_opacity: number };
              return buildTerritoryFillBuffer(
                feat.geometry.coordinates[0] ?? [],
                hexToRgb(p.fill_hex),
                p.webgl_target_opacity ?? 0.65,
              );
            })
          : [];

      shaderLayerRef.current.updateConfig({
        mode: props.stylePack.border_shader.mode,
        blendMode: props.stylePack.basemap.blend_mode,
        opacity: props.stylePack.border_shader.inner_band_opacity ?? 0.42,
        bandWidthPx: bandPx,
        hatchAngleDeg: props.stylePack.border_shader.hatch_angle_deg ?? 45,
        hatchSpacingPx: props.stylePack.border_shader.hatch_spacing_px ?? 9,
        ribbonPolygons,
        hatchPolygons,
        fillPolygons,
      });
    }

    props.bridge.setRevision(effectiveSnapshot.revision_id);
    map.triggerRepaint();
  }, [
    effectiveSnapshot,
    props.ghostSnapshot,
    props.bundle,
    props.stylePack,
    props.layerConfig,
    props.polityColors,
    props.spotlightPolityId,
    props.showGhostBorder,
    props.opacityMultiplier,
    props.saturationMultiplier,
    basemapTheme,
    webglFallback,
    mapStyleReady,
    props.bridge,
  ]);

  // Synchronize external camera jumps (storyline presets / director playback)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || webglFallback) return;
    const c = map.getCenter();
    const diff =
      Math.abs(c.lng - props.camera.center[0])
      + Math.abs(c.lat - props.camera.center[1])
      + Math.abs(map.getZoom() - props.camera.zoom)
      + Math.abs(map.getBearing() - props.camera.bearing_deg) * 0.05
      + Math.abs(map.getPitch() - props.camera.pitch_deg) * 0.05;
    if (diff > 0.015) {
      map.jumpTo({
        center: props.camera.center,
        zoom: props.camera.zoom,
        bearing: props.camera.bearing_deg,
        pitch: props.camera.pitch_deg,
      });
    } else {
      setLiveView(props.camera);
    }
  }, [
    props.camera.center[0],
    props.camera.center[1],
    props.camera.zoom,
    props.camera.bearing_deg,
    props.camera.pitch_deg,
    webglFallback,
  ]);

  useEffect(() => {
    if (!props.resetViewTick || webglFallback) return;
    userNavigatedRef.current = false;
    const map = mapRef.current;
    if (map) {
      map.resize();
      fitOverviewBounds(map);
    }
  }, [props.resetViewTick, fitOverviewBounds, webglFallback]);

  // Draggable curtain divider bar listeners
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingCurtainRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const next = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
      props.onCurtainRatioChange(Number(next.toFixed(3)));
    };
    const onUp = () => {
      draggingCurtainRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [props.onCurtainRatioChange]);

  const paleoMemo = useMemo(
    () => buildPaleoAndCustomCollections(props.bundle, props.layerConfig),
    [props.bundle, props.layerConfig],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: basemapTheme.bgHex }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      <MapCurtainView
        curtainMode={props.curtainMode}
        curtainRatio={props.curtainRatio}
        bundle={props.bundle}
        displaySnapshot={effectiveSnapshot}
        ghostSnapshot={props.ghostSnapshot}
        stylePack={props.stylePack}
        layerConfig={props.layerConfig}
        polityColors={props.polityColors}
        camera={liveView}
        opacityMultiplier={props.opacityMultiplier}
        saturationMultiplier={props.saturationMultiplier}
      />

      {props.curtainMode !== "NONE" && (
        <div
          role="slider"
          aria-label="卷帘对比分割线"
          aria-valuemin={5}
          aria-valuemax={95}
          aria-valuenow={Math.round(props.curtainRatio * 100)}
          onPointerDown={() => {
            draggingCurtainRef.current = true;
          }}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${(props.curtainRatio * 100).toFixed(2)}%`,
            width: 4,
            marginLeft: -2,
            background: "#38bdf8",
            boxShadow: "0 0 8px rgba(15, 23, 42, 0.8)",
            cursor: "ew-resize",
            zIndex: 12,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "#0f172a",
              border: "2px solid #38bdf8",
              color: "#f8fafc",
              display: "grid",
              placeItems: "center",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            ⇄
          </span>
        </div>
      )}

      <MapSvgOverlay
        bundle={props.bundle}
        snapshot={effectiveSnapshot}
        stylePack={props.stylePack}
        layerConfig={props.layerConfig}
        polityColors={props.polityColors}
        viewportSize={viewportSize}
        liveZoom={liveView.zoom}
        basemapIsDark={basemapTheme.isDark}
        webglFallback={webglFallback}
        spineLabels={spineLabels}
        placedToponyms={labelReport.placed}
        affectedToponymIds={props.bundle.diff_record?.affected_toponym_ids ?? []}
        adminUnits={props.bundle.admin_units}
        paleoLabels={paleoMemo.labels}
        morphVisual={props.morphVisual}
        projectCoord={projectForOverlay}
        onSelectFace={props.onSelectFace}
        onSelectToponym={props.onSelectToponym}
        {...(props.onSelectEventId ? { onSelectEventId: props.onSelectEventId } : {})}
      />
    </div>
  );
}
