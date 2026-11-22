import { useEffect, useMemo, useRef, useState } from "react";
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
import { BASEMAP_CATALOG } from "../core/styles/style-presets.ts";
import {
  BorderShaderWebGLLayer,
  buildInwardRibbonBuffer,
  ensureCartoBasemapProtocol,
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
      const baseHex = polityColors[pid] ?? "#4b7bec";
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
          ? Math.max(0.28, vis.fill_opacity * 0.72)
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
  const [viewportSize, setViewportSize] = useState({ width: 1080, height: 640 });
  const [mapRevisionReady, setMapRevisionReady] = useState(false);

  const basemapMeta = useMemo(
    () => BASEMAP_CATALOG.find((b) => b.id === props.stylePack.basemap.basemap_id) ?? BASEMAP_CATALOG[0]!,
    [props.stylePack.basemap.basemap_id],
  );

  const labelReport = useMemo(() => {
    const map = mapRef.current;
    const projectFn = map && !webglFallback
      ? (lonLat: [number, number]): [number, number] => {
          const pt = map.project(lonLat);
          return [pt.x, pt.y];
        }
      : undefined;

    return evaluateToponymLayout({
      toponyms: props.bundle.toponyms,
      typography: props.stylePack.typography,
      center: props.camera.center,
      zoom: props.camera.zoom,
      viewport: viewportSize,
      ...(projectFn ? { projectPoint: projectFn } : {}),
    });
  }, [
    props.bundle.toponyms,
    props.stylePack.typography,
    props.camera.center,
    props.camera.zoom,
    viewportSize,
    webglFallback,
    mapRevisionReady,
  ]);

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

    ensureCartoBasemapProtocol();
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
              tiles: [`carto-basemap://${props.stylePack.basemap.basemap_id}/{z}/{x}/{y}`],
              tileSize: 256,
              maxzoom: 12,
            },
            "graticule-src": { type: "geojson", data: graticule },
            "modern-ref-src": { type: "geojson", data: props.bundle.modern_reference_overlay },
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
              paint: { "background-color": basemapMeta.default_bg_hex },
            },
            {
              id: "basemap-layer",
              type: "raster",
              source: "basemap-raster",
              paint: {
                "raster-saturation": -Math.max(0, Math.min(1, props.stylePack.basemap.desaturation)),
                "raster-contrast": (props.stylePack.basemap.hillshade_exaggeration - 0.5) * 0.45,
              },
            },
            {
              id: "graticule-layer",
              type: "line",
              source: "graticule-src",
              layout: { visibility: props.stylePack.basemap.show_graticule_grid ? "visible" : "none" },
              paint: { "line-color": "rgba(100,116,139,0.28)", "line-width": 0.8 },
            },
            {
              id: "modern-ref-layer",
              type: "line",
              source: "modern-ref-src",
              layout: { visibility: props.stylePack.basemap.show_modern_overlay ? "visible" : "none" },
              paint: {
                "line-color": "#ef4444",
                "line-width": 1.3,
                "line-dasharray": [3, 2],
                "line-opacity": 0.65,
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
              id: "paleo-geo-layer",
              type: "line",
              source: "paleo-geo-src",
              paint: {
                "line-color": ["match", ["get", "feature_type"], "SILK_ROAD", "#d97706", "#38bdf8"],
                "line-width": ["match", ["get", "feature_type"], "SILK_ROAD", 1.8, 2.3],
                "line-dasharray": [2, 2],
                "line-opacity": 0.88,
              },
            },
            {
              id: "ghost-border-layer",
              type: "line",
              source: "ghost-border-src",
              paint: {
                "line-color": "#e11d48",
                "line-width": 2.0,
                "line-dasharray": [5, 4],
                "line-opacity": 0.72,
              },
            },
            {
              id: "boundaries-outer",
              type: "line",
              source: "boundaries-src",
              paint: {
                "line-color": props.stylePack.border_shader.outer_stroke_hex,
                "line-width": props.stylePack.border_shader.outer_stroke_width_px,
                "line-opacity": 0.94,
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
              id: "marching-arrows-layer",
              type: "line",
              source: "marching-src",
              paint: {
                "line-color": ["get", "color_hex"],
                "line-width": 3.2,
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

    map.on("load", () => {
      if (!map.getLayer(shaderLayer.id)) {
        map.addLayer(shaderLayer, "boundaries-outer");
      }
      setMapRevisionReady((v) => !v);
      props.bridge.setSignals({ map_idle: true, tiles_loaded: true, shaders_ready: true });
    });

    map.on("idle", () => {
      props.bridge.setSignals({ map_idle: true, tiles_loaded: true });
      setMapRevisionReady((v) => !v);
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
      setWebglFallback(true);
      props.bridge.setSignals({ map_idle: true, tiles_loaded: true, shaders_ready: true });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Synchronize basemap, shader, snapshot, and overlay layers without tearing down MapLibre instance
  useEffect(() => {
    const map = mapRef.current;
    if (!map || webglFallback) return;

    const rasterSrc = map.getSource("basemap-raster") as maplibregl.RasterTileSource | undefined;
    if (rasterSrc && typeof rasterSrc.setTiles === "function") {
      rasterSrc.setTiles([`carto-basemap://${props.stylePack.basemap.basemap_id}/{z}/{x}/{y}`]);
    }
    if (map.getLayer("bg-base")) {
      map.setPaintProperty("bg-base", "background-color", basemapMeta.default_bg_hex);
    }
    if (map.getLayer("basemap-layer")) {
      map.setPaintProperty("basemap-layer", "raster-saturation", -Math.max(0, Math.min(1, props.stylePack.basemap.desaturation)));
      map.setPaintProperty("basemap-layer", "raster-contrast", (props.stylePack.basemap.hillshade_exaggeration - 0.5) * 0.45);
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
        const hex = props.polityColors[pid] ?? "#38bdf8";
        return buildInwardRibbonBuffer(feat.geometry.coordinates, hexToRgb(hex), 0.28);
      });
      shaderLayerRef.current.updateConfig({
        mode: props.stylePack.border_shader.mode,
        opacity: props.stylePack.border_shader.inner_band_opacity ?? 0.36,
        bandWidthPx: props.stylePack.border_shader.inner_band_width_px ?? 14,
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
    basemapMeta,
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
    }
  }, [props.camera, webglFallback]);

  const projectForOverlay = (lonLat: [number, number]): [number, number] => {
    const map = mapRef.current;
    if (map && !webglFallback) {
      const pt = map.project(lonLat);
      return [pt.x, pt.y];
    }
    return projectLonLatToScreen(
      lonLat,
      props.camera.center,
      props.camera.zoom,
      viewportSize.width,
      viewportSize.height,
    );
  };

  const spineLabels = useMemo(
    () => buildPolitySpineLabels(props.displaySnapshot, props.bundle.polities, props.stylePack.typography),
    [props.displaySnapshot, props.bundle.polities, props.stylePack.typography],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        className="map-container"
        style={{ background: basemapMeta.default_bg_hex }}
      />

      {/* Synchronized SVG cartographic overlay for curved Songti polity spines, 4 city symbol packs & fallback polygons */}
      <svg
        width={viewportSize.width}
        height={viewportSize.height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}
      >
        <defs>
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
              props.polityColors[pid] ?? "#3b82f6",
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

        {spineLabels.map((feat) => (
          <text
            key={`label-${feat.properties.polity_id}`}
            fill={basemapMeta.is_dark ? "#f8fafc" : "#1e293b"}
            stroke={basemapMeta.is_dark ? "rgba(15,23,42,0.88)" : "rgba(255,255,255,0.85)"}
            strokeWidth={3.2}
            paintOrder="stroke"
            fontFamily={props.stylePack.typography.polity_font}
            fontSize={18}
            fontWeight={700}
            textAnchor="middle"
          >
            <textPath href={`#spine-path-${feat.properties.polity_id}`} startOffset="50%">
              {feat.properties.label_text}
            </textPath>
          </text>
        ))}

        {props.layerConfig.enabled_overlays.includes("historical_events") &&
          props.bundle.marching_routes.map((route) => {
            if (!route.battle_point) return null;
            const [bx, by] = projectForOverlay(route.battle_point);
            return (
              <g key={`pulse-${route.route_id}`}>
                <circle cx={bx} cy={by} r={14} fill="none" stroke="#ef4444" strokeWidth={2} strokeOpacity={0.75} />
                <circle cx={bx} cy={by} r={6} fill="#ef4444" fillOpacity={0.9} />
              </g>
            );
          })}
      </svg>

      {/* Synchronized Clipped Left-Half Curtain Comparison Layer */}
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
              props.polityColors[pid] ?? "#4b7bec",
              feat.properties.control_score,
              props.stylePack.territory_rendering,
              leftMode,
            );
            return (
              <polygon
                key={`curtain-left-${feat.properties.face_id}`}
                points={ptsStr}
                fill={vis.fill_hex}
                fillOpacity={Math.min(0.95, vis.fill_opacity + 0.12)}
                stroke="#f8fafc"
                strokeWidth={1.6}
                strokeDasharray={props.curtainMode === "BEFORE_AFTER" ? "4 3" : undefined}
              />
            );
          })}
        </svg>
      )}

      {/* Interactive Toponym Markers supporting all 4 City Symbol Packs + G5 collision hiding */}
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
                      border: "2.5px solid #2563eb",
                      boxShadow: "0 0 6px rgba(37,99,235,0.65)",
                    }}
                  />
                )}
                {pack === "ANTIQUE_DOUBLE_RING" && (
                  <span
                    style={{
                      width: isCap ? 13 : 10,
                      height: isCap ? 13 : 10,
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
                      width: isCap ? 11 : 9,
                      height: isCap ? 11 : 9,
                      background: "#facc15",
                      border: "1.5px solid #1e293b",
                    }}
                  />
                )}
                <span
                  style={{
                    fontFamily: props.stylePack.typography.city_font,
                    fontSize: isCap ? 12 : 11,
                    fontWeight: isCap ? 700 : 500,
                    padding: pack === "PILL_BADGE" ? "1px 6px" : "0 3px",
                    borderRadius: pack === "PILL_BADGE" ? 999 : 3,
                    background:
                      pack === "PILL_BADGE"
                        ? "rgba(15, 23, 42, 0.85)"
                        : basemapMeta.is_dark
                          ? "rgba(15, 23, 42, 0.65)"
                          : "rgba(255, 255, 255, 0.72)",
                    color:
                      pack === "PILL_BADGE" || basemapMeta.is_dark
                        ? "#f8fafc"
                        : "#0f172a",
                    border:
                      pack === "PILL_BADGE"
                        ? "1px solid rgba(255,255,255,0.3)"
                        : "none",
                    whiteSpace: "pre-line",
                    textAlign: "center",
                    lineHeight: 1.15,
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
