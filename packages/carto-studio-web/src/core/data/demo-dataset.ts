import {
  createHistoricalTimestamp,
  type ControlSemanticTag,
  type EpochRange,
  type HistoricalEvent,
  type MapSnapshot,
  type SharedBoundaryArc,
  type SpatialChangeSet,
  type TerritorialFace,
} from "@historical-cartography/shared-schema";
import type { LineString } from "geojson";
import { draftSnapshot as sharedContractDraftSnapshot } from "../../../../shared-schema/examples/service-examples.ts";
import {
  DEMO_ADMIN_EVOLUTIONS,
  DEMO_ADMIN_UNITS,
  DEMO_EVENTS,
  DEMO_FIGURES,
  DEMO_MARCHING_ROUTES,
  DEMO_PALEO_OVERLAYS,
  MODERN_REFERENCE_OVERLAY,
  WATER_LABELS_CA,
} from "./demo-events-960-975.ts";
import {
  DEMO_CITATIONS,
  DEMO_POLITIES,
  DEMO_SOURCES,
  DEMO_TOPONYMS,
  JDN_960,
  JDN_962,
  JDN_967,
  JDN_970,
  JDN_972,
  JDN_976,
} from "./demo-sources-events.ts";
import type { DiffComparisonRecord, EpochSceneBundle } from "./demo-types.ts";
import {
  GENERATED_CENTRAL_ASIA_960_975,
  type GeneratedFaceSeed,
} from "./generated/central-asia-960-975.ts";
import {
  buildSnapshotFromSharedTopology,
  deriveBoundedSplineGeometry,
  measureArcFractalDimension,
  measureMaxHausdorffDeviationKm,
} from "./topology-builder.ts";

const JDN_960_START = createHistoricalTimestamp({
  astronomical_year: 960,
  month: 1,
  day: 1,
}).julian_day_number;

const DEFAULT_CA_CAMERA: { center: [number, number]; zoom: number } = {
  center: [67.0, 38.6],
  zoom: 3.48,
};

function makeEpochCanonicalArcs(
  epoch: EpochRange,
  drivenByEventIds: string[],
): SharedBoundaryArc[] {
  return GENERATED_CENTRAL_ASIA_960_975.arcs.map((seed) => {
    const canonicalGeometry: LineString = {
      type: "LineString",
      coordinates: seed.coordinates.map((pt) => [pt[0] ?? 0, pt[1] ?? 0]),
    };
    const renderedSpline = deriveBoundedSplineGeometry(canonicalGeometry, 0.78);
    return {
      arc_id: seed.arc_id,
      epoch_id: epoch.epoch_id,
      canonical_geometry: canonicalGeometry,
      rendered_spline_geometry: renderedSpline,
      smoothness_profile_id: "profile-ca-10m-v1",
      measured_fractal_dim: measureArcFractalDimension(renderedSpline),
      measured_max_deviation_km: measureMaxHausdorffDeviationKm(canonicalGeometry, renderedSpline),
      start_node_id: seed.start_node_id,
      end_node_id: seed.end_node_id,
      left_face_id: seed.left_face_id,
      right_face_id: seed.right_face_id,
      certainty: seed.certainty ?? "APPROXIMATE_FUZZY",
      valid_from_jdn: epoch.valid_from_jdn,
      valid_to_jdn: epoch.valid_to_jdn,
      driven_by_event_ids: [...drivenByEventIds],
      human_locked_override: false,
    };
  });
}

function hydrateSliceFaces(
  epoch: EpochRange,
  seeds: readonly GeneratedFaceSeed[],
  drivenByEventIds: string[],
): {
  faces: TerritorialFace[];
  holesMap: Record<string, string[]>;
} {
  const holesMap: Record<string, string[]> = {};
  const faces: TerritorialFace[] = seeds.map((seed) => {
    if (seed.interior_hole_arc_ids && seed.interior_hole_arc_ids.length > 0) {
      holesMap[seed.face_id] = [...seed.interior_hole_arc_ids];
    }
    return {
      face_id: seed.face_id,
      epoch_id: epoch.epoch_id,
      boundary_arc_ids: [...seed.boundary_arc_ids],
      zone_semantics: seed.zone_semantics,
      polity_id: seed.polity_id,
      ...(seed.admin_unit_id ? { admin_unit_id: seed.admin_unit_id } : {}),
      control_score: seed.control_score,
      ...(seed.control_semantic_tag
        ? { control_semantic_tag: seed.control_semantic_tag as ControlSemanticTag }
        : {}),
      ...(seed.control_semantic_tag === "LOOSE_OR_SPARSE_FRONTIER"
        ? { is_sparse_or_desert_zone: true }
        : {}),
      ...(seed.disputed_claimant_polity_ids
        ? { disputed_claimant_polity_ids: [...seed.disputed_claimant_polity_ids] }
        : {}),
      valid_from_jdn: epoch.valid_from_jdn,
      valid_to_jdn: epoch.valid_to_jdn,
      highest_credibility_tier: seed.highest_credibility_tier,
      driven_by_event_ids: [...drivenByEventIds],
      human_locked_override: false,
    };
  });
  return { faces, holesMap };
}

interface CentralAsiaSliceConfig {
  sliceKey: "960" | "962" | "968" | "970" | "975";
  prevSliceKey?: "960" | "962" | "968" | "970";
  epoch_id: string;
  valid_from_jdn: number;
  valid_to_jdn: number;
  revision_id: string;
  data_status: MapSnapshot["data_status"];
  epoch_label_zh: string;
  historical_year_display: string;
  calendar_era_note: string;
  subtitle_default: string;
  eventIds: string[];
  affectedToponymIds: string[];
  diffSummaryZh?: string;
  changesetStatus?: SpatialChangeSet["status"];
}

function buildCentralAsiaBundle(cfg: CentralAsiaSliceConfig): EpochSceneBundle {
  const epoch: EpochRange = {
    epoch_id: cfg.epoch_id,
    valid_from_jdn: cfg.valid_from_jdn,
    valid_to_jdn: cfg.valid_to_jdn,
  };
  const arcs = makeEpochCanonicalArcs(epoch, cfg.eventIds);
  const afterSeeds = GENERATED_CENTRAL_ASIA_960_975.slices[cfg.sliceKey] ?? [];
  const { faces: afterFaces, holesMap } = hydrateSliceFaces(epoch, afterSeeds, cfg.eventIds);
  const holesOpt = Object.keys(holesMap).length > 0 ? holesMap : undefined;

  const afterSnapshot = buildSnapshotFromSharedTopology(
    epoch,
    cfg.revision_id,
    cfg.data_status,
    arcs,
    afterFaces,
    true,
    holesOpt,
  );

  let diffRecord: DiffComparisonRecord | undefined;
  if (cfg.prevSliceKey && cfg.diffSummaryZh) {
    const beforeSeeds = GENERATED_CENTRAL_ASIA_960_975.slices[cfg.prevSliceKey] ?? [];
    const { faces: beforeFaces, holesMap: beforeHoles } = hydrateSliceFaces(epoch, beforeSeeds, cfg.eventIds);
    const beforeSnapshot = buildSnapshotFromSharedTopology(
      epoch,
      `${cfg.revision_id}-before`,
      "COMMITTED",
      arcs,
      beforeFaces,
      true,
      Object.keys(beforeHoles).length > 0 ? beforeHoles : undefined,
    );

    const beforeByFace = new Map(beforeFaces.map((f) => [f.face_id, f]));
    const affectedArcSet = new Set<string>();
    const operationsLog: Record<string, unknown>[] = [];
    for (const af of afterFaces) {
      const bf = beforeByFace.get(af.face_id);
      if (!bf || bf.polity_id !== af.polity_id || bf.zone_semantics !== af.zone_semantics) {
        for (const aid of af.boundary_arc_ids) affectedArcSet.add(aid);
        operationsLog.push({
          op: "reassign_base_units",
          target_face_id: af.face_id,
          from_polity: bf?.polity_id,
          to_polity: af.polity_id,
          zone_semantics: af.zone_semantics,
        });
      }
    }

    const changeset: SpatialChangeSet = {
      changeset_id: `cs-${cfg.sliceKey}-wiki`,
      parent_changeset_id: `cs-${cfg.prevSliceKey}-wiki`,
      branch_name: `wiki-test/ca-${cfg.sliceKey}`,
      epoch_id: cfg.epoch_id,
      author_type: "AI_AGENT",
      author_id: "wiki-bootstrap-compiler-v1",
      bound_event_ids: [...cfg.eventIds],
      operations_log: operationsLog,
      gate_report: {
        g1_topology_passed: true,
        g1_5_smoothness_passed: true,
        g2_event_binding_passed: cfg.eventIds.length > 0,
        g3_provenance_quote_passed: true,
        g4_human_lock_passed: cfg.changesetStatus === "COMMITTED",
      },
      status: cfg.changesetStatus ?? "PENDING_HUMAN_REVIEW",
      created_at_iso: "2026-11-22T15:00:00Z",
    };

    diffRecord = {
      changeset,
      summary_zh: cfg.diffSummaryZh,
      before_snapshot: beforeSnapshot,
      after_snapshot: afterSnapshot,
      affected_arc_ids: [...affectedArcSet],
      affected_toponym_ids: [...cfg.affectedToponymIds],
    };
  }

  const events: HistoricalEvent[] = DEMO_EVENTS.filter((e) => cfg.eventIds.includes(e.hist_event_id));
  const figures = DEMO_FIGURES.filter(
    (f) => f.active_to_jdn > epoch.valid_from_jdn && f.active_from_jdn < epoch.valid_to_jdn,
  );
  const toponyms = DEMO_TOPONYMS.filter(
    (t) => t.valid_to_jdn > epoch.valid_from_jdn && t.valid_from_jdn < epoch.valid_to_jdn,
  );
  const marchingRoutes = DEMO_MARCHING_ROUTES.filter((r) => cfg.eventIds.includes(r.hist_event_id));

  return {
    epoch,
    epoch_label_zh: cfg.epoch_label_zh,
    historical_year_display: cfg.historical_year_display,
    calendar_era_note: cfg.calendar_era_note,
    revision_id: afterSnapshot.revision_id,
    data_status: afterSnapshot.data_status,
    is_demo_fixture: true,
    recommended_style_id: "vivid_video_songti",
    recommended_hud_types: ["DATE_ERA_BADGE", "FIGURE_PORTRAIT_PIN", "SUBTITLE_BAR"],
    subtitle_default: cfg.subtitle_default,
    water_labels: WATER_LABELS_CA,
    canonical_arcs: arcs,
    canonical_faces: afterFaces,
    snapshot: afterSnapshot,
    admin_units: DEMO_ADMIN_UNITS,
    admin_evolutions: DEMO_ADMIN_EVOLUTIONS,
    toponyms,
    events,
    sources: DEMO_SOURCES,
    citations_by_id: DEMO_CITATIONS,
    figures,
    paleo_overlays: DEMO_PALEO_OVERLAYS,
    marching_routes: marchingRoutes,
    polities: DEMO_POLITIES,
    ...(diffRecord ? { diff_record: diffRecord } : {}),
    default_camera: { center: [...DEFAULT_CA_CAMERA.center] as [number, number], zoom: DEFAULT_CA_CAMERA.zoom },
    modern_reference_overlay: MODERN_REFERENCE_OVERLAY,
  };
}

const SLICE_CONFIGS: readonly CentralAsiaSliceConfig[] = [
  {
    sliceKey: "960",
    epoch_id: "epoch-960-central-asia",
    valid_from_jdn: JDN_960_START,
    valid_to_jdn: JDN_962,
    revision_id: "rev-ca-960-wiki-001",
    data_status: "COMMITTED",
    epoch_label_zh: "公元 960 年 · 中亚维基基线（二十万帐改宗）",
    historical_year_display: "公元 960–961 年",
    calendar_era_note: "回历 349–350 年 / 北宋建隆元–二年",
    subtitle_default: "约960年突厥二十万帐改宗；加兹尼由拉维克地方政权领有，克尔曼仍归伊利亚斯王朝",
    eventIds: ["event-960-karakhanid-conversion"],
    affectedToponymIds: ["top-balasagun", "top-kashgar", "top-bukhara"],
  },
  {
    sliceKey: "962",
    prevSliceKey: "960",
    epoch_id: "epoch-962-ghazna-rise",
    valid_from_jdn: JDN_962,
    valid_to_jdn: JDN_967,
    revision_id: "rev-ca-962-wiki-002",
    data_status: "COMMITTED",
    epoch_label_zh: "公元 962 年 · 阿尔普特勤夺取加兹尼",
    historical_year_display: "公元 962–966 年",
    calendar_era_note: "回历 351–355 年 / 北宋建隆三年–乾德四年",
    subtitle_default: "曼苏尔一世继位萨曼后，阿尔普特勤南越兴都库什逐走拉维克取加兹尼",
    eventIds: ["event-962-alptigin-ghazna", "event-960-karakhanid-conversion"],
    affectedToponymIds: ["top-ghazna", "top-kabul", "top-bukhara"],
    diffSummaryZh: "960→962年差异（Wikipedia T3）：加兹尼与扎布里斯坦由拉维克（polity-lawik）转归阿尔普特勤加兹尼政权（polity-ghaznavid）。",
    changesetStatus: "COMMITTED",
  },
  {
    sliceKey: "968",
    prevSliceKey: "962",
    epoch_id: "epoch-968-kerman-ziyarid",
    valid_from_jdn: JDN_967,
    valid_to_jdn: JDN_970,
    revision_id: "rev-ca-968-wiki-003",
    data_status: "DRAFT",
    epoch_label_zh: "公元 967–968 年 · 白益吞并克尔曼与库米斯对峙",
    historical_year_display: "公元 967–969 年",
    calendar_era_note: "回历 356–358 年 / 北宋开宝元–二年",
    subtitle_default: "武什姆吉尔卒后比苏通联白益；968年阿杜德·道莱征服克尔曼，库米斯（塞姆南）转为争议前沿",
    eventIds: ["event-968-buyid-kerman-ziyarid"],
    affectedToponymIds: ["top-kerman", "top-gorgan", "top-semnan"],
    diffSummaryZh: "962→968年差异（Wikipedia T3）：克尔曼与霍尔木兹海峡岛屿自伊利亚斯王朝（polity-banu-ilyas）并入白益王朝（polity-buyid）；塞姆南进入三方争议叠加。",
    changesetStatus: "PENDING_HUMAN_REVIEW",
  },
  {
    sliceKey: "970",
    prevSliceKey: "968",
    epoch_id: "epoch-970-khotan-kashgar",
    valid_from_jdn: JDN_970,
    valid_to_jdn: JDN_972,
    revision_id: "rev-ca-970-wiki-004",
    data_status: "DRAFT",
    epoch_label_zh: "公元 970 年 · 于阗克喀什噶尔与锡斯坦内战",
    historical_year_display: "公元 970–971 年",
    calendar_era_note: "回历 359–360 年 / 北宋开宝三–四年",
    subtitle_default: "于阗王尉迟输罗攻占喀什噶尔并向宋献舞象；萨法尔扎兰季因侯赛因借萨曼军而爆内战",
    eventIds: ["event-970-khotan-kashgar-sistan"],
    affectedToponymIds: ["top-kashgar", "top-khotan", "top-zarang"],
    diffSummaryZh: "968→970年差异（Wikipedia T3）：西塔里木喀什噶尔由喀喇汗国易手至佛教于阗争议占领；锡斯坦扎兰季因萨法尔宗室内战标记争议叠加。",
    changesetStatus: "PENDING_HUMAN_REVIEW",
  },
  {
    sliceKey: "975",
    prevSliceKey: "970",
    epoch_id: "epoch-972-975-treaty",
    valid_from_jdn: JDN_972,
    valid_to_jdn: JDN_976,
    revision_id: "rev-ca-975-wiki-005",
    data_status: "DRAFT",
    epoch_label_zh: "公元 972–975 年 · 萨曼—白益和约与加德兹之役",
    historical_year_display: "公元 972–975 年",
    calendar_era_note: "回历 361–364 年 / 北宋开宝五–八年",
    subtitle_default: "回历361年白益向布哈拉纳贡议和，呼罗珊—库米斯回稳；975年比尔格特勤围攻加德兹阵亡",
    eventIds: ["event-972-975-treaty-gardez"],
    affectedToponymIds: ["top-semnan", "top-bukhara", "top-gardez"],
    diffSummaryZh: "970→975年差异（Wikipedia T3）：库米斯与锡斯坦解除争议转为常态控区；喀什噶尔巩固为于阗控制面（待学者进一步定年退出节点）。",
    changesetStatus: "PENDING_HUMAN_REVIEW",
  },
];

const CONTRACT_FIXTURE_BUNDLE: EpochSceneBundle = {
  epoch: sharedContractDraftSnapshot.epoch,
  epoch_label_zh: "Phase 0 契约夹具（Codex draftSnapshot）",
  historical_year_display: "公元 928 年",
  calendar_era_note: "shared-schema 最小交接夹具",
  revision_id: sharedContractDraftSnapshot.revision_id,
  data_status: sharedContractDraftSnapshot.data_status,
  is_demo_fixture: true,
  recommended_style_id: "vivid_video_songti",
  recommended_hud_types: ["DATE_ERA_BADGE"],
  canonical_arcs: [],
  canonical_faces: [],
  snapshot: sharedContractDraftSnapshot,
  admin_units: [],
  admin_evolutions: [],
  toponyms: [],
  events: [],
  sources: [],
  citations_by_id: {},
  figures: [],
  paleo_overlays: [],
  marching_routes: [],
  polities: [
    {
      polity_id: "fixture-polity",
      name_zh: "契约样例政权 (fixture-polity)",
      preferred_hex: "#4c78a8",
      monarch_name: "契约夹具",
      era_label: "928 CE",
      summary: "直接消费 packages/shared-schema/examples/service-examples.ts 的 draftSnapshot。",
    },
  ],
  default_camera: { center: [0.5, 0.5], zoom: 6.2 },
  modern_reference_overlay: MODERN_REFERENCE_OVERLAY,
};

export const DEMO_SCENE_BUNDLES: readonly EpochSceneBundle[] = SLICE_CONFIGS.map(buildCentralAsiaBundle);

export function resolveSceneBundleByJdn(jdn: number): EpochSceneBundle | undefined {
  // Touch JDN_960 for static symmetry with event timestamps
  void JDN_960;
  return DEMO_SCENE_BUNDLES.find(
    (bundle) => jdn >= bundle.epoch.valid_from_jdn && jdn < bundle.epoch.valid_to_jdn,
  );
}

export function resolveSceneBundleByEpochId(epochId: string): EpochSceneBundle | undefined {
  if (epochId === "contract-fixture") return CONTRACT_FIXTURE_BUNDLE;
  return DEMO_SCENE_BUNDLES.find((bundle) => bundle.epoch.epoch_id === epochId);
}
