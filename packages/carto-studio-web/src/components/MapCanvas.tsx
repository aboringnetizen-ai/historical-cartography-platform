import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  ComposableStylePack,
  HistoricalToponym,
  LayerVisibilityConfig,
  MapSnapshot,
} from "@historical-cartography/shared-schema";
import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import { evaluateControlScoreVisuals, hexToRgb } from "../core/color/ciede2000.ts";
import {
  buildPolitySpineLabels,
  evaluateToponymLayout,
  projectLonLatToScreen,
  type LabelLayoutReport,
} from "../core/layout/label-collision.ts";
import type { DeterministicFrameBridge } from "../core/render/deterministic-bridge.ts";
import {
  AWS_TERRARIUM_DEM_TILES,
  BorderShaderWebGLLayer,
  buildInwardRibbonBuffer,
  getRealBasemapTheme,
} from "./map-webgl-layers.tsx";

export type CurtainMode = "NONE" | "BEFORE_AFTER" | "PURE_VS_CONTROL";

export interface MapCanvasProps {
  bundle: EpochSceneBundle;
  displaySnapshot: MapSnapshot;
  ghostSnapshot?: MapSnapshot | undefined;
  stylePack: ComposableStylePack;
  layerConfig: LayerVisibilityConfig;
  polityColors: Record<string, string>;
  camera: { center: [number, number]; zoom: number; bearing_deg: number; pitch_deg: number };
  spotlightPolityId?: string | undefined;
  selectedPolityId?: string | undefined;
  selectedEventId?: string | undefined;
  showGhostBorder: boolean;
  curtainMode: CurtainMode;
  curtainRatio: number;
  onCurtainRatioChange: (ratio: number) => void;
  onCameraChange: (cam: { center: [number, number]; zoom: number; bearing_deg: number; pitch_deg: number }) => void;
  onLiveProjectorReady?: (projectFn: (lonLat: [number, number]) => [number, number]) => void;
  onLiveFrameMove?: (tick: number) => void;
  onSelectFace: (faceId: string, polityId?: string) => void;
  onSelectToponym: (toponym: HistoricalToponym) => void;
  onLabelReport: (report: LabelLayoutReport) => void;
  onRegisterAwaitIdle?: (fn: () => Promise<void>) => void;
  bridge: DeterministicFrameBridge;
}

function buildGraticuleGeoJson(): FeatureCollection<LineString> {
  const features: Array<Feature<LineString>> = [];
  for (let lon = -180; lon <= 180; lon += 10) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[lon, -80], [lon, 80]] },
      properties: { kind: "meridian", value: lon },
    });
  }
  for (let lat = -70; lat <= 70; lat += 10) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[-180, lat], [180, lat]] },
      properties: { kind: "parallel", value: lat },
    });
  }
  return { type: "FeatureCollection", features };
}

function buildTerritoryRenderCollection(
  snapshot: MapSnapshot,
  bundle: EpochSceneBundle,
  stylePack: ComposableStylePack,
  layerConfig: LayerVisibilityConfig,
  polityColors: Record<string, string>,
  spotlightPolityId?: string,
): FeatureCollection<Polygon> {
  const canonicalFaceById = new Map(bundle.canonical_faces.map((f) => [f.face_id, f]));
  const useSpotlight = stylePack.border_shader.mode === "spotlight_isolation" && Boolean(spotlightPolityId);

  return {
    type: "FeatureCollection",
    features: snapshot.territories.features.map((feat) => {
      const faceId = feat.properties.face_id;
      const pid = feat.properties.polity_id ?? faceId;
      const baseHex = polityColors[pid] ?? "#2dbd66";
      const vis = evaluateControlScoreVisuals(
        baseHex,
        feat.properties.control_score,
        stylePack.territory_rendering,
        layerConfig.base_mode,
        layerConfig.control_intensity_render_mode ?? "OPACITY_GRADIENT",
      );
      const canonicalFace = canonicalFaceById.get(faceId);
      const dimmed = useSpotlight && pid !== spotlightPolityId;
      const fillOpacity = dimmed
        ? 0.14
        : feat.properties.zone_semantics === "DISPUTED_OVERLAP"
          ? Math.max(0.32, vis.fill_opacity * 0.78)
          : vis.fill_opacity;

      return {
        type: "Feature",
        id: faceId,
        geometry: feat.geometry,
        properties: {
          ...feat.properties,
          fill_hex: dimmed ? "#475569" : vis.fill_hex,
          fill_opacity: fillOpacity,
          is_locked: canonicalFace?.human_locked_override ? 1 : 0,
          is_disputed: feat.properties.zone_semantics === "DISPUTED_OVERLAP" ? 1 : 0,
        },
      };
    }),
  };
}

export function MapCanvas(props: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const shaderLayerRef = useRef<BorderShaderWebGLLayer | null>(null);
  const [webglFallback, setWebglFallback] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 720 });
  const [liveFrameTick, setLiveFrameTick] = useState(0);
  const [liveView, setLiveView] = useState(props.camera);
  const currentBasemapIdRef = useRef(props.stylePack.basemap.basemap_id);

  const basemapTheme = useMemo(
    () =>
      getRealBasemapTheme(
        props.stylePack.basemap.basemap_id,
        props.stylePack.basemap.desaturation,
        props.stylePack.basemap.hillshade_exaggeration,
      ),
    [
      props.stylePack.basemap.basemap_id,
      props.stylePack.basemap.desaturation,
      props.stylePack.basemap.hillshade_exaggeration,
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

  const labelReport = useMemo(
    () =>
      evaluateToponymLayout({
        toponyms: props.bundle.toponyms,
        typography: props.stylePack.typography,
        center: liveView.center,
        zoom: liveView.zoom,
        viewport: viewportSize,
        projectPoint: projectForOverlay,
      }),
    [
      props.bundle.toponyms,
      props.stylePack.typography,
      liveView.center,
      liveView.zoom,
      viewportSize,
      projectForOverlay,
      liveFrameTick,
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
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const graticule = buildGraticuleGeoJson();
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
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            "basemap-raster": {
              type: "raster",
              tiles: [basemapTheme.tileUrl],
              tileSize: 256,
              maxzoom: 12,
            },
            "terrain-dem-src": {
              type: "raster-dem",
              tiles: AWS_TERRARIUM_DEM_TILES,
              encoding: "terrarium",
              tileSize: 256,
              maxzoom: 12,
            },
            "ne-ocean-src": { type: "geojson", data: "/gis/ocean.geojson" },
            "ne-lakes-src": { type: "geojson", data: "/gis/lakes.geojson" },
            "ne-rivers-src": { type: "geojson", data: "/gis/rivers.geojson" },
            "ne-modern-borders-src": { type: "geojson", data: "/gis/modern_borders.geojson" },
            "graticule-src": { type: "geojson", data: graticule },
            "ghost-border-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "paleo-geo-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "territories-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "boundaries-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "marching-src": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          },
          layers: [
            {
              id: "bg-base",
              type: "background",
              paint: { "background-color": basemapTheme.bgHex },
            },
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
            {
              id: "territories-fill",
              type: "fill",
              source: "territories-src",
              paint: {
                "fill-color": ["get", "fill_hex"],
                "fill-opacity": ["get", "fill_opacity"],
              },
            },
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
              id: "territories-disputed-outline",
              type: "line",
              source: "territories-src",
              filter: ["==", ["get", "is_disputed"], 1],
              paint: {
                "line-color": "#f59e0b",
                "line-width": 2.4,
                "line-dasharray": [4, 3],
              },
            },
            {
              id: "territories-control-isopleth",
              type: "line",
              source: "territories-src",
              layout: {
                visibility:
                  props.layerConfig.base_mode === "CONTROL_INTENSITY"
                  && props.layerConfig.control_intensity_render_mode === "CLOSED_ISOPLETH_CONTOURS"
                    ? "visible"
                    : "none",
              },
              paint: {
                "line-color": "#0f172a",
                "line-width": 1.4,
                "line-dasharray": [3, 3],
                "line-opacity": 0.72,
              },
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
              id: "paleo-geo-layer",
              type: "line",
              source: "paleo-geo-src",
              paint: {
                "line-color": ["match", ["get", "feature_type"], "SILK_ROAD", "#b45309", "#1d4ed8"],
                "line-width": ["match", ["get", "feature_type"], "SILK_ROAD", 1.8, 2.2],
                "line-dasharray": [3, 2],
                "line-opacity": 0.85,
              },
            },
            {
              id: "boundaries-halo",
              type: "line",
              source: "boundaries-src",
              paint: {
                "line-color": "rgba(15, 23, 42, 0.38)",
                "line-width": props.stylePack.border_shader.outer_stroke_width_px + 1.8,
                "line-opacity": 0.75,
              },
            },
            {
              id: "boundaries-outer",
              type: "line",
              source: "boundaries-src",
              paint: {
                "line-color": props.stylePack.border_shader.outer_stroke_hex,
                "line-width": props.stylePack.border_shader.outer_stroke_width_px,
                "line-opacity": 0.96,
              },
            },
            {
              id: "boundaries-locked",
              type: "line",
              source: "boundaries-src",
              filter: ["==", ["get", "human_locked"], 1],
              paint: {
                "line-color": "#fbbf24",
                "line-width": 3.4,
                "line-dasharray": [1.5, 1.5],
              },
            },
            {
              id: "ne-ocean-mask",
              type: "fill",
              source: "ne-ocean-src",
              paint: {
                "fill-color": basemapTheme.oceanFillHex,
                "fill-opacity": props.stylePack.basemap.basemap_id === "satellite_natural" ? 0 : 0.96,
              },
            },
            {
              id: "ne-ocean-shoreline",
              type: "line",
              source: "ne-ocean-src",
              paint: {
                "line-color": basemapTheme.shorelineHex,
                "line-width": 1.35,
                "line-opacity": 0.94,
              },
            },
            {
              id: "ne-lakes-mask",
              type: "fill",
              source: "ne-lakes-src",
              paint: {
                "fill-color": basemapTheme.oceanFillHex,
                "fill-opacity": props.stylePack.basemap.basemap_id === "satellite_natural" ? 0 : 0.96,
              },
            },
            {
              id: "ne-lakes-shoreline",
              type: "line",
              source: "ne-lakes-src",
              paint: {
                "line-color": basemapTheme.shorelineHex,
                "line-width": 1.25,
                "line-opacity": 0.92,
              },
            },
            {
              id: "modern-ref-layer",
              type: "line",
              source: "ne-modern-borders-src",
              layout: { visibility: props.stylePack.basemap.show_modern_overlay ? "visible" : "none" },
              paint: {
                "line-color": "#dc2626",
                "line-width": 1.2,
                "line-dasharray": [3, 2],
                "line-opacity": 0.68,
              },
            },
            {
              id: "ghost-border-layer",
              type: "line",
              source: "ghost-border-src",
              paint: {
                "line-color": "#e11d48",
                "line-width": 2.2,
                "line-dasharray": [5, 4],
                "line-opacity": 0.8,
              },
            },
            {
              id: "marching-arrows-layer",
              type: "line",
              source: "marching-src",
              paint: {
                "line-color": ["get", "color_hex"],
                "line-width": 3.4,
                "line-dasharray": [4, 2],
              },
            },
          ],
        },
      });
    } catch {
      setWebglFallback(true);
      props.bridge.setSignals({ map_idle: true, tiles_loaded: true, shaders_ready: true });
      return;
    }

    mapRef.current = map;

    props.onRegisterAwaitIdle?.(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          if (map.loaded() && map.isStyleLoaded() && map.areTilesLoaded()) {
            resolve();
          } else {
            map.once("idle", () => resolve());
          }
        });
      });
    });

    const syncLiveFrame = () => {
      const c = map.getCenter();
      setLiveView({
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing_deg: map.getBearing(),
        pitch_deg: map.getPitch(),
      });
      setLiveFrameTick((t) => {
        const next = t + 1;
        props.onLiveFrameMove?.(next);
        return next;
      });
    };

    map.on("load", () => {
      if (!map.getLayer(shaderLayer.id)) {
        map.addLayer(shaderLayer, "terrain-hillshade-overlay");
      }
      syncLiveFrame();
      props.bridge.setSignals({ map_idle: true, tiles_loaded: true, shaders_ready: true });
    });

    map.on("move", syncLiveFrame);
    map.on("zoom", syncLiveFrame);
    map.on("rotate", syncLiveFrame);
    map.on("pitch", syncLiveFrame);
    map.on("resize", syncLiveFrame);

    map.on("idle", () => {
      props.bridge.setSignals({ map_idle: true, tiles_loaded: true });
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

    map.on("click", "territories-fill", (ev) => {
      const feature = ev.features?.[0];
      const faceId = feature?.properties?.face_id as string | undefined;
      const polityId = feature?.properties?.polity_id as string | undefined;
      if (faceId) props.onSelectFace(faceId, polityId);
    });

    map.on("error", () => {
      // Do not force fallback on transient tile request warnings; keep real MapLibre active
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Synchronize real GIS basemap tiles, hillshade, shaders, snapshot, and overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!map || webglFallback) return;

    const rasterSrc = map.getSource("basemap-raster") as maplibregl.RasterTileSource | undefined;
    if (
      rasterSrc
      && currentBasemapIdRef.current !== props.stylePack.basemap.basemap_id
      && typeof rasterSrc.setTiles === "function"
    ) {
      currentBasemapIdRef.current = props.stylePack.basemap.basemap_id;
      rasterSrc.setTiles([basemapTheme.tileUrl]);
    }
    if (map.getLayer("bg-base")) {
      map.setPaintProperty("bg-base", "background-color", basemapTheme.bgHex);
    }
    if (map.getLayer("basemap-layer")) {
      map.setPaintProperty("basemap-layer", "raster-opacity", basemapTheme.rasterOpacity);
      map.setPaintProperty("basemap-layer", "raster-saturation", basemapTheme.rasterSaturation);
      map.setPaintProperty("basemap-layer", "raster-brightness-min", basemapTheme.rasterBrightnessMin);
      map.setPaintProperty("basemap-layer", "raster-brightness-max", basemapTheme.rasterBrightnessMax);
      map.setPaintProperty("basemap-layer", "raster-contrast", basemapTheme.rasterContrast);
      map.setPaintProperty("basemap-layer", "raster-hue-rotate", basemapTheme.rasterHueRotate);
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
    if (map.getLayer("ne-ocean-shoreline")) {
      map.setPaintProperty("ne-ocean-shoreline", "line-color", basemapTheme.shorelineHex);
    }
    if (map.getLayer("ne-lakes-shoreline")) {
      map.setPaintProperty("ne-lakes-shoreline", "line-color", basemapTheme.shorelineHex);
    }
    if (map.getLayer("ne-rivers-layer")) {
      map.setPaintProperty("ne-rivers-layer", "line-color", basemapTheme.riverHex);
    }
    if (map.getLayer("graticule-layer")) {
      map.setLayoutProperty("graticule-layer", "visibility", props.stylePack.basemap.show_graticule_grid ? "visible" : "none");
    }
    if (map.getLayer("modern-ref-layer")) {
      map.setLayoutProperty("modern-ref-layer", "visibility", props.stylePack.basemap.show_modern_overlay ? "visible" : "none");
    }

    const territoryFC = buildTerritoryRenderCollection(
      props.displaySnapshot,
      props.bundle,
      props.stylePack,
      props.layerConfig,
      props.polityColors,
      props.spotlightPolityId,
    );
    (map.getSource("territories-src") as maplibregl.GeoJSONSource | undefined)?.setData(territoryFC);

    const lockedArcIds = new Set(
      props.bundle.canonical_arcs.filter((a) => a.human_locked_override).map((a) => a.arc_id),
    );
    const boundariesFC: FeatureCollection<LineString> = {
      type: "FeatureCollection",
      features: props.displaySnapshot.boundaries.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          human_locked: lockedArcIds.has(f.properties.arc_id) ? 1 : 0,
        },
      })),
    };
    (map.getSource("boundaries-src") as maplibregl.GeoJSONSource | undefined)?.setData(boundariesFC);

    if (map.getLayer("boundaries-outer")) {
      map.setPaintProperty("boundaries-outer", "line-color", props.stylePack.border_shader.outer_stroke_hex);
      map.setPaintProperty("boundaries-outer", "line-width", props.stylePack.border_shader.outer_stroke_width_px);
    }
    if (map.getLayer("boundaries-halo")) {
      map.setPaintProperty("boundaries-halo", "line-width", props.stylePack.border_shader.outer_stroke_width_px + 1.8);
    }
    if (map.getLayer("territories-control-isopleth")) {
      const showIsopleth =
        props.layerConfig.base_mode === "CONTROL_INTENSITY"
        && props.layerConfig.control_intensity_render_mode === "CLOSED_ISOPLETH_CONTOURS";
      map.setLayoutProperty("territories-control-isopleth", "visibility", showIsopleth ? "visible" : "none");
    }

    const ghostData: FeatureCollection<LineString> =
      props.showGhostBorder && props.ghostSnapshot
        ? props.ghostSnapshot.boundaries
        : { type: "FeatureCollection", features: [] };
    (map.getSource("ghost-border-src") as maplibregl.GeoJSONSource | undefined)?.setData(ghostData);

    const paleoEnabled = props.layerConfig.enabled_overlays.includes("physical_paleo_geo");
    const paleoData: FeatureCollection<LineString | Polygon> = {
      type: "FeatureCollection",
      features: paleoEnabled
        ? props.bundle.paleo_overlays.map((p) => ({
            type: "Feature",
            id: p.feature_id,
            geometry: p.geometry,
            properties: { feature_type: p.feature_type, label_zh: p.label_zh },
          }))
        : [],
    };
    (map.getSource("paleo-geo-src") as maplibregl.GeoJSONSource | undefined)?.setData(paleoData);

    const eventsEnabled = props.layerConfig.enabled_overlays.includes("historical_events");
    const marchData: FeatureCollection<LineString> = {
      type: "FeatureCollection",
      features: eventsEnabled
        ? props.bundle.marching_routes.map((r) => ({
            type: "Feature",
            id: r.route_id,
            geometry: { type: "LineString", coordinates: r.coordinates },
            properties: { color_hex: r.color_hex, label_zh: r.label_zh },
          }))
        : [],
    };
    (map.getSource("marching-src") as maplibregl.GeoJSONSource | undefined)?.setData(marchData);

    if (shaderLayerRef.current) {
      const ribbons = props.displaySnapshot.territories.features.map((feat) => {
        const pid = feat.properties.polity_id ?? feat.properties.face_id;
        const hex = props.polityColors[pid] ?? "#2dbd66";
        return buildInwardRibbonBuffer(feat.geometry.coordinates, hexToRgb(hex), 0.3);
      });
      shaderLayerRef.current.updateConfig({
        mode: props.stylePack.border_shader.mode,
        opacity: props.stylePack.border_shader.inner_band_opacity ?? 0.42,
        bandWidthPx: props.stylePack.border_shader.inner_band_width_px ?? 16,
        hatchAngleDeg: props.stylePack.border_shader.hatch_angle_deg ?? 45,
        polygons: ribbons,
      });
    }

    props.bridge.setRevision(props.displaySnapshot.revision_id);
    map.triggerRepaint();
  }, [
    props.displaySnapshot,
    props.ghostSnapshot,
    props.bundle,
    props.stylePack,
    props.layerConfig,
    props.polityColors,
    props.spotlightPolityId,
    props.showGhostBorder,
    basemapTheme,
    webglFallback,
    props.bridge,
  ]);

  // Synchronize external camera jumps (e.g. epoch switch or Director scrub)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || webglFallback) return;
    const c = map.getCenter();
    const moved =
      Math.abs(c.lng - props.camera.center[0]) > 0.01
      || Math.abs(c.lat - props.camera.center[1]) > 0.01
      || Math.abs(map.getZoom() - props.camera.zoom) > 0.05;
    if (moved) {
      map.jumpTo({
        center: props.camera.center,
        zoom: props.camera.zoom,
        bearing: props.camera.bearing_deg,
        pitch: props.camera.pitch_deg,
      });
      setLiveView(props.camera);
      setLiveFrameTick((t) => t + 1);
    }
  }, [props.camera, webglFallback]);

  const spineLabels = useMemo(
    () => buildPolitySpineLabels(props.displaySnapshot, props.bundle.polities, props.stylePack.typography),
    [props.displaySnapshot, props.bundle.polities, props.stylePack.typography],
  );

  const isLightText = basemapTheme.isDark || props.stylePack.style_id === "vivid_video_songti" || props.stylePack.style_id === "alabaster_clay_focus" || props.stylePack.style_id === "tactical_war_parchment";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} className="map-container" style={{ background: basemapTheme.bgHex }} />

      {/* 60fps real-time SVG cartographic layer: curved polity spines, water body labels, arrows */}
      <svg
        width={viewportSize.width}
        height={viewportSize.height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}
      >
        <defs>
          <marker id="march-arrow-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#dc2626" stroke="#ffffff" strokeWidth="0.7" />
          </marker>
          {spineLabels.map((feat) => {
            const pts = feat.geometry.coordinates.map((pt) => projectForOverlay([pt[0] ?? 0, pt[1] ?? 0]));
            if (pts.length < 3) return null;
            const d = `M ${pts[0]![0]} ${pts[0]![1]} Q ${pts[1]![0]} ${pts[1]![1]} ${pts[2]![0]} ${pts[2]![1]}`;
            return <path key={feat.properties.polity_id} id={`spine-path-${feat.properties.polity_id}`} d={d} />;
          })}
        </defs>

        {webglFallback &&
          props.displaySnapshot.territories.features.map((feat) => {
            const ring = feat.geometry.coordinates[0] ?? [];
            const ptsStr = ring
              .map((pt) => projectForOverlay([pt[0] ?? 0, pt[1] ?? 0]))
              .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
              .join(" ");
            const pid = feat.properties.polity_id ?? feat.properties.face_id;
            const vis = evaluateControlScoreVisuals(
              props.polityColors[pid] ?? "#2dbd66",
              feat.properties.control_score,
              props.stylePack.territory_rendering,
              props.layerConfig.base_mode,
            );
            return (
              <polygon
                key={feat.properties.face_id}
                points={ptsStr}
                fill={vis.fill_hex}
                fillOpacity={vis.fill_opacity}
                stroke={props.stylePack.border_shader.outer_stroke_hex}
                strokeWidth={props.stylePack.border_shader.outer_stroke_width_px}
                style={{ pointerEvents: "auto", cursor: "pointer" }}
                onClick={() => props.onSelectFace(feat.properties.face_id, feat.properties.polity_id)}
              />
            );
          })}

        {/* Curved smooth marching route vector arrows */}
        {props.layerConfig.enabled_overlays.includes("historical_events") &&
          props.bundle.marching_routes.map((route) => {
            const screenPts = route.coordinates.map((c) => projectForOverlay(c));
            if (screenPts.length < 2) return null;
            const d = screenPts.map(([x, y], idx) => `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
            const bPt = route.battle_point ? projectForOverlay(route.battle_point) : null;
            return (
              <g key={`march-svg-${route.route_id}`}>
                <path
                  d={d}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={5.2}
                  strokeLinecap="round"
                  strokeOpacity={0.8}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={route.color_hex}
                  strokeWidth={3.2}
                  strokeLinecap="round"
                  markerEnd="url(#march-arrow-head)"
                />
                {bPt && (
                  <>
                    <circle cx={bPt[0]} cy={bPt[1]} r={15} fill="none" stroke="#ef4444" strokeWidth={2} strokeOpacity={0.78} />
                    <circle cx={bPt[0]} cy={bPt[1]} r={5.5} fill="#dc2626" stroke="#ffffff" strokeWidth={1.5} />
                  </>
                )}
              </g>
            );
          })}

        {/* Water body annotations (里海, 咸海, 伊塞克湖, 北海, 东海, 南海) synced at 60fps */}
        {(props.bundle.water_labels ?? []).map((wl) => {
          const [wx, wy] = projectForOverlay(wl.coordinates);
          return (
            <text
              key={wl.id}
              x={wx}
              y={wy}
              fill={basemapTheme.isDark ? "#94a3b8" : "#ffffff"}
              stroke={basemapTheme.isDark ? "none" : "rgba(59, 68, 130, 0.55)"}
              strokeWidth={2.2}
              paintOrder="stroke"
              fontFamily={props.stylePack.typography.polity_font}
              fontSize={wl.kind === "SEA" ? 18 : 13}
              fontWeight={600}
              letterSpacing={3}
              textAnchor="middle"
            >
              {wl.name_zh}
            </text>
          );
        })}

        {/* Curved Polity Titles tracking real-time projection */}
        {spineLabels.map((feat) => {
          const fontSize = Math.max(15, Math.min(24, 11 + liveView.zoom * 1.9));
          return (
            <text
              key={`label-${feat.properties.polity_id}`}
              fill={isLightText ? "#ffffff" : "#1f2937"}
              stroke={isLightText ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.72)"}
              strokeWidth={isLightText ? 3.8 : 2.6}
              paintOrder="stroke"
              fontFamily={props.stylePack.typography.polity_font}
              fontSize={fontSize}
              fontWeight={700}
              textAnchor="middle"
            >
              <textPath href={`#spine-path-${feat.properties.polity_id}`} startOffset="50%">
                {feat.properties.label_text}
              </textPath>
            </text>
          );
        })}
      </svg>

      {/* Clipped Curtain Swipe Layer */}
      {props.curtainMode !== "NONE" && (
        <svg
          width={viewportSize.width}
          height={viewportSize.height}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 6,
            clipPath: `inset(0 ${((1 - props.curtainRatio) * 100).toFixed(2)}% 0 0)`,
          }}
        >
          {(props.curtainMode === "BEFORE_AFTER" && props.ghostSnapshot
            ? props.ghostSnapshot
            : props.displaySnapshot
          ).territories.features.map((feat) => {
            const ring = feat.geometry.coordinates[0] ?? [];
            const ptsStr = ring
              .map((pt) => projectForOverlay([pt[0] ?? 0, pt[1] ?? 0]))
              .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
              .join(" ");
            const pid = feat.properties.polity_id ?? feat.properties.face_id;
            const leftMode = props.curtainMode === "PURE_VS_CONTROL" ? "PURE_TERRITORY" : props.layerConfig.base_mode;
            const vis = evaluateControlScoreVisuals(
              props.polityColors[pid] ?? "#2dbd66",
              feat.properties.control_score,
              props.stylePack.territory_rendering,
              leftMode,
            );
            return (
              <polygon
                key={`curtain-left-${feat.properties.face_id}`}
                points={ptsStr}
                fill={vis.fill_hex}
                fillOpacity={Math.min(0.92, vis.fill_opacity + 0.1)}
                stroke="#f8fafc"
                strokeWidth={1.6}
                strokeDasharray={props.curtainMode === "BEFORE_AFTER" ? "4 3" : undefined}
              />
            );
          })}
        </svg>
      )}

      {/* Real-time 60fps City Markers supporting all 4 Symbol Packs + G5 collision filtering */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 8 }}>
        {labelReport.placed
          .filter((item) => item.visible)
          .map((item) => {
            const top = props.bundle.toponyms.find((t) => t.toponym_id === item.toponym_id);
            if (!top) return null;
            const pack = props.stylePack.typography.city_symbol_pack;
            const isCap = item.entity_rank === "CAPITAL";
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
                {pack === "BLUE_RING" && (
                  <span
                    style={{
                      width: isCap ? 12 : 9,
                      height: isCap ? 12 : 9,
                      borderRadius: "50%",
                      background: "#ffffff",
                      border: isCap ? "2.8px solid #dc2626" : "2.4px solid #2563eb",
                      boxShadow: "0 0 6px rgba(15, 23, 42, 0.55)",
                    }}
                  />
                )}
                {pack === "ANTIQUE_DOUBLE_RING" && (
                  <span
                    style={{
                      width: isCap ? 12 : 9,
                      height: isCap ? 12 : 9,
                      borderRadius: "50%",
                      background: "#fef3c7",
                      border: "2px solid #78350f",
                      outline: "1.5px solid #78350f",
                      outlineOffset: 2,
                    }}
                  />
                )}
                {pack === "YELLOW_SQUARE" && (
                  <span
                    style={{
                      width: isCap ? 10 : 8,
                      height: isCap ? 10 : 8,
                      background: "#facc15",
                      border: "1.5px solid #1e293b",
                    }}
                  />
                )}
                <span
                  style={{
                    fontFamily: props.stylePack.typography.city_font,
                    fontSize: isCap ? 11.5 : 10.5,
                    fontWeight: isCap ? 700 : 600,
                    padding: pack === "PILL_BADGE" ? "1px 5px" : "0 3px",
                    borderRadius: pack === "PILL_BADGE" ? 999 : 3,
                    background:
                      pack === "PILL_BADGE"
                        ? "rgba(15, 23, 42, 0.72)"
                        : basemapTheme.isDark
                          ? "rgba(15, 23, 42, 0.65)"
                          : "rgba(255, 255, 255, 0.68)",
                    color: pack === "PILL_BADGE" || basemapTheme.isDark ? "#f8fafc" : "#0f172a",
                    border: pack === "PILL_BADGE" ? "1px solid rgba(255,255,255,0.28)" : "none",
                    whiteSpace: "pre-line",
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

      {/* Curtain Swipe Divider Overlay */}
      {props.curtainMode !== "NONE" && (
        <>
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              zIndex: 13,
              padding: "4px 9px",
              borderRadius: 6,
              background: "rgba(15,23,42,0.85)",
              fontSize: 11,
              border: "1px solid rgba(255,255,255,0.22)",
            }}
          >
            {props.curtainMode === "BEFORE_AFTER"
              ? `左侧: Before (${props.ghostSnapshot?.revision_id ?? "无"}) ｜ 右侧: After (${props.displaySnapshot.revision_id})`
              : "左侧: 纯疆域模式 ｜ 右侧: 0–100 控制力梯度"}
          </div>
          <div
            className="curtain-divider"
            style={{ left: `${Math.round(props.curtainRatio * 100)}%` }}
            onPointerDown={(e) => {
              const parent = e.currentTarget.parentElement;
              if (!parent) return;
              const move = (ev: PointerEvent) => {
                const rect = parent.getBoundingClientRect();
                const ratio = Math.max(0.08, Math.min(0.92, (ev.clientX - rect.left) / rect.width));
                props.onCurtainRatioChange(ratio);
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          >
            <div className="curtain-handle">⇄ 卷帘对比</div>
          </div>
        </>
      )}
    </div>
  );
}
