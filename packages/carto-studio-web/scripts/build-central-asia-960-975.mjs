import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDemPathfinder } from "./lib/dem-pathfinder.mjs";
import {
  compilePlanarTopology,
  extractPolylineSubpath,
  extractRingSubpath,
  loadPhysicalGis,
  nearestPointIndex,
  roundPt,
  stitchRiverChain,
  writeGeneratedCentralAsiaTs,
} from "./lib/natural-topo-builder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_GIS_DIR = path.resolve(__dirname, "../data/raw-gis");
const OUT_TS_PATH = path.resolve(__dirname, "../src/core/data/generated/central-asia-960-975.ts");

const HISTORICAL_CITIES = [
  { id: "top-bukhara", face_id: "face-ca-transoxiana", coords: [64.42, 39.77] },
  { id: "top-samarkand", face_id: "face-ca-transoxiana", coords: [66.96, 39.65] },
  { id: "top-chach", face_id: "face-ca-transoxiana", coords: [69.24, 41.31] },
  { id: "top-chaghaniyan", face_id: "face-ca-chaghaniyan", coords: [67.89, 38.27] },
  { id: "top-merv", face_id: "face-ca-khorasan", coords: [62.19, 37.66] },
  { id: "top-nishapur", face_id: "face-ca-khorasan", coords: [58.79, 36.21] },
  { id: "top-herat", face_id: "face-ca-khorasan", coords: [62.2, 34.34] },
  { id: "top-balkh", face_id: "face-ca-tokharistan", coords: [66.9, 36.75] },
  { id: "top-yahudiyya", face_id: "face-ca-guzgan", coords: [64.78, 35.92] },
  { id: "top-firuzkuh", face_id: "face-ca-ghur", coords: [64.52, 34.39] },
  { id: "top-kath", face_id: "face-ca-khwarazm", coords: [60.75, 41.68] },
  { id: "top-ghazna", face_id: "face-ca-ghazna", coords: [68.42, 33.55] },
  { id: "top-gardez", face_id: "face-ca-ghazna", coords: [69.22, 33.59] },
  { id: "top-zarang", face_id: "face-ca-sistan", coords: [61.86, 30.96] },
  { id: "top-kerman", face_id: "face-ca-kerman", coords: [57.08, 30.28] },
  { id: "top-shiraz", face_id: "face-ca-buyid", coords: [52.53, 29.59] },
  { id: "top-rayy", face_id: "face-ca-buyid", coords: [51.44, 35.59] },
  { id: "top-semnan", face_id: "face-ca-semnan", coords: [53.39, 35.58] },
  { id: "top-gorgan", face_id: "face-ca-ziyarid", coords: [54.44, 36.84] },
  { id: "top-amol", face_id: "face-ca-ziyarid", coords: [52.35, 36.47] },
  { id: "top-kabul", face_id: "face-ca-hindu-shahi", coords: [69.18, 34.53] },
  { id: "top-waihind", face_id: "face-ca-hindu-shahi", coords: [72.42, 34.02] },
  { id: "top-balasagun", face_id: "face-ca-qarakhanid", coords: [75.25, 42.75] },
  { id: "top-taraz", face_id: "face-ca-qarakhanid", coords: [71.37, 42.9] },
  { id: "top-kashgar", face_id: "face-ca-kashgar", coords: [75.99, 39.47] },
  { id: "top-khotan", face_id: "face-ca-khotan", coords: [79.92, 37.11] },
  { id: "top-qocho", face_id: "face-ca-qocho", coords: [89.53, 42.85] },
  { id: "top-yangikent", face_id: "face-ca-oghuz", coords: [61.92, 45.62] },
  { id: "top-imakiya", face_id: "face-ca-kimek", coords: [74.5, 49.8] },
];

function sliceState(epochKey, faceId) {
  const tier = "T3_GENERAL_ENCYCLOPEDIA";
  switch (faceId) {
    case "face-ca-transoxiana":
      return { polity_id: "polity-samanid", admin_unit_id: "admin-sam-bukhara", control_score: 95, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "DIRECT_CORE", highest_credibility_tier: tier };
    case "face-ca-khorasan":
    case "face-ca-tokharistan":
      return { polity_id: "polity-samanid", admin_unit_id: "admin-sam-khorasan", control_score: epochKey === "960" || epochKey === "975" ? 88 : 82, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "REGULAR_ADMIN", highest_credibility_tier: tier };
    case "face-ca-chaghaniyan":
      return { polity_id: "polity-muhtajid", admin_unit_id: "admin-muhtajid-chaghaniyan", control_score: 78, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "TRIBUTARY_VASSAL", highest_credibility_tier: tier };
    case "face-ca-guzgan":
      return { polity_id: "polity-farighunid", admin_unit_id: "admin-farighunid-guzgan", control_score: 76, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "TRIBUTARY_VASSAL", highest_credibility_tier: tier };
    case "face-ca-semnan":
      if (epochKey === "968" || epochKey === "970") {
        return { polity_id: "polity-samanid", control_score: 52, zone_semantics: "DISPUTED_OVERLAP", control_semantic_tag: "DISPUTED_CONTESTED", disputed_claimant_polity_ids: ["polity-samanid", "polity-buyid", "polity-ziyarid"], highest_credibility_tier: tier };
      }
      return { polity_id: "polity-samanid", control_score: epochKey === "975" ? 80 : 76, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "REGULAR_ADMIN", highest_credibility_tier: tier };
    case "face-ca-khwarazm":
      return { polity_id: "polity-khwarazm", admin_unit_id: "admin-khwarazm-kath", control_score: 74, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "TRIBUTARY_VASSAL", highest_credibility_tier: tier };
    case "face-ca-ghazna":
      if (epochKey === "960") return { polity_id: "polity-lawik", control_score: 70, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "INDIRECT_JIMI", highest_credibility_tier: tier };
      return { polity_id: "polity-ghaznavid", admin_unit_id: "admin-ghazna-base", control_score: epochKey === "962" ? 78 : epochKey === "975" ? 88 : 84, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "TRIBUTARY_VASSAL", highest_credibility_tier: tier };
    case "face-ca-ghur":
      return { polity_id: "polity-ghur", control_score: 54, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "LOOSE_OR_SPARSE_FRONTIER", highest_credibility_tier: tier };
    case "face-ca-sistan":
      if (epochKey === "970") return { polity_id: "polity-saffarid", admin_unit_id: "admin-saffarid-zarang", control_score: 48, zone_semantics: "DISPUTED_OVERLAP", control_semantic_tag: "DISPUTED_CONTESTED", disputed_claimant_polity_ids: ["polity-saffarid", "polity-samanid"], highest_credibility_tier: tier };
      return { polity_id: "polity-saffarid", admin_unit_id: "admin-saffarid-zarang", control_score: epochKey === "975" ? 82 : 76, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "REGULAR_ADMIN", highest_credibility_tier: tier };
    case "face-ca-kerman":
      if (epochKey === "960" || epochKey === "962") return { polity_id: "polity-banu-ilyas", control_score: 78, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "REGULAR_ADMIN", highest_credibility_tier: tier };
      return { polity_id: "polity-buyid", control_score: epochKey === "968" ? 80 : 90, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "REGULAR_ADMIN", highest_credibility_tier: tier };
    case "face-ca-ziyarid":
      return { polity_id: "polity-ziyarid", admin_unit_id: "admin-ziyarid-gorgan", control_score: epochKey === "968" ? 74 : 84, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "REGULAR_ADMIN", highest_credibility_tier: tier };
    case "face-ca-buyid":
      return { polity_id: "polity-buyid", admin_unit_id: "admin-buyid-rayy", control_score: 94, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "DIRECT_CORE", highest_credibility_tier: tier };
    case "face-ca-hindu-shahi":
      return { polity_id: "polity-hindu-shahi", control_score: 84, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "DIRECT_CORE", highest_credibility_tier: tier };
    case "face-ca-qarakhanid":
      return { polity_id: "polity-qarakhanid", admin_unit_id: "admin-qarakhanid-balasagun", control_score: epochKey === "960" ? 76 : 86, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "DIRECT_CORE", highest_credibility_tier: tier };
    case "face-ca-kashgar":
      if (epochKey === "970") return { polity_id: "polity-khotan", control_score: 64, zone_semantics: "DISPUTED_OVERLAP", control_semantic_tag: "DISPUTED_CONTESTED", disputed_claimant_polity_ids: ["polity-khotan", "polity-qarakhanid"], highest_credibility_tier: tier };
      if (epochKey === "975") return { polity_id: "polity-khotan", control_score: 76, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "REGULAR_ADMIN", highest_credibility_tier: tier };
      return { polity_id: "polity-qarakhanid", control_score: 86, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "DIRECT_CORE", highest_credibility_tier: tier };
    case "face-ca-khotan":
      return { polity_id: "polity-khotan", control_score: 90, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "DIRECT_CORE", highest_credibility_tier: tier };
    case "face-ca-qocho":
      return { polity_id: "polity-qocho", control_score: 86, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "DIRECT_CORE", highest_credibility_tier: tier };
    case "face-ca-oghuz":
      return { polity_id: "polity-oghuz", control_score: 52, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "LOOSE_OR_SPARSE_FRONTIER", highest_credibility_tier: tier };
    case "face-ca-kimek":
      return { polity_id: "polity-kimek", control_score: 48, zone_semantics: "POLITY_TERRITORY", control_semantic_tag: "LOOSE_OR_SPARSE_FRONTIER", highest_credibility_tier: tier };
    default:
      throw new Error(`Unknown face ${faceId}`);
  }
}

async function main() {
  const gis = await loadPhysicalGis(RAW_GIS_DIR);
  const dem = await createDemPathfinder(RAW_GIS_DIR);
  const gulfCoast = gis.eurasiaCoastRing.slice(68150, 69600);
  const caspian = gis.caspianRing;
  const aral = gis.aralRing;

  const amuChain = stitchRiverChain(
    [...gis.extractNamedSegments(["Panj"]), ...gis.extractNamedSegments(["Amu  Darya"])],
    [72.66, 37.03],
  );
  const syrChain = stitchRiverChain(gis.extractNamedSegments(["Naryn", "Syr  Darya"]), [61.08, 46.05]);
  const atrekChain = stitchRiverChain(gis.extractNamedSegments(["Atrek"]), [53.91, 37.41]);
  const uralChain = stitchRiverChain(gis.extractNamedSegments(["Ural"]), [51.72, 46.94]);
  const yarkantChain = stitchRiverChain(gis.extractNamedSegments(["Yarkant"]), [76.01, 37.12]);
  const aksuChain = stitchRiverChain(gis.extractNamedSegments(["Aksu"]), [80.04, 41.17]);
  const tarimChain = stitchRiverChain(gis.extractNamedSegments(["Tarim"]), [80.89, 40.47]);

  const snap = (pool, pt) => roundPt(pool[nearestPointIndex(pool, pt)]);

  // Shared planar nodes: water/river junctions snapped to 1:10m features, ridges placed on natural passes
  const N = {
    BUY_NW: [44.2, 36.2],
    GILAN_W: snap(caspian, [49.44, 37.50]),
    ATREK_W: snap(caspian, [53.90, 37.47]),
    ATREK_E: snap(atrekChain, [56.48, 37.83]),
    URAL_MOUTH: snap(caspian, [51.72, 46.94]),
    URAL_MID: snap(uralChain, [53.2, 51.3]),
    URAL_N: snap(uralChain, [58.5, 51.2]),
    IRTYSH_NE: [85.5, 51.5],
    KIM_QOC: [85.0, 46.8],
    QAR_QOC_N: [85.0, 46.8],
    STEPPE_TRI: [68.0, 46.2],
    QOCHO_NE: [92.5, 44.5],
    QOCHO_SE: [91.5, 39.2],
    KHOTAN_SE: [86.0, 36.2],
    AKSU_HEAD: snap(aksuChain, [80.04, 41.17]),
    TARIM_CONF: snap(tarimChain, [80.89, 40.47]),
    TARIM_END: snap(tarimChain, [86.75, 41.83]),
    YARKAND_PAMIR: snap(yarkantChain, [76.01, 37.12]),
    HUNZA_E: [75.1, 35.8],
    WAKHAN_S: [72.9, 36.3],
    PANJ_PAMIR: snap(amuChain, [72.66, 37.03]),
    FERG_E: [73.6, 40.1],
    SYR_MID: snap(syrChain, [68.24, 42.72]),
    SYR_DELTA: snap(syrChain, [65.50, 44.80]),
    ARAL_W: snap(aral, [58.16, 44.81]),
    ARAL_SE: snap(aral, [61.94, 45.03]),
    AMU_KHW: snap(amuChain, [61.75, 41.05]),
    AMU_GUZ: snap(amuChain, [64.35, 38.45]),
    AMU_TOK: snap(amuChain, [66.20, 37.42]),
    AMU_CHA_W: snap(amuChain, [67.10, 37.22]),
    AMU_CHA_E: snap(amuChain, [68.40, 37.05]),
    SEM_NW: [52.1, 35.95],
    SEM_NE: [55.9, 36.6],
    SEM_SW: [52.4, 34.1],
    SEM_SE: [55.9, 34.4],
    BUY_KER_KHO: [55.2, 32.1],
    KHO_KER_SIS: [59.2, 32.0],
    KHO_GUR_SIS: [63.1, 33.4],
    KHO_GUZ_GUR: [63.8, 35.4],
    GUZ_GUR_TOK: [65.9, 35.1],
    GUR_TOK_GHA: [67.4, 34.8],
    GUR_SIS_GHA: [64.0, 32.6],
    TOK_GHA_HS: [68.2, 34.25],
    KUWAIT: snap(gulfCoast, [48.35, 28.95]),
    HORMUZ: snap(gulfCoast, [56.50, 27.12]),
    KERMAN_E: snap(gulfCoast, [59.50, 25.35]),
    SINDH: snap(gulfCoast, [66.60, 25.33]),
    SIS_GHA_EXT: [66.6, 29.8],
    GHA_HS_EXT: [70.6, 31.4],
    INDUS_E: [74.8, 30.8],
  };

  const rawArcs = [];
  const addArc = (id, aKey, bKey, certainty, coords) => {
    rawArcs.push({
      arc_id: id,
      start_node_id: `n-${aKey.toLowerCase()}`,
      end_node_id: `n-${bKey.toLowerCase()}`,
      coordinates: coords,
      certainty,
    });
  };
  const river = (id, a, b, chain) => {
    const coords = extractPolylineSubpath(chain, N[a], N[b], 0.004, 18);
    dem.stampOccupiedPolyline(coords);
    addArc(id, a, b, "NATURAL_FEATURE", coords);
  };
  const coast = (id, a, b, ring, via) => {
    const coords = extractRingSubpath(ring, N[a], N[b], via, 0, 18);
    dem.stampOccupiedPolyline(coords);
    addArc(id, a, b, "NATURAL_FEATURE", coords);
  };
  const terrainArc = (id, a, b, wps, mode = "divide", cert = "APPROXIMATE_FUZZY", corridorPx = 10, terrainWeight = 0.34) => {
    const coords = dem.traceRefinedBorderArc({
      start: N[a],
      end: N[b],
      waypoints: wps,
      mode,
      corridorPx,
      terrainWeight,
      seedKey: id,
      maxSegKm: 16,
    });
    addArc(id, a, b, cert, coords);
  };

  // Exterior & 1:10m natural coastlines + rivers first (stamped into occupiedMask before land pathfinding)
  coast("arc-buy-gulf", "KUWAIT", "HORMUZ", gulfCoast, [51.5, 28.0]);
  coast("arc-ker-gulf", "HORMUZ", "KERMAN_E", gulfCoast, [57.8, 25.6]);
  coast("arc-sis-coast", "KERMAN_E", "SINDH", gulfCoast, [62.3, 25.1]);
  coast("arc-ziy-casp", "GILAN_W", "ATREK_W", caspian, [52.3, 36.6]);
  coast("arc-ogh-casp", "ATREK_W", "URAL_MOUTH", caspian, [51.1, 43.7]);
  coast("arc-ogh-aral", "ARAL_SE", "ARAL_W", aral, [61.08, 46.11]);
  coast("arc-khw-aral", "ARAL_W", "ARAL_SE", aral, [59.76, 43.64]);
  river("arc-ogh-ural", "URAL_MOUTH", "URAL_MID", uralChain);
  river("arc-kim-ural", "URAL_MID", "URAL_N", uralChain);

  // Internal 1:10m rivers (Amu-Panj, Syr, Atrek, Aksu, Yarkant, Tarim)
  river("arc-ziy-ogh-atr", "ATREK_W", "ATREK_E", atrekChain);
  river("arc-kho-tra-amu", "AMU_KHW", "AMU_GUZ", amuChain);
  river("arc-guz-tra-amu", "AMU_GUZ", "AMU_TOK", amuChain);
  river("arc-tok-tra-amu", "AMU_TOK", "AMU_CHA_W", amuChain);
  river("arc-tok-cha-amu", "AMU_CHA_W", "AMU_CHA_E", amuChain);
  river("arc-tok-tra-panj", "AMU_CHA_E", "PANJ_PAMIR", amuChain);
  river("arc-ogh-tra-syr", "SYR_DELTA", "SYR_MID", syrChain);
  river("arc-kas-qoc-aks", "AKSU_HEAD", "TARIM_CONF", aksuChain);
  river("arc-kas-kho-yar", "YARKAND_PAMIR", "TARIM_CONF", yarkantChain);
  river("arc-kho-qoc-tar", "TARIM_CONF", "TARIM_END", tarimChain);

  // Exterior land frontiers (mild terrain-guided corridors)
  terrainArc("arc-buy-ext-nw", "BUY_NW", "GILAN_W", [[45.4, 37.3], [46.8, 38.0], [48.1, 37.8]], "ridge");
  terrainArc("arc-buy-ext-w", "BUY_NW", "KUWAIT", [[43.9, 34.4], [44.6, 32.1], [46.1, 30.2], [46.9, 28.9]], "contour");
  terrainArc("arc-kim-ext-n", "URAL_N", "IRTYSH_NE", [[62.5, 52.3], [67.8, 53.3], [73.4, 53.7], [79.8, 52.8]], "divide");
  terrainArc("arc-kim-ext-e", "IRTYSH_NE", "KIM_QOC", [[85.9, 49.8], [85.4, 48.2]], "ridge");
  terrainArc("arc-qoc-ext-n", "KIM_QOC", "QOCHO_NE", [[87.2, 46.6], [89.8, 45.7]], "ridge");
  terrainArc("arc-qoc-ext-e", "QOCHO_NE", "QOCHO_SE", [[92.4, 42.9], [91.9, 40.9]], "contour");
  terrainArc("arc-kho-ext-e", "QOCHO_SE", "KHOTAN_SE", [[89.8, 38.1], [87.8, 36.9]], "ridge");
  terrainArc("arc-kho-ext-s", "KHOTAN_SE", "HUNZA_E", [[82.9, 35.6], [79.4, 35.2], [76.9, 35.4]], "ridge");
  terrainArc("arc-hs-ext-e", "HUNZA_E", "INDUS_E", [[75.4, 34.1], [75.3, 32.4]], "ridge");
  terrainArc("arc-hs-ext-s", "INDUS_E", "GHA_HS_EXT", [[73.4, 30.8], [71.9, 31.0]], "contour");
  terrainArc("arc-gha-ext-s", "GHA_HS_EXT", "SIS_GHA_EXT", [[69.4, 31.0], [67.8, 30.4]], "ridge");
  terrainArc("arc-sis-ext-e", "SIS_GHA_EXT", "SINDH", [[67.0, 28.4], [66.8, 26.8]], "ridge");

  // Internal ridge / desert / steppe shared arcs (mild DEM-guided refined geometry)
  terrainArc("arc-buy-ziy", "GILAN_W", "SEM_NW", [[49.9, 36.8], [50.9, 36.2]], "ridge");
  terrainArc("arc-ziy-sem", "SEM_NW", "SEM_NE", [[53.0, 36.0], [54.4, 36.2]], "ridge");
  terrainArc("arc-ziy-kho", "ATREK_E", "SEM_NE", [[56.2, 37.3]], "ridge");
  terrainArc("arc-buy-sem-w", "SEM_NW", "SEM_SW", [[52.1, 35.1]], "contour");
  terrainArc("arc-buy-sem-s", "SEM_SW", "SEM_SE", [[53.6, 34.0], [54.8, 34.2]], "contour");
  terrainArc("arc-sem-kho", "SEM_NE", "SEM_SE", [[56.1, 35.6]], "contour");
  terrainArc("arc-buy-kho", "SEM_SE", "BUY_KER_KHO", [[55.6, 33.3]], "contour");
  terrainArc("arc-buy-ker", "BUY_KER_KHO", "HORMUZ", [[55.1, 30.6], [55.7, 28.8]], "ridge");
  terrainArc("arc-kho-ker", "BUY_KER_KHO", "KHO_KER_SIS", [[56.7, 32.4], [58.0, 32.2]], "contour");
  terrainArc("arc-ker-sis", "KHO_KER_SIS", "KERMAN_E", [[59.4, 29.8], [59.7, 27.5]], "contour");
  terrainArc("arc-kho-sis", "KHO_KER_SIS", "KHO_GUR_SIS", [[60.6, 32.5], [61.9, 33.1]], "contour");
  terrainArc("arc-sis-gur", "KHO_GUR_SIS", "GUR_SIS_GHA", [[63.5, 33.0]], "ridge");
  terrainArc("arc-sis-gha", "GUR_SIS_GHA", "SIS_GHA_EXT", [[65.0, 31.9], [66.1, 31.0]], "contour");
  terrainArc("arc-gha-hs", "TOK_GHA_HS", "GHA_HS_EXT", [[69.4, 33.9], [70.2, 32.9]], "ridge", "DISPUTED_SCHOLARLY");
  terrainArc("arc-gha-gur", "GUR_SIS_GHA", "GUR_TOK_GHA", [[65.2, 33.3], [66.4, 34.0]], "ridge");
  terrainArc("arc-tok-gha", "GUR_TOK_GHA", "TOK_GHA_HS", [[67.8, 34.5]], "ridge");
  terrainArc("arc-tok-hs", "TOK_GHA_HS", "WAKHAN_S", [[69.0, 35.2], [70.5, 35.8], [71.8, 36.1]], "ridge");
  terrainArc("arc-hs-kho-w", "WAKHAN_S", "YARKAND_PAMIR", [[74.4, 36.6]], "ridge");
  terrainArc("arc-hs-kho-e", "YARKAND_PAMIR", "HUNZA_E", [[75.5, 36.4]], "ridge");
  terrainArc("arc-tok-kas", "WAKHAN_S", "PANJ_PAMIR", [[72.8, 36.65]], "ridge");
  terrainArc("arc-kho-gur", "KHO_GUR_SIS", "KHO_GUZ_GUR", [[63.4, 34.4]], "ridge");
  terrainArc("arc-kho-guz", "AMU_GUZ", "KHO_GUZ_GUR", [[64.1, 37.0], [63.9, 36.1]], "divide");
  terrainArc("arc-guz-gur", "KHO_GUZ_GUR", "GUZ_GUR_TOK", [[64.9, 35.2]], "ridge");
  terrainArc("arc-gur-tok", "GUZ_GUR_TOK", "GUR_TOK_GHA", [[66.6, 34.9]], "ridge");
  terrainArc("arc-guz-tok", "AMU_TOK", "GUZ_GUR_TOK", [[66.0, 36.3]], "divide");
  terrainArc("arc-tra-cha", "AMU_CHA_W", "AMU_CHA_E", [[67.1, 38.2], [67.8, 38.9], [68.7, 38.4]], "ridge");
  terrainArc("arc-kho-ogh", "ATREK_E", "AMU_KHW", [[57.7, 38.7], [59.3, 39.5], [60.7, 40.3]], "contour");
  terrainArc("arc-ogh-khw", "AMU_KHW", "ARAL_W", [[59.6, 41.2], [58.1, 42.3], [57.6, 43.7]], "contour");
  terrainArc("arc-khw-tra", "AMU_KHW", "ARAL_SE", [[62.1, 42.4], [62.2, 43.8]], "contour");
  terrainArc("arc-ogh-tra-n", "ARAL_SE", "SYR_DELTA", [[63.6, 44.8]], "divide");
  terrainArc("arc-ogh-kim", "URAL_MID", "STEPPE_TRI", [[56.8, 50.1], [61.2, 48.6], [64.8, 47.2]], "divide");
  terrainArc("arc-ogh-qar", "STEPPE_TRI", "SYR_MID", [[68.2, 44.6]], "divide");
  terrainArc("arc-kim-qar", "STEPPE_TRI", "KIM_QOC", [[72.5, 46.5], [76.8, 46.7], [81.2, 46.7]], "divide");
  terrainArc("arc-tra-qar", "SYR_MID", "FERG_E", [[69.6, 42.1], [71.4, 41.8], [72.6, 41.0]], "ridge");
  terrainArc("arc-tra-kas", "FERG_E", "PANJ_PAMIR", [[73.5, 39.2], [73.1, 38.0]], "ridge");
  terrainArc("arc-qar-kas", "FERG_E", "AKSU_HEAD", [[75.5, 40.6], [77.8, 41.3]], "ridge");
  terrainArc("arc-qar-qoc", "AKSU_HEAD", "KIM_QOC", [[81.2, 42.5], [82.8, 44.1], [84.1, 45.6]], "ridge");
  terrainArc("arc-kho-qoc-e", "TARIM_END", "QOCHO_SE", [[88.5, 40.9], [90.2, 39.9]], "contour");

  const faceSpecs = [
    { face_id: "face-ca-buyid", arc_ids: ["arc-buy-ext-nw", "arc-buy-ziy", "arc-buy-sem-w", "arc-buy-sem-s", "arc-buy-kho", "arc-buy-ker", "arc-buy-gulf", "arc-buy-ext-w"] },
    { face_id: "face-ca-ziyarid", arc_ids: ["arc-ziy-casp", "arc-ziy-ogh-atr", "arc-ziy-kho", "arc-ziy-sem", "arc-buy-ziy"] },
    { face_id: "face-ca-semnan", arc_ids: ["arc-ziy-sem", "arc-sem-kho", "arc-buy-sem-s", "arc-buy-sem-w"] },
    { face_id: "face-ca-kerman", arc_ids: ["arc-buy-ker", "arc-kho-ker", "arc-ker-sis", "arc-ker-gulf"] },
    { face_id: "face-ca-sistan", arc_ids: ["arc-ker-sis", "arc-kho-sis", "arc-sis-gur", "arc-sis-gha", "arc-sis-ext-e", "arc-sis-coast"] },
    { face_id: "face-ca-khorasan", arc_ids: ["arc-ziy-kho", "arc-kho-ogh", "arc-kho-tra-amu", "arc-kho-guz", "arc-kho-gur", "arc-kho-sis", "arc-kho-ker", "arc-buy-kho", "arc-sem-kho"] },
    { face_id: "face-ca-guzgan", arc_ids: ["arc-kho-guz", "arc-guz-tra-amu", "arc-guz-tok", "arc-guz-gur"] },
    { face_id: "face-ca-ghur", arc_ids: ["arc-kho-gur", "arc-guz-gur", "arc-gur-tok", "arc-gha-gur", "arc-sis-gur"] },
    { face_id: "face-ca-tokharistan", arc_ids: ["arc-guz-tok", "arc-tok-tra-amu", "arc-tok-cha-amu", "arc-tok-tra-panj", "arc-tok-kas", "arc-tok-hs", "arc-tok-gha", "arc-gur-tok"] },
    { face_id: "face-ca-chaghaniyan", arc_ids: ["arc-tra-cha", "arc-tok-cha-amu"] },
    { face_id: "face-ca-khwarazm", arc_ids: ["arc-khw-aral", "arc-khw-tra", "arc-ogh-khw"] },
    { face_id: "face-ca-transoxiana", arc_ids: ["arc-khw-tra", "arc-ogh-tra-n", "arc-ogh-tra-syr", "arc-tra-qar", "arc-tra-kas", "arc-tok-tra-panj", "arc-tra-cha", "arc-tok-tra-amu", "arc-guz-tra-amu", "arc-kho-tra-amu"] },
    { face_id: "face-ca-oghuz", arc_ids: ["arc-ogh-casp", "arc-ogh-ural", "arc-ogh-kim", "arc-ogh-qar", "arc-ogh-tra-syr", "arc-ogh-tra-n", "arc-ogh-aral", "arc-ogh-khw", "arc-kho-ogh", "arc-ziy-ogh-atr"] },
    { face_id: "face-ca-kimek", arc_ids: ["arc-kim-ural", "arc-kim-ext-n", "arc-kim-ext-e", "arc-kim-qar", "arc-ogh-kim"] },
    { face_id: "face-ca-qarakhanid", arc_ids: ["arc-ogh-qar", "arc-kim-qar", "arc-qar-qoc", "arc-qar-kas", "arc-tra-qar"] },
    { face_id: "face-ca-kashgar", arc_ids: ["arc-tra-kas", "arc-qar-kas", "arc-kas-qoc-aks", "arc-kas-kho-yar", "arc-hs-kho-w", "arc-tok-kas"] },
    { face_id: "face-ca-khotan", arc_ids: ["arc-kas-kho-yar", "arc-kho-qoc-tar", "arc-kho-qoc-e", "arc-kho-ext-e", "arc-kho-ext-s", "arc-hs-kho-e"] },
    { face_id: "face-ca-qocho", arc_ids: ["arc-qar-qoc", "arc-qoc-ext-n", "arc-qoc-ext-e", "arc-kho-qoc-e", "arc-kho-qoc-tar", "arc-kas-qoc-aks"] },
    { face_id: "face-ca-ghazna", arc_ids: ["arc-sis-gha", "arc-gha-gur", "arc-tok-gha", "arc-gha-hs", "arc-gha-ext-s"] },
    { face_id: "face-ca-hindu-shahi", arc_ids: ["arc-gha-hs", "arc-tok-hs", "arc-hs-kho-w", "arc-hs-kho-e", "arc-hs-ext-e", "arc-hs-ext-s"] },
  ];

  const { compiledFaces, totalVertices, avgSegKm, maxSegKm } = compilePlanarTopology({
    arcs: rawArcs,
    faceSpecs,
    cityChecks: HISTORICAL_CITIES,
  });

  const slices = {};
  for (const ek of ["960", "962", "968", "970", "975"]) {
    slices[ek] = compiledFaces.map((cf) => ({
      face_id: cf.face_id,
      ...sliceState(ek, cf.face_id),
      boundary_arc_ids: cf.boundary_arc_ids,
    }));
  }

  await writeGeneratedCentralAsiaTs(OUT_TS_PATH, "GENERATED_CENTRAL_ASIA_960_975", {
    arcs: rawArcs,
    slices,
  });

  const naturalCount = rawArcs.filter((a) => a.certainty === "NATURAL_FEATURE").length;
  console.log(
    `Compiled pure natural-GIS Central Asia 960-975 | faces: ${compiledFaces.length} | arcs: ${rawArcs.length} (natural: ${naturalCount}) | vertices: ${totalVertices} | avgSegKm: ${avgSegKm.toFixed(2)} | maxSegKm: ${maxSegKm.toFixed(2)} | 29/29 cities inside!`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
