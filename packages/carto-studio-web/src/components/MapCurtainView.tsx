import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type {
  ComposableStylePack,
  LayerVisibilityConfig,
  MapSnapshot,
} from "@historical-cartography/shared-schema";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import { resolveStylePack } from "../core/styles/style-presets.ts";
import { getRealBasemapTheme } from "./map-webgl-layers.tsx";
import {
  buildTerritoryRenderCollection,
  type CurtainMode,
} from "./map-geojson-builders.ts";

export interface MapCurtainViewProps {
  curtainMode: CurtainMode;
  curtainRatio: number;
  bundle: EpochSceneBundle;
  displaySnapshot: MapSnapshot;
  ghostSnapshot?: MapSnapshot | undefined;
  stylePack: ComposableStylePack;
  layerConfig: LayerVisibilityConfig;
  polityColors: Record<string, string>;
  camera: { center: [number, number]; zoom: number; bearing_deg: number; pitch_deg: number };
  opacityMultiplier?: number | undefined;
  saturationMultiplier?: number | undefined;
}

export function MapCurtainView(props: MapCurtainViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const currentTileUrlRef = useRef<string>("");
  const [mapStyleReady, setMapStyleReady] = useState(false);

  const curtainStylePack = useMemo(() => {
    if (props.curtainMode === "ANCIENT_VS_MODERN") {
      return resolveStylePack(props.stylePack.style_id, [], {
        basemap: { basemap_id: "modern_reference", show_modern_overlay: true },
      });
    }
    return props.stylePack;
  }, [props.curtainMode, props.stylePack]);

  const curtainLayerConfig = useMemo<LayerVisibilityConfig>(() => {
    if (props.curtainMode === "PURE_VS_CONTROL") {
      return {
        ...props.layerConfig,
        base_mode:
          props.layerConfig.base_mode === "PURE_TERRITORY"
            ? "CONTROL_INTENSITY"
            : "PURE_TERRITORY",
      };
    }
    return props.layerConfig;
  }, [props.curtainMode, props.layerConfig]);

  const curtainTheme = useMemo(
    () =>
      getRealBasemapTheme(
        curtainStylePack.basemap.basemap_id,
        curtainStylePack.basemap.desaturation,
        curtainStylePack.basemap.hillshade_exaggeration,
      ),
    [curtainStylePack],
  );

  useEffect(() => {
    if (props.curtainMode === "NONE") return;
    const container = containerRef.current;
    if (!container) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        center: props.camera.center,
        zoom: props.camera.zoom,
        bearing: props.camera.bearing_deg,
        pitch: props.camera.pitch_deg,
        interactive: false,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            "curtain-basemap": {
              type: "raster",
              tiles: [curtainTheme.tileUrl],
              tileSize: 256,
              maxzoom: 12,
            },
            "curtain-modern-borders": { type: "geojson", data: "/gis/modern_borders.geojson" },
            "curtain-territories": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "curtain-boundaries": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          },
          layers: [
            { id: "curtain-bg", type: "background", paint: { "background-color": curtainTheme.bgHex } },
            {
              id: "curtain-raster",
              type: "raster",
              source: "curtain-basemap",
              paint: {
                "raster-opacity": curtainTheme.rasterOpacity,
                "raster-saturation": curtainTheme.rasterSaturation,
              },
            },
            {
              id: "curtain-fill",
              type: "fill",
              source: "curtain-territories",
              paint: {
                "fill-color": ["get", "fill_hex"],
                "fill-opacity": props.curtainMode === "ANCIENT_VS_MODERN" ? 0.14 : ["get", "webgl_target_opacity"],
              },
            },
            {
              id: "curtain-outline",
              type: "line",
              source: "curtain-boundaries",
              paint: {
                "line-color": curtainStylePack.border_shader.outer_stroke_hex,
                "line-width": Math.max(1.2, curtainStylePack.border_shader.outer_stroke_width_px * 0.8),
              },
            },
            {
              id: "curtain-modern",
              type: "line",
              source: "curtain-modern-borders",
              layout: { visibility: props.curtainMode === "ANCIENT_VS_MODERN" ? "visible" : "none" },
              paint: { "line-color": "#dc2626", "line-width": 1.6, "line-dasharray": [3, 2] },
            },
          ],
        },
      });
    } catch {
      return;
    }

    mapRef.current = map;
    map.on("load", () => {
      currentTileUrlRef.current = curtainTheme.tileUrl;
      setMapStyleReady(true);
    });
    return () => {
      setMapStyleReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [props.curtainMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || props.curtainMode === "NONE" || !mapStyleReady) return;

    const targetSnapshot =
      props.curtainMode === "BEFORE_AFTER" && props.ghostSnapshot
        ? props.ghostSnapshot
        : props.displaySnapshot;

    const rasterSrc = map.getSource("curtain-basemap") as maplibregl.RasterTileSource | undefined;
    if (rasterSrc && currentTileUrlRef.current !== curtainTheme.tileUrl && typeof rasterSrc.setTiles === "function") {
      currentTileUrlRef.current = curtainTheme.tileUrl;
      rasterSrc.setTiles([curtainTheme.tileUrl]);
    }

    const territoryFC = buildTerritoryRenderCollection(
      targetSnapshot,
      props.bundle,
      curtainStylePack,
      curtainLayerConfig,
      props.polityColors,
      {
        opacityMultiplier: props.opacityMultiplier ?? 1,
        saturationMultiplier: props.saturationMultiplier ?? 1,
      },
    );
    (map.getSource("curtain-territories") as maplibregl.GeoJSONSource | undefined)?.setData(territoryFC);
    (map.getSource("curtain-boundaries") as maplibregl.GeoJSONSource | undefined)?.setData(targetSnapshot.boundaries);
    if (map.getLayer("curtain-modern")) {
      map.setLayoutProperty(
        "curtain-modern",
        "visibility",
        props.curtainMode === "ANCIENT_VS_MODERN" ? "visible" : "none",
      );
    }
    if (map.getLayer("curtain-fill")) {
      map.setPaintProperty(
        "curtain-fill",
        "fill-opacity",
        props.curtainMode === "ANCIENT_VS_MODERN" ? 0.14 : ["get", "webgl_target_opacity"],
      );
    }
  }, [
    props.curtainMode,
    props.displaySnapshot,
    props.ghostSnapshot,
    props.bundle,
    curtainStylePack,
    curtainLayerConfig,
    curtainTheme,
    props.polityColors,
    props.opacityMultiplier,
    props.saturationMultiplier,
    mapStyleReady,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || props.curtainMode === "NONE") return;
    map.jumpTo({
      center: props.camera.center,
      zoom: props.camera.zoom,
      bearing: props.camera.bearing_deg,
      pitch: props.camera.pitch_deg,
    });
  }, [
    props.curtainMode,
    props.camera.center[0],
    props.camera.center[1],
    props.camera.zoom,
    props.camera.bearing_deg,
    props.camera.pitch_deg,
  ]);

  if (props.curtainMode === "NONE") return null;

  const rightClipPct = Math.max(2, Math.min(98, (1 - props.curtainRatio) * 100));
  const modeBadge =
    props.curtainMode === "ANCIENT_VS_MODERN"
      ? "古今对照"
      : props.curtainMode === "PURE_VS_CONTROL"
        ? `双模 · ${curtainLayerConfig.base_mode === "PURE_TERRITORY" ? "纯疆域" : "控制力"}`
        : "变更前 (Before)";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 4,
        pointerEvents: "none",
        clipPath: `inset(0 ${rightClipPct.toFixed(2)}% 0 0)`,
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div
        style={{
          position: "absolute",
          top: 84,
          left: 14,
          padding: "2px 7px",
          background: "rgba(15, 23, 42, 0.88)",
          border: "1px solid rgba(56, 189, 248, 0.55)",
          borderRadius: 5,
          color: "#f8fafc",
          fontSize: 10.5,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {modeBadge}
      </div>
    </div>
  );
}
