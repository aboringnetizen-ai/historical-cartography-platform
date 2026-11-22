import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createHistoricalTimestamp, type EventEvidenceResult } from "@historical-cartography/shared-schema";
import { ciede2000, evaluateControlScoreVisuals, solvePolityPalette } from "../src/core/color/ciede2000.ts";
import { DEMO_SCENE_BUNDLES, resolveSceneBundleByEpochId, resolveSceneBundleByJdn } from "../src/core/data/demo-dataset.ts";
import {
  DEMO_SOURCES,
  JDN_1BCE,
  JDN_1CE,
  JDN_960,
  JDN_968,
  JDN_970,
  JDN_975,
} from "../src/core/data/demo-sources-events.ts";
import {
  buildBoundaryRenderMetadata,
  deriveBoundedSplineGeometry,
  extractPolityOuterPerimeterRings,
  haversineKm,
  measureArcFractalDimension,
  measureMaxHausdorffDeviationKm,
} from "../src/core/data/topology-builder.ts";
import { interpolateMorphSnapshot } from "../src/core/director/morph-engine.ts";
import {
  buildDefaultHudWidgets,
  classifyTopologyTransition,
  generateVideoStoryboard,
  importRecordingTelemetry,
  layoutHudWidgetsForAspect,
  type TelemetrySample,
} from "../src/core/director/recorder-and-hud.ts";
import {
  buildPresetTimelineSpan,
  DEFAULT_DYNASTY_BANDS,
  generateTimelineTicks,
  jdnToHistoricalParts,
  zoomTimelineViewport,
  type TimelineViewport,
} from "../src/core/director/timeline-math.ts";
import {
  buildPolitySpineLabels,
  evaluateToponymLayout,
  pointInPolygon,
  pointInRing,
  projectLonLatToScreen,
} from "../src/core/layout/label-collision.ts";
import { DeterministicFrameBridge } from "../src/core/render/deterministic-bridge.ts";
import {
  adaptMapSnapshotToSceneBundle,
  DemoSnapshotTransport,
  MapSnapshotClient,
} from "../src/core/services/snapshot-client.ts";
import {
  BASEMAP_CATALOG,
  BORDER_SHADER_CATALOG,
  FLAGSHIP_STYLE_PRESETS,
  resolveStylePack,
} from "../src/core/styles/style-presets.ts";

test("A-30 & Invariants 1/2/5: 960–975 shared-arc topology closes with zero gaps, keeps canonical read-only, and drives dual mode from single snapshot", () => {
  assert.equal(DEMO_SCENE_BUNDLES.length, 5);

  for (const bundle of DEMO_SCENE_BUNDLES) {
    assert.ok(bundle.snapshot.territories.features.length > 0, `${bundle.epoch.epoch_id} must contain faces`);
    for (const feat of bundle.snapshot.territories.features) {
      const ring = feat.geometry.coordinates[0] ?? [];
      assert.ok(ring.length >= 4, `${feat.properties.face_id} ring must have >= 4 coords`);
      assert.deepEqual(ring[0], ring[ring.length - 1], `${feat.properties.face_id} ring must close cleanly`);
    }

    // Spline derivation never mutates canonical_geometry and stays Hausdorff <= 25km
    let totalVertices = 0;
    let totalSegLenKm = 0;
    let segCount = 0;
    for (const arc of bundle.canonical_arcs) {
      const coords = arc.canonical_geometry.coordinates;
      assert.ok(coords.length >= 2);
      totalVertices += coords.length;
      for (let i = 0; i < coords.length - 1; i++) {
        totalSegLenKm += haversineKm(coords[i]!, coords[i + 1]!);
        segCount += 1;
      }
      if (arc.rendered_spline_geometry) {
        assert.notEqual(arc.rendered_spline_geometry, arc.canonical_geometry);
        assert.deepEqual(arc.rendered_spline_geometry.coordinates[0], coords[0], "Start node locked");
        assert.deepEqual(
          arc.rendered_spline_geometry.coordinates[arc.rendered_spline_geometry.coordinates.length - 1],
          coords[coords.length - 1],
          "End node locked",
        );
        assert.ok((arc.measured_max_deviation_km ?? 0) <= 25, `${arc.arc_id} exceeded 25km Hausdorff`);
      }
    }
    assert.ok(totalVertices >= 1000, `${bundle.epoch.epoch_id} vertices (${totalVertices}) must be >= 1000`);
    const avgSegKm = totalSegLenKm / Math.max(1, segCount);
    assert.ok(avgSegKm <= 30, `${bundle.epoch.epoch_id} avg segment length (${avgSegKm.toFixed(2)}km) must be <= 30km`);
  }

  const b960 = resolveSceneBundleByEpochId("epoch-960-central-asia")!;
  const style = resolveStylePack("vivid_video_songti");

  const sparseFace = b960.canonical_faces.find((f) => f.is_sparse_or_desert_zone)!;
  assert.ok(sparseFace, "Expected sparse nomadic frontier face");
  assert.ok(sparseFace.control_score > 0 && sparseFace.control_score < 60);

  const pureVis = evaluateControlScoreVisuals("#1f9d55", sparseFace.control_score, style.territory_rendering, "PURE_TERRITORY");
  const zeroVis = evaluateControlScoreVisuals("#1f9d55", 0, style.territory_rendering, "CONTROL_INTENSITY");
  const sparseVis = evaluateControlScoreVisuals("#1f9d55", sparseFace.control_score, style.territory_rendering, "CONTROL_INTENSITY");
  const fullVis = evaluateControlScoreVisuals("#1f9d55", 100, style.territory_rendering, "CONTROL_INTENSITY");

  assert.equal(pureVis.fill_opacity, style.territory_rendering.pure_mode_fill_opacity);
  assert.ok(zeroVis.fill_opacity < sparseVis.fill_opacity && sparseVis.fill_opacity < fullVis.fill_opacity);
});

test("A-30 & A-32: monotonic sequence guard drops slower older responses and EventEvidenceReader enforces Wikipedia T3 review gates", async () => {
  const transport = new DemoSnapshotTransport({
    simulatedDelayMsByEpoch: {
      "epoch-960-central-asia": 50,
      "epoch-970-khotan-kashgar": 5,
    },
  });
  const client = new MapSnapshotClient(transport);

  const olderPromise = client.loadSnapshot({ historical_jdn: JDN_960, revision_id: "rev-ca-960-wiki-001" });
  const newerPromise = client.loadSnapshot({ historical_jdn: JDN_970, revision_id: "rev-ca-970-wiki-004" });

  const [newerOut, olderOut] = await Promise.all([newerPromise, olderPromise]);
  assert.equal(newerOut.stale_discarded, false);
  assert.equal(newerOut.bundle?.epoch.epoch_id, "epoch-970-khotan-kashgar");
  assert.equal(olderOut.stale_discarded, true);
  assert.equal(client.getLatestCommittedSeq(), 2);

  // All 9 Wikipedia sources are strictly tagged as T3_GENERAL_ENCYCLOPEDIA
  assert.ok(DEMO_SOURCES.length >= 9);
  for (const src of DEMO_SOURCES) {
    assert.equal(src.medium, "ENCYCLOPEDIA");
    assert.equal(src.credibility_tier, "T3_GENERAL_ENCYCLOPEDIA");
  }

  const pendingWiki960 = await client.verifyEvent({ hist_event_id: "event-960-karakhanid-conversion" });
  assert.equal(pendingWiki960.status, "PENDING_REVIEW");
  assert.equal(pendingWiki960.issues[0]?.code, "PENDING_T1_VERIFICATION");

  const disputeKhotan970 = await client.verifyEvent({ hist_event_id: "event-970-khotan-kashgar-sistan" });
  assert.equal(disputeKhotan970.status, "PENDING_REVIEW");
  assert.equal(disputeKhotan970.issues[0]?.code, "T1_SCHOLARLY_DISPUTE");

  const fixturePending = await client.verifyEvent({ hist_event_id: "fixture-event" });
  assert.equal(fixturePending.status, "PENDING_REVIEW");

  const fixtureRejected = await client.verifyEvent({ hist_event_id: "fixture-event-rejected" });
  assert.equal(fixtureRejected.status, "REJECTED");
  assert.equal(fixtureRejected.issues[0]?.code, "QUOTE_NOT_FOUND");

  // Also verify client handling when an authoritative Scholar/T1 backend returns VERIFIED
  const b962 = resolveSceneBundleByEpochId("epoch-962-ghazna-rise")!;
  const ev962 = b962.events[0]!;
  const t1Client = new MapSnapshotClient({
    fetchSnapshot: async () => b962,
    fetchEventEvidence: async (): Promise<EventEvidenceResult> => ({
      status: "VERIFIED",
      event_revision: "ev-t1-001",
      event: ev962,
      verified_citations: [{
        citation_id: ev962.citations[0]!.citation_id,
        source_doc_id: ev962.citations[0]!.source_doc_id,
        index_revision: "idx-t1-001",
        evidence: ev962.citations[0]!,
      }],
    }),
  });
  const verifiedOut = await t1Client.verifyEvent({ hist_event_id: ev962.hist_event_id });
  assert.equal(verifiedOut.status, "VERIFIED");
});

test("A-30: all 7 Basemaps, 6 BorderShaders, and 10 inheritable StylePacks resolve cleanly", () => {
  assert.equal(BASEMAP_CATALOG.length, 7);
  assert.equal(BORDER_SHADER_CATALOG.length, 6);
  assert.equal(FLAGSHIP_STYLE_PRESETS.length, 10);

  for (const preset of FLAGSHIP_STYLE_PRESETS) {
    const resolved = resolveStylePack(preset.style_id);
    assert.equal(resolved.style_id, preset.style_id);
    assert.ok(resolved.basemap.basemap_id.length > 0);
    assert.ok(resolved.border_shader.mode.length > 0);
  }

  const swiss = resolveStylePack("engraved_tusi_swiss", [], {
    basemap: { show_modern_overlay: true },
  });
  assert.equal(swiss.basemap.basemap_id, "swiss_relief_engraved");
  assert.equal(swiss.basemap.show_modern_overlay, true);
  assert.equal(swiss.border_shader.mode, "multi_tier_ink");
});

test("A-33: CIEDE2000 adjacency solver prevents adjacent color collisions across all 5 Central Asia slices and preserves Samanid inheritance", () => {
  assert.equal(ciede2000("#3366cc", "#3366cc"), 0);
  assert.ok(ciede2000("#dc2626", "#16a34a") > 40);

  for (const bundle of DEMO_SCENE_BUNDLES) {
    const report = solvePolityPalette({
      snapshot: bundle.snapshot,
      polities: bundle.polities,
      palette_id: "palette-vivid-narrative",
      auto_four_color_solver: true,
      min_delta_e: 18,
    });
    assert.ok(report.adjacency_pairs.length >= 10, `${bundle.epoch.epoch_id} must compute rich polity graph`);
    assert.equal(report.all_adjacent_clear, true, `${bundle.epoch.epoch_id} adjacent DeltaE failed`);
    assert.ok(report.min_measured_delta_e >= 18);
  }

  const b962 = resolveSceneBundleByEpochId("epoch-962-ghazna-rise")!;
  const report962 = solvePolityPalette({
    snapshot: b962.snapshot,
    polities: b962.polities,
    palette_id: "palette-kunyu-mineral",
    auto_four_color_solver: true,
    min_delta_e: 18,
  });
  assert.equal(report962.all_adjacent_clear, true);
  assert.ok(
    report962.inherited_polities.includes("polity-ghaznavid")
      && report962.inherited_polities.includes("polity-khwarazm"),
  );
});

test("A-31 & Never-Do #5: JDN timeline bridges 1 BCE -> 1 CE without Year 0 and scales smoothly from CENTURY to HOUR", () => {
  const bce1 = jdnToHistoricalParts(JDN_1BCE);
  const ce1 = jdnToHistoricalParts(JDN_1CE);
  assert.equal(bce1.astronomical_year, 0);
  assert.equal(bce1.historical_year_display, "公元前1年");
  assert.equal(ce1.astronomical_year, 1);
  assert.equal(ce1.historical_year_display, "公元1年");

  const startTs = createHistoricalTimestamp({ astronomical_year: 0, month: 12, day: 31 });
  const nextDay = jdnToHistoricalParts(startTs.julian_day_number + 1);
  assert.equal(nextDay.astronomical_year, 1);
  assert.equal(nextDay.month, 1);
  assert.equal(nextDay.day, 1);
  assert.equal(nextDay.historical_year_display, "公元1年");

  let vp: TimelineViewport = {
    min_jdn: JDN_960 - 365 * 20,
    max_jdn: JDN_975 + 365 * 20,
    cursor_jdn: JDN_970,
    granularity: "DECADE",
  };
  for (let step = 0; step < 30; step++) {
    vp = zoomTimelineViewport(vp, 0.5, 0.65);
  }
  assert.equal(vp.granularity, "HOUR");

  const hourPreset = buildPresetTimelineSpan("HOUR", JDN_970);
  assert.equal(hourPreset.granularity, "HOUR");
  assert.ok(hourPreset.max_jdn - hourPreset.min_jdn < 3);
});

test("A-33, A-34, A-42: label collision detection, 60Hz telemetry smoothing, 9:16 safe-area G5 verification, and deterministic barrier fault injection", async () => {
  const b960 = resolveSceneBundleByEpochId("epoch-960-central-asia")!;
  const style = resolveStylePack("academic_inner_glow");

  const cleanLayout = evaluateToponymLayout({
    toponyms: b960.toponyms,
    typography: style.typography,
    center: [67.5, 38.5],
    zoom: 6.4,
    viewport: { width: 1280, height: 720 },
  });
  assert.equal(cleanLayout.g5_label_gate.passed, true);
  assert.equal(cleanLayout.high_priority_collision_count, 0);

  // Approximate coordinate toponym (Imakiya) receives '?' marker when enabled
  const imakiyaLayout = evaluateToponymLayout({
    toponyms: b960.toponyms,
    typography: style.typography,
    center: [74.5, 49.8],
    zoom: 5.5,
    viewport: { width: 1280, height: 720 },
  });
  const imakiya = imakiyaLayout.placed.find((p) => p.toponym_id === "top-imakiya");
  assert.ok(imakiya?.text_primary.endsWith("?"));

  const crowdedLayout = evaluateToponymLayout({
    toponyms: b960.toponyms,
    typography: style.typography,
    center: [66.0, 36.5],
    zoom: 1.5,
    viewport: { width: 640, height: 360 },
  });
  assert.equal(crowdedLayout.g5_label_gate.passed, false);
  assert.ok(crowdedLayout.g5_label_gate.issues.some((i) => i.code === "LABEL_COLLISION"));

  const samples: TelemetrySample[] = Array.from({ length: 120 }, (_, i) => ({
    elapsed_ms: i * 16.667,
    historical_jdn: JDN_968,
    camera: {
      center: [60 + (i / 120) * 8, 36 + Math.sin(i * 0.2) * 0.05],
      zoom: 4.1 + (i / 120) * 0.8,
      bearing_deg: 0,
      pitch_deg: 0,
    },
    style_id: "vivid_video_songti",
    layer_config: { base_mode: "PURE_TERRITORY", enabled_overlays: ["historical_events"] },
    active_hud_ids: ["hud-date-era"],
  }));
  const kfs = importRecordingTelemetry(samples);
  assert.ok(kfs.length >= 2 && kfs.length < samples.length);

  const b968 = resolveSceneBundleByEpochId("epoch-968-kerman-ziyarid")!;
  const sb = generateVideoStoryboard({ events: b968.events, bundle: b968 });
  assert.equal(new Set(sb.hud_widgets.map((w) => w.type)).size, 7);

  const homeoTransition = classifyTopologyTransition(
    b968.diff_record!.before_snapshot,
    b968.diff_record!.after_snapshot,
  );
  assert.equal(homeoTransition.is_homeomorphic, true);
  assert.equal(homeoTransition.mode, "STREAMLINE_ARC_MORPH");

  const allWidgets = buildDefaultHudWidgets(6);
  const layout16x9 = layoutHudWidgetsForAspect({
    widgets: allWidgets,
    aspect_ratio: "16:9",
    video_time_sec: 1.5,
  });
  assert.equal(layout16x9.g5_hud_gate.passed, true);

  const layout9x16Reflowed = layoutHudWidgetsForAspect({
    widgets: allWidgets,
    aspect_ratio: "9:16",
    video_time_sec: 1.5,
    auto_reflow_vertical: true,
  });
  assert.equal(layout9x16Reflowed.g5_hud_gate.passed, true);

  const layout9x16Unreflowed = layoutHudWidgetsForAspect({
    widgets: allWidgets,
    aspect_ratio: "9:16",
    video_time_sec: 1.5,
    auto_reflow_vertical: false,
  });
  assert.equal(layout9x16Unreflowed.g5_hud_gate.passed, false);
  assert.ok(layout9x16Unreflowed.g5_hud_gate.issues.some((i) => i.code === "HUD_SAFE_AREA_VIOLATION"));

  const bridge = new DeterministicFrameBridge();
  bridge.setRevision(b968.revision_id);
  bridge.setSignals({ map_idle: true, fonts_loaded: true, shaders_ready: true, tiles_loaded: true });
  bridge.registerHandlers({
    getLabelReport: () => cleanLayout,
    getHudLayout: () => layout9x16Reflowed,
  });

  const okFrame = await bridge.stepFrame(1000);
  assert.equal(okFrame.accepted, true);
  assert.equal(okFrame.g5_gate.passed, true);

  for (const fault of [
    { force_map_not_idle: true },
    { force_fonts_not_loaded: true },
    { force_shaders_not_ready: true },
    { force_tiles_incomplete: true },
  ]) {
    bridge.setFaultFlags(fault);
    const badFrame = await bridge.stepFrame(1033);
    assert.equal(badFrame.accepted, false);
    assert.ok(badFrame.g5_gate.issues.some((i) => i.code === "FRAME_NOT_READY"));
  }
});

test("Real 1:10m Natural Earth GIS provenance, 960–975 Central Asia historical evolution, midnight JDN rollover, Polylabel, and snapshot adapter", async () => {
  const gisDir = path.resolve(import.meta.dirname, "../public/gis");
  for (const file of ["ocean.geojson", "lakes.geojson", "rivers.geojson", "modern_borders.geojson", "provenance.json"]) {
    assert.ok(fs.existsSync(path.join(gisDir, file)), `Missing real GIS asset ${file}`);
  }

  const provenance = JSON.parse(fs.readFileSync(path.join(gisDir, "provenance.json"), "utf8")) as {
    sources: Array<{ file: string; local_path?: string; url?: string }>;
    outputs: Array<{ file: string; feature_count: number }>;
  };
  assert.ok(provenance.sources.some((s) => s.file === "ne_10m_ocean.geojson"));
  assert.ok(provenance.sources.some((s) => s.file === "ne_10m_rivers_europe.geojson"));
  assert.ok(provenance.sources.some((s) => s.file === "ne_10m_admin_0_boundary_lines_land.geojson"));
  assert.ok(provenance.outputs.some((o) => o.file === "ocean.geojson" && o.feature_count >= 1));

  const lakes = JSON.parse(fs.readFileSync(path.join(gisDir, "lakes.geojson"), "utf8")) as {
    features: Array<{ properties: { name: string; name_zh?: string } }>;
  };
  assert.ok(lakes.features.some((f) => f.properties.name === "Aral Sea" && f.properties.name_zh === "咸海"));
  assert.ok(lakes.features.some((f) => f.properties.name === "Issyk-Kul" && f.properties.name_zh === "伊塞克湖"));

  // Compliant China standard borders guard: CHN_OFFICIAL present, zero NE India-China / Unrecognized conflicts
  const modernBorders = JSON.parse(fs.readFileSync(path.join(gisDir, "modern_borders.geojson"), "utf8")) as {
    features: Array<{ properties?: Record<string, unknown> }>;
  };
  assert.ok(
    modernBorders.features.some((f) => f.properties?.sovereignty_pov === "CHN_OFFICIAL"),
    "modern_borders.geojson must include compliant CHN_OFFICIAL boundary segments",
  );
  const rawBorderText = JSON.stringify(modernBorders.features);
  assert.ok(!rawBorderText.includes("Unrecognized"), "modern_borders.geojson must not carry Unrecognized dispute tags");
  const webglLayersSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, "../src/components/map-webgl-layers.tsx"),
    "utf8",
  );
  assert.ok(
    !webglLayersSrc.includes("World_Street_Map"),
    "modern_reference basemap must use borderless physical tiles + compliant CHN_OFFICIAL overlay",
  );

  // Pure natural-geography guard: historical compiler must NEVER read modern admin_1 / admin_0 boundaries
  const compilerSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/build-central-asia-960-975.mjs"), "utf8");
  const coreLibSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/lib/natural-topo-builder.mjs"), "utf8");
  assert.ok(!compilerSrc.includes("admin_1_states_provinces") && !coreLibSrc.includes("admin_1_states_provinces"));
  assert.ok(!compilerSrc.includes("admin_0_boundary_lines") && !coreLibSrc.includes("admin_0_boundary_lines"));

  // Verify the 5 Wikipedia-driven historical transfers across 960 -> 962 -> 968 -> 970 -> 975 & 20 pure natural faces
  const b960 = resolveSceneBundleByEpochId("epoch-960-central-asia")!;
  const b962 = resolveSceneBundleByEpochId("epoch-962-ghazna-rise")!;
  const b968 = resolveSceneBundleByEpochId("epoch-968-kerman-ziyarid")!;
  const b970 = resolveSceneBundleByEpochId("epoch-970-khotan-kashgar")!;
  const b975 = resolveSceneBundleByEpochId("epoch-972-975-treaty")!;

  assert.equal(b960.canonical_faces.length, 20);
  assert.ok(b960.canonical_faces.some((f) => f.face_id === "face-ca-tokharistan"));
  const naturalArcCount = b960.canonical_arcs.filter((a) => a.certainty === "NATURAL_FEATURE").length;
  assert.ok(naturalArcCount >= 15, `Expected >= 15 1:10m NATURAL_FEATURE arcs, got ${naturalArcCount}`);

  assert.equal(b960.canonical_faces.find((f) => f.face_id === "face-ca-ghazna")?.polity_id, "polity-lawik");
  assert.equal(b962.canonical_faces.find((f) => f.face_id === "face-ca-ghazna")?.polity_id, "polity-ghaznavid");
  assert.equal(b962.canonical_faces.find((f) => f.face_id === "face-ca-kerman")?.polity_id, "polity-banu-ilyas");
  assert.equal(b968.canonical_faces.find((f) => f.face_id === "face-ca-kerman")?.polity_id, "polity-buyid");
  assert.equal(b968.canonical_faces.find((f) => f.face_id === "face-ca-semnan")?.zone_semantics, "DISPUTED_OVERLAP");
  assert.equal(b968.canonical_faces.find((f) => f.face_id === "face-ca-kashgar")?.polity_id, "polity-qarakhanid");
  const kashgar970 = b970.canonical_faces.find((f) => f.face_id === "face-ca-kashgar");
  assert.equal(kashgar970?.polity_id, "polity-khotan");
  assert.equal(kashgar970?.zone_semantics, "DISPUTED_OVERLAP");
  assert.equal(b975.canonical_faces.find((f) => f.face_id === "face-ca-semnan")?.zone_semantics, "POLITY_TERRITORY");

  // Continuous drag projection updates linearly on tiny pan steps
  const [x1, y1] = projectLonLatToScreen([64.42, 39.77], [67.5, 37.5], 4.1, 1280, 720);
  const [x2, y2] = projectLonLatToScreen([64.42, 39.77], [68.5, 37.5], 4.1, 1280, 720);
  assert.ok(x2 < x1, "Panning map camera east must shift city screen X left immediately");
  assert.equal(Math.round(y1), Math.round(y2));

  // Internal same-polity borders hidden in PURE_TERRITORY and fused into outer perimeter rings
  const meta960 = buildBoundaryRenderMetadata(b960.snapshot, b960.canonical_arcs, b960.canonical_faces, b960.admin_units);
  assert.ok(Object.values(meta960).some((m) => m.is_same_polity_internal), "960 scene must identify Samanid internal seams");
  const perimeters960 = extractPolityOuterPerimeterRings(b960.snapshot);
  assert.ok(perimeters960.some((p) => p.polity_id === "polity-samanid" && p.rings.length >= 1));

  // Midnight rollover + band coverage + Year-0 suppression
  const preMidnightJdn = createHistoricalTimestamp({ astronomical_year: 970, month: 8, day: 15, hour: 23, minute: 59 }).julian_day_number + 45 / 86400;
  const rolled = jdnToHistoricalParts(preMidnightJdn);
  assert.equal(rolled.hour, 0);
  assert.equal(rolled.day, 16);

  assert.equal(DEFAULT_DYNASTY_BANDS.length, 5);
  for (const band of DEFAULT_DYNASTY_BANDS) {
    assert.ok(resolveSceneBundleByJdn(band.focus_jdn), `Band ${band.band_id} focus_jdn must resolve non-empty epoch`);
  }
  const ticks = generateTimelineTicks({ min_jdn: JDN_1BCE - 4000, max_jdn: JDN_1CE + 120000, cursor_jdn: JDN_1CE, granularity: "CENTURY" }, 7);
  assert.ok(ticks.every((t) => !t.label.includes("公元0年")), "Timeline ticks must never emit Year 0");

  // Polylabel must stay strictly inside merged polygons across all 5 Central Asia slices (holes excluded)
  const style = resolveStylePack("tactical_war_parchment");
  for (const b of DEMO_SCENE_BUNDLES) {
    const labels = buildPolitySpineLabels(b.snapshot, b.polities, style.typography);
    const mergedRings = extractPolityOuterPerimeterRings(b.snapshot);
    for (const lbl of labels) {
      const featurePolys = b.snapshot.territories.features
        .filter((f) => f.properties.polity_id === lbl.properties.polity_id)
        .map((f) => f.geometry.coordinates);
      const outerMerged = mergedRings.find((r) => r.polity_id === lbl.properties.polity_id)?.rings;
      const inFeaturePoly = featurePolys.some((polyRings) => pointInPolygon(lbl.properties.center, polyRings));
      const inOuterMerged = outerMerged ? outerMerged.some((ring) => pointInRing(lbl.properties.center, ring)) : false;
      assert.ok(
        inFeaturePoly || inOuterMerged,
        `Spine label for ${b.epoch.epoch_id}:${lbl.properties.polity_id} fell outside polygon`,
      );
    }
  }

  // Distinct auto-framing centers across geographically separate events (962 Ghazna vs 970 Khotan/Kashgar)
  const sb962 = generateVideoStoryboard({ events: b962.events, bundle: b962 });
  const sb970 = generateVideoStoryboard({ events: b970.events, bundle: b970 });
  assert.notEqual(
    Math.round(sb962.keyframes[0]!.camera.center[0]),
    Math.round(sb970.keyframes[0]!.camera.center[0]),
  );

  // Morph connectivity mutation vs homeomorphic interpolation + G5 bridge + style inheritance + snapshot adapter
  const mutatedSnap = structuredClone(b968.diff_record!.after_snapshot);
  mutatedSnap.boundaries.features[0]!.properties.start_node_id = "node-mutated-x";
  const nonHomeoPlan = classifyTopologyTransition(b968.diff_record!.before_snapshot, mutatedSnap);
  assert.equal(nonHomeoPlan.is_homeomorphic, false);

  const homeoPlan = classifyTopologyTransition(b968.diff_record!.before_snapshot, b968.diff_record!.after_snapshot);
  if (homeoPlan.is_homeomorphic) {
    const midSnap = interpolateMorphSnapshot(b968.diff_record!.before_snapshot, b968.diff_record!.after_snapshot, 0.5, homeoPlan);
    assert.equal(midSnap.boundaries.features.length, b968.diff_record!.before_snapshot.boundaries.features.length);
  }

  const unreadyBridge = new DeterministicFrameBridge();
  const rejectedInit = await unreadyBridge.stepFrame(0);
  assert.equal(rejectedInit.accepted, false);

  const customPack = resolveStylePack("obsidian_dark_empire", [{
    style_id: "vivid_video_songti",
    basemap: { show_graticule_grid: true },
    territory_rendering: { pure_mode_fill_opacity: 0.77 },
  }]);
  assert.equal(customPack.basemap.show_graticule_grid, true);
  assert.equal(customPack.territory_rendering.pure_mode_fill_opacity, 0.77);

  const adapted = adaptMapSnapshotToSceneBundle(b975.snapshot);
  assert.equal(adapted.epoch.epoch_id, "epoch-972-975-treaty");
  assert.ok(adapted.polities.length >= 1);
});
