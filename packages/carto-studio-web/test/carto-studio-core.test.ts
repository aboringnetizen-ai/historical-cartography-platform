import assert from "node:assert/strict";
import test from "node:test";
import { createHistoricalTimestamp } from "@historical-cartography/shared-schema";
import { ciede2000, evaluateControlScoreVisuals, solvePolityPalette } from "../src/core/color/ciede2000.ts";
import { DEMO_SCENE_BUNDLES, resolveSceneBundleByEpochId } from "../src/core/data/demo-dataset.ts";
import { JDN_1BCE, JDN_1CE, JDN_842, JDN_928_AUG } from "../src/core/data/demo-sources-events.ts";
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
  jdnToHistoricalParts,
  zoomTimelineViewport,
  type TimelineViewport,
} from "../src/core/director/timeline-math.ts";
import { evaluateToponymLayout } from "../src/core/layout/label-collision.ts";
import { DeterministicFrameBridge } from "../src/core/render/deterministic-bridge.ts";
import { DemoSnapshotTransport, MapSnapshotClient } from "../src/core/services/snapshot-client.ts";
import {
  BASEMAP_CATALOG,
  BORDER_SHADER_CATALOG,
  FLAGSHIP_STYLE_PRESETS,
  resolveStylePack,
} from "../src/core/styles/style-presets.ts";

test("A-30 & Invariants 1/2/5: shared-arc topology closes with zero gaps, keeps canonical read-only, and drives dual mode from single snapshot", () => {
  assert.ok(DEMO_SCENE_BUNDLES.length >= 4);

  for (const bundle of DEMO_SCENE_BUNDLES) {
    assert.ok(bundle.snapshot.territories.features.length > 0, `${bundle.epoch.epoch_id} must contain faces`);
    for (const feat of bundle.snapshot.territories.features) {
      const ring = feat.geometry.coordinates[0] ?? [];
      assert.ok(ring.length >= 4, `${feat.properties.face_id} ring must have >= 4 coords`);
      assert.deepEqual(ring[0], ring[ring.length - 1], `${feat.properties.face_id} ring must close cleanly`);
    }

    // Spline derivation never mutates canonical_geometry
    for (const arc of bundle.canonical_arcs) {
      assert.ok(arc.canonical_geometry.coordinates.length >= 2);
      if (arc.rendered_spline_geometry) {
        assert.notEqual(arc.rendered_spline_geometry, arc.canonical_geometry);
        assert.deepEqual(
          arc.rendered_spline_geometry.coordinates[0],
          arc.canonical_geometry.coordinates[0],
          "Start node must stay locked",
        );
        assert.deepEqual(
          arc.rendered_spline_geometry.coordinates[arc.rendered_spline_geometry.coordinates.length - 1],
          arc.canonical_geometry.coordinates[arc.canonical_geometry.coordinates.length - 1],
          "End node must stay locked",
        );
      }
    }
  }

  const bundle928 = resolveSceneBundleByEpochId("epoch-928-samanid-ziyarid")!;
  const style = resolveStylePack("vivid_video_songti");

  // Single-snapshot pure vs 0 / boundary / 100 control score visuals
  const desertFace = bundle928.canonical_faces.find((f) => f.is_sparse_or_desert_zone)!;
  assert.equal(desertFace.polity_id, "polity-samanid");
  assert.ok(desertFace.control_score > 0 && desertFace.control_score < 20);

  const pureVis = evaluateControlScoreVisuals("#3ca653", desertFace.control_score, style.territory_rendering, "PURE_TERRITORY");
  const zeroVis = evaluateControlScoreVisuals("#3ca653", 0, style.territory_rendering, "CONTROL_INTENSITY");
  const desertVis = evaluateControlScoreVisuals("#3ca653", desertFace.control_score, style.territory_rendering, "CONTROL_INTENSITY");
  const fullVis = evaluateControlScoreVisuals("#3ca653", 100, style.territory_rendering, "CONTROL_INTENSITY");

  assert.equal(pureVis.fill_opacity, style.territory_rendering.pure_mode_fill_opacity);
  assert.ok(zeroVis.fill_opacity < desertVis.fill_opacity && desertVis.fill_opacity < fullVis.fill_opacity);
});

test("A-30 & A-32: monotonic sequence guard drops slower older responses and EventEvidenceReader returns VERIFIED / PENDING_REVIEW / REJECTED", async () => {
  const transport = new DemoSnapshotTransport({
    simulatedDelayMsByEpoch: {
      "epoch-842-samanid": 50,
      "epoch-928-samanid-ziyarid": 5,
    },
  });
  const client = new MapSnapshotClient(transport);

  const olderPromise = client.loadSnapshot({ historical_jdn: JDN_842, revision_id: "rev-842" });
  const newerPromise = client.loadSnapshot({ historical_jdn: JDN_928_AUG, revision_id: "rev-928" });

  const [newerOut, olderOut] = await Promise.all([newerPromise, olderPromise]);
  assert.equal(newerOut.stale_discarded, false);
  assert.equal(newerOut.bundle?.epoch.epoch_id, "epoch-928-samanid-ziyarid");
  assert.equal(olderOut.stale_discarded, true);
  assert.equal(client.getLatestCommittedSeq(), 2);

  // Evidence checks including Codex's Phase 0 examples
  const verified = await client.verifyEvent({ hist_event_id: "event-928-rayy-campaign" });
  assert.equal(verified.status, "VERIFIED");
  assert.ok(verified.verified_citations.length >= 1);
  assert.ok(verified.verified_citations[0]?.evidence.verbatim_quote.length);

  const pendingT3 = await client.verifyEvent({ hist_event_id: "event-928-talas-t3-clue" });
  assert.equal(pendingT3.status, "PENDING_REVIEW");
  assert.equal(pendingT3.issues[0]?.code, "PENDING_T1_VERIFICATION");

  const dispute = await client.verifyEvent({ hist_event_id: "event-928-rayy-suzerainty-dispute" });
  assert.equal(dispute.status, "PENDING_REVIEW");
  assert.equal(dispute.issues[0]?.code, "T1_SCHOLARLY_DISPUTE");

  const fixturePending = await client.verifyEvent({ hist_event_id: "fixture-event" });
  assert.equal(fixturePending.status, "PENDING_REVIEW");

  const fixtureRejected = await client.verifyEvent({ hist_event_id: "fixture-event-rejected" });
  assert.equal(fixtureRejected.status, "REJECTED");
  assert.equal(fixtureRejected.issues[0]?.code, "QUOTE_NOT_FOUND");
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

  // Multi-level inheritance: engraved_tusi_swiss -> atlas_chronicle -> academic_inner_glow -> kunyufu_parchment -> vivid_video_songti
  const swiss = resolveStylePack("engraved_tusi_swiss", [], {
    basemap: { show_modern_overlay: true },
  });
  assert.equal(swiss.basemap.basemap_id, "swiss_relief_engraved");
  assert.equal(swiss.basemap.show_modern_overlay, true);
  assert.equal(swiss.border_shader.mode, "multi_tier_ink");
});

test("A-33: CIEDE2000 adjacency solver prevents adjacent color collisions and preserves parent color inheritance", () => {
  assert.equal(ciede2000("#3366cc", "#3366cc"), 0);
  assert.ok(ciede2000("#dc2626", "#16a34a") > 40);

  const bundle928 = resolveSceneBundleByEpochId("epoch-928-samanid-ziyarid")!;
  const report928 = solvePolityPalette({
    snapshot: bundle928.snapshot,
    polities: bundle928.polities,
    palette_id: "palette-vivid-narrative",
    auto_four_color_solver: true,
    min_delta_e: 18,
  });
  assert.ok(report928.adjacency_pairs.length >= 3);
  assert.equal(report928.all_adjacent_clear, true);
  assert.ok(report928.min_measured_delta_e >= 18);

  const bundle842 = resolveSceneBundleByEpochId("epoch-842-samanid")!;
  const report842 = solvePolityPalette({
    snapshot: bundle842.snapshot,
    polities: bundle842.polities,
    palette_id: "palette-kunyu-mineral",
    auto_four_color_solver: true,
    min_delta_e: 18,
  });
  assert.equal(report842.all_adjacent_clear, true);
  assert.ok(
    report842.inherited_polities.includes("polity-tahirid")
      || report842.inherited_polities.includes("polity-khwarazm"),
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
    min_jdn: JDN_1BCE - 365 * 200,
    max_jdn: JDN_928_AUG + 365 * 200,
    cursor_jdn: JDN_928_AUG,
    granularity: "CENTURY",
  };
  for (let step = 0; step < 30; step++) {
    vp = zoomTimelineViewport(vp, 0.5, 0.65);
  }
  assert.equal(vp.granularity, "HOUR");

  const hourPreset = buildPresetTimelineSpan("HOUR", JDN_928_AUG);
  assert.equal(hourPreset.granularity, "HOUR");
  assert.ok(hourPreset.max_jdn - hourPreset.min_jdn < 3);
});

test("A-33, A-34, A-42: label collision detection, 60Hz telemetry smoothing, 9:16 safe-area G5 verification, and deterministic barrier fault injection", async () => {
  const bundle928 = resolveSceneBundleByEpochId("epoch-928-samanid-ziyarid")!;
  const style = resolveStylePack("academic_inner_glow");

  // Zoomed-in high-priority labels should not collide
  const cleanLayout = evaluateToponymLayout({
    toponyms: bundle928.toponyms,
    typography: style.typography,
    center: [64.4, 39.7],
    zoom: 6.8,
    viewport: { width: 1280, height: 720 },
  });
  assert.equal(cleanLayout.g5_label_gate.passed, true);
  assert.equal(cleanLayout.high_priority_collision_count, 0);

  // Uncertain toponym receives '?' marker when enabled
  const ribat = cleanLayout.placed.find((p) => p.toponym_id === "top-darband-ribat");
  assert.ok(ribat?.text_primary.endsWith("?"));

  // Extreme zoom-out crowds high-priority cities (>=80) and triggers G5 LABEL_COLLISION
  const crowdedLayout = evaluateToponymLayout({
    toponyms: bundle928.toponyms,
    typography: style.typography,
    center: [62.0, 38.0],
    zoom: 1.5,
    viewport: { width: 640, height: 360 },
  });
  assert.equal(crowdedLayout.g5_label_gate.passed, false);
  assert.ok(crowdedLayout.g5_label_gate.issues.some((i) => i.code === "LABEL_COLLISION"));

  // 60Hz telemetry capture -> smoothed DirectorKeyframe[]
  const samples: TelemetrySample[] = Array.from({ length: 120 }, (_, i) => ({
    elapsed_ms: i * 16.667,
    historical_jdn: JDN_928_AUG,
    camera: {
      center: [56 + (i / 120) * 8, 36 + Math.sin(i * 0.2) * 0.05],
      zoom: 4.5 + (i / 120) * 0.8,
      bearing_deg: 0,
      pitch_deg: 0,
    },
    style_id: "vivid_video_songti",
    layer_config: { base_mode: "PURE_TERRITORY", enabled_overlays: ["historical_events"] },
    active_hud_ids: ["hud-date-era"],
  }));
  const kfs = importRecordingTelemetry(samples);
  assert.ok(kfs.length >= 2 && kfs.length < samples.length);

  // Storyboard covers all 7 HUD widget types & two-stage topology classifier
  const sb = generateVideoStoryboard({ events: bundle928.events });
  assert.equal(new Set(sb.hud_widgets.map((w) => w.type)).size, 7);

  const bundle842 = resolveSceneBundleByEpochId("epoch-842-samanid")!;
  const crossEpochTransition = classifyTopologyTransition(bundle842.snapshot, bundle928.snapshot);
  assert.equal(crossEpochTransition.is_homeomorphic, false);
  assert.equal(crossEpochTransition.mode, "OCCUPATION_RIPPLE");

  const homeoTransition = classifyTopologyTransition(
    bundle928.diff_record!.before_snapshot,
    bundle928.diff_record!.after_snapshot,
  );
  assert.equal(homeoTransition.is_homeomorphic, true);
  assert.equal(homeoTransition.mode, "STREAMLINE_ARC_MORPH");

  // HUD 16:9 & 9:16 reflow passes G5; disabling 9:16 reflow triggers HUD_SAFE_AREA_VIOLATION
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

  // DeterministicFrameBridge & A-42 fault injection
  const bridge = new DeterministicFrameBridge();
  bridge.setRevision(bundle928.revision_id);
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
