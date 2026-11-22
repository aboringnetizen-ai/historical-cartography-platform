import type {
  BoundaryCertainty,
  ComposableStylePack,
  CredibilityTier,
  LayerVisibilityConfig,
  MapSnapshot,
} from "@historical-cartography/shared-schema";
import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";
import { evaluateControlScoreVisuals } from "../core/color/ciede2000.ts";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import { buildBoundaryRenderMetadata } from "../core/data/topology-builder.ts";

export type CurtainMode = "NONE" | "ANCIENT_VS_MODERN" | "PURE_VS_CONTROL" | "BEFORE_AFTER";

function credibilityScore(tier: CredibilityTier | undefined): number {
  switch (tier) {
    case "T1_PRIMARY_AND_LOCAL_ACADEMIC":
      return 3;
    case "T2_SECONDARY_SCHOLARLY_OR_CURATED":
      return 2;
    case "T3_GENERAL_ENCYCLOPEDIA":
      return 1;
    default:
      return 0;
  }
}

function credibilityOverlayHex(tier: CredibilityTier | undefined): string {
  switch (tier) {
    case "T1_PRIMARY_AND_LOCAL_ACADEMIC":
      return "#10b981";
    case "T2_SECONDARY_SCHOLARLY_OR_CURATED":
      return "#f59e0b";
    default:
      return "#ef4444";
  }
}

export function buildGraticuleGeoJson(): FeatureCollection<LineString> {
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

export function buildFullWorldPolygonGeoJson(): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]],
        },
        properties: {},
      },
    ],
  };
}

export function buildTerritoryRenderCollection(
  snapshot: MapSnapshot,
  bundle: EpochSceneBundle,
  stylePack: ComposableStylePack,
  layerConfig: LayerVisibilityConfig,
  polityColors: Record<string, string>,
  opts?: {
    spotlightPolityId?: string | undefined;
    opacityMultiplier?: number;
    saturationMultiplier?: number;
  },
): FeatureCollection<Polygon> {
  const canonicalFaceById = new Map(bundle.canonical_faces.map((f) => [f.face_id, f]));
  const useSpotlight =
    stylePack.border_shader.mode === "spotlight_isolation" && Boolean(opts?.spotlightPolityId);
  const minCredRank = credibilityScore(layerConfig.min_credibility_filter ?? "T3_GENERAL_ENCYCLOPEDIA");
  const showCredibility = layerConfig.enabled_overlays.includes("source_credibility");
  const baseIsBlendedWebGL = stylePack.basemap.blend_mode !== "normal";

  const features: Array<Feature<Polygon>> = [];
  for (const feat of snapshot.territories.features) {
    const faceId = feat.properties.face_id;
    const pid = feat.properties.polity_id ?? faceId;
    const canonicalFace = canonicalFaceById.get(faceId);
    const tier = canonicalFace?.highest_credibility_tier ?? "T1_PRIMARY_AND_LOCAL_ACADEMIC";
    if (credibilityScore(tier) < minCredRank) continue;

    const baseHex = polityColors[pid] ?? "#2dbd66";
    const vis = evaluateControlScoreVisuals(
      baseHex,
      feat.properties.control_score,
      stylePack.territory_rendering,
      layerConfig.base_mode,
      layerConfig.control_intensity_render_mode ?? "OPACITY_GRADIENT",
      {
        ...(opts?.opacityMultiplier !== undefined ? { opacity_multiplier: opts.opacityMultiplier } : {}),
        ...(opts?.saturationMultiplier !== undefined ? { saturation_multiplier: opts.saturationMultiplier } : {}),
      },
    );

    const dimmed = useSpotlight && pid !== opts?.spotlightPolityId;
    const targetOpacity = dimmed
      ? 0.14
      : feat.properties.zone_semantics === "DISPUTED_OVERLAP"
        ? Math.max(0.32, vis.fill_opacity * 0.78)
        : vis.fill_opacity;
    const contourStyle = !vis.contour_dasharray
      ? "none"
      : vis.contour_dasharray[0]! <= 3
        ? "dotted"
        : vis.contour_dasharray[0]! <= 6
          ? "dashed"
          : "long";

    features.push({
      type: "Feature",
      id: faceId,
      geometry: feat.geometry,
      properties: {
        ...feat.properties,
        fill_hex: dimmed ? "#475569" : vis.fill_hex,
        // When GPU blend_mode !== 'normal', BorderShaderWebGLLayer renders full blended fills
        // while keeping this layer virtually transparent (0.001) so click queries remain active.
        fill_opacity: baseIsBlendedWebGL ? 0.001 : targetOpacity,
        webgl_target_opacity: targetOpacity,
        credibility_hex: credibilityOverlayHex(tier),
        credibility_opacity: showCredibility ? 0.56 : 0,
        contour_style: contourStyle,
        is_locked: canonicalFace?.human_locked_override ? 1 : 0,
        is_disputed: feat.properties.zone_semantics === "DISPUTED_OVERLAP" ? 1 : 0,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

function certaintyPatternKey(c: BoundaryCertainty): string {
  if (c === "DISPUTED_SCHOLARLY") return "disputed";
  if (c === "APPROXIMATE_FUZZY") return "approx";
  return "solid";
}

export function buildBoundaryRenderCollection(
  snapshot: MapSnapshot,
  bundle: EpochSceneBundle,
  stylePack: ComposableStylePack,
  layerConfig: LayerVisibilityConfig,
  diffHighlightArcIds: ReadonlySet<string>,
): FeatureCollection<LineString> {
  const metadataByArc = buildBoundaryRenderMetadata(
    snapshot,
    bundle.canonical_arcs,
    bundle.canonical_faces,
    bundle.admin_units,
  );
  const widths = stylePack.border_shader.admin_tier_widths_px ?? [2.8, 1.8, 1.1];
  const isPureMode = layerConfig.base_mode === "PURE_TERRITORY";
  const showAdminOverlay =
    layerConfig.enabled_overlays.includes("admin_divisions")
    || stylePack.border_shader.mode === "multi_tier_ink";
  const showUncertainty = layerConfig.enabled_overlays.includes("uncertainty_markers");
  const isHatchFrontline = stylePack.border_shader.mode === "occupation_hatch_frontline";

  return {
    type: "FeatureCollection",
    features: snapshot.boundaries.features.map((f) => {
      const arcId = f.properties.arc_id;
      const meta = metadataByArc[arcId];
      const internal = meta?.is_same_polity_internal ? 1 : 0;
      const tier = meta?.admin_tier ?? 0;
      const certainty: BoundaryCertainty = meta?.certainty ?? "CERTAIN_EXACT";
      const widthPx =
        internal === 1
          ? (widths[Math.max(0, Math.min(2, tier - 1))] ?? 1.0)
          : Math.max(1.2, stylePack.border_shader.outer_stroke_width_px);

      return {
        ...f,
        properties: {
          ...f.properties,
          is_same_polity_internal: internal,
          hide_in_pure: isPureMode && internal === 1 && !showAdminOverlay ? 1 : 0,
          admin_tier: tier,
          stroke_px: widthPx,
          certainty_key: showUncertainty || certainty === "DISPUTED_SCHOLARLY"
            ? certaintyPatternKey(certainty)
            : "solid",
          human_locked: meta?.human_locked ? 1 : 0,
          is_frontline: isHatchFrontline && meta?.is_frontline ? 1 : 0,
          is_diff_highlight: diffHighlightArcIds.has(arcId) ? 1 : 0,
        },
      };
    }),
  };
}

export function buildPaleoAndCustomCollections(
  bundle: EpochSceneBundle,
  layerConfig: LayerVisibilityConfig,
): {
  lines: FeatureCollection<LineString>;
  polygons: FeatureCollection<Polygon>;
  labels: Array<{ id: string; label_zh: string; feature_type: string; coords: [number, number] }>;
} {
  const paleoEnabled = layerConfig.enabled_overlays.includes("physical_paleo_geo");
  const overlaySet = new Set(layerConfig.enabled_overlays);

  const activeItems = bundle.paleo_overlays.filter((p) => {
    if (p.feature_type === "SILK_ROAD") {
      return overlaySet.has("silk_road_network") || overlaySet.has(p.feature_id) || paleoEnabled;
    }
    if (p.feature_type === "ETHNIC_TRIBE") {
      return overlaySet.has("ethnic_tribes") || overlaySet.has(p.feature_id) || paleoEnabled;
    }
    if (p.feature_type === "POPULATION_HUB") {
      return overlaySet.has("population_hubs") || overlaySet.has(p.feature_id) || paleoEnabled;
    }
    return paleoEnabled || overlaySet.has(p.feature_id);
  });

  const lineFeatures: Array<Feature<LineString>> = [];
  const polyFeatures: Array<Feature<Polygon>> = [];
  const labels: Array<{ id: string; label_zh: string; feature_type: string; coords: [number, number] }> = [];

  for (const item of activeItems) {
    if (item.geometry.type === "LineString") {
      lineFeatures.push({
        type: "Feature",
        id: item.feature_id,
        geometry: item.geometry,
        properties: { feature_type: item.feature_type, label_zh: item.label_zh },
      });
      const coords = item.geometry.coordinates;
      const mid = coords[Math.floor(coords.length / 2)];
      if (mid && mid.length >= 2) {
        labels.push({
          id: item.feature_id,
          label_zh: item.label_zh,
          feature_type: item.feature_type,
          coords: [mid[0] ?? 0, mid[1] ?? 0],
        });
      }
    } else if (item.geometry.type === "Polygon") {
      polyFeatures.push({
        type: "Feature",
        id: item.feature_id,
        geometry: item.geometry,
        properties: { feature_type: item.feature_type, label_zh: item.label_zh },
      });
      const ring = item.geometry.coordinates[0] ?? [];
      if (ring.length > 0) {
        const sx = ring.reduce((s, p) => s + (p[0] ?? 0), 0) / ring.length;
        const sy = ring.reduce((s, p) => s + (p[1] ?? 0), 0) / ring.length;
        labels.push({
          id: item.feature_id,
          label_zh: item.label_zh,
          feature_type: item.feature_type,
          coords: [sx, sy],
        });
      }
    }
  }

  return {
    lines: { type: "FeatureCollection", features: lineFeatures },
    polygons: { type: "FeatureCollection", features: polyFeatures },
    labels,
  };
}
