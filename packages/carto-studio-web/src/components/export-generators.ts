import type {
  ComposableStylePack,
  DirectorKeyframe,
  MapSnapshot,
} from "@historical-cartography/shared-schema";
import type { EpochSceneBundle } from "../core/data/demo-types.ts";
import type { HudWidgetSpec } from "../core/director/recorder-and-hud.ts";

export function downloadTextOrDataUrl(filename: string, contentOrUrl: string, mimeType?: string): void {
  if (typeof document === "undefined") return;
  let href = contentOrUrl;
  let revoke = false;
  if (mimeType && !contentOrUrl.startsWith("data:")) {
    const blob = new Blob([contentOrUrl], { type: mimeType });
    href = URL.createObjectURL(blob);
    revoke = true;
  }
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revoke) {
    setTimeout(() => URL.revokeObjectURL(href), 1500);
  }
}

function formatSrtTimestamp(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, d = 2) => String(n).padStart(d, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function generateSrtSubtitles(
  hudWidgets: readonly HudWidgetSpec[],
  bundle: EpochSceneBundle,
): string {
  const subs = hudWidgets
    .filter((w) => w.type === "SUBTITLE_BAR")
    .sort((a, b) => a.visible_from_sec - b.visible_from_sec);
  if (subs.length === 0) {
    return `1\n00:00:00,000 --> 00:00:04,000\n${bundle.subtitle_default ?? bundle.epoch_label_zh}\n`;
  }
  return subs
    .map((w, idx) => {
      const text = (w.data_binding.text as string | undefined) ?? bundle.subtitle_default ?? bundle.epoch_label_zh;
      return `${idx + 1}\n${formatSrtTimestamp(w.visible_from_sec)} --> ${formatSrtTimestamp(w.visible_to_sec)}\n${text}\n`;
    })
    .join("\n");
}

export function generateVideoChaptersTxt(
  keyframes: readonly DirectorKeyframe[],
  bundle: EpochSceneBundle,
): string {
  return [...keyframes]
    .sort((a, b) => a.video_time_sec - b.video_time_sec)
    .map((kf, idx) => {
      const m = Math.floor(kf.video_time_sec / 60);
      const s = Math.floor(kf.video_time_sec % 60);
      const ts = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      const matchedEvent = bundle.events[idx];
      return `${ts} ${matchedEvent ? matchedEvent.title : `${bundle.epoch_label_zh} 关键帧 ${idx + 1}`}`;
    })
    .join("\n");
}

export function generateT1BibliographyMarkdown(bundle: EpochSceneBundle): string {
  const lines: string[] = [
    `# ${bundle.epoch_label_zh} (${bundle.historical_year_display}) 学术参考文献与致谢`,
    "",
    `> 修订快照: \`${bundle.revision_id}\` | 状态: \`${bundle.data_status}\``,
    "",
    "## 一、主要史料与学术文献 (T1/T2 Sources)",
  ];
  for (const doc of bundle.sources) {
    const authors = doc.authors.join(", ");
    const year = doc.publication_year ? ` (${doc.publication_year})` : "";
    lines.push(`- **[${doc.credibility_tier}]** ${doc.title}${year} — ${authors} [${doc.medium}]`);
    if (doc.archive_snapshot_url || doc.source_url) {
      lines.push(`  - 原件链接: ${doc.archive_snapshot_url ?? doc.source_url}`);
    }
  }
  lines.push("", "## 二、核心考证引文 (Verified Citations)");
  for (const cit of Object.values(bundle.citations_by_id)) {
    lines.push(`- \`${cit.citation_id}\` (${cit.volume_or_chapter ?? ""} ${cit.page_number ?? ""}): “${cit.verbatim_quote}”`);
  }
  return lines.join("\n");
}

export function generateStandaloneSvgExport(
  bundle: EpochSceneBundle,
  snapshot: MapSnapshot,
  stylePack: ComposableStylePack,
  polityColors: Record<string, string>,
): string {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const feat of snapshot.territories.features) {
    for (const pt of feat.geometry.coordinates[0] ?? []) {
      const lon = pt[0] ?? 0;
      const lat = pt[1] ?? 0;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLon)) {
    minLon = 40;
    maxLon = 135;
    minLat = 15;
    maxLat = 58;
  }
  const padLon = Math.max(4, (maxLon - minLon) * 0.08);
  const padLat = Math.max(3, (maxLat - minLat) * 0.08);
  minLon -= padLon;
  maxLon += padLon;
  minLat -= padLat;
  maxLat += padLat;

  const width = 1600;
  const height = 900;
  const proj = (lon: number, lat: number): [number, number] => [
    ((lon - minLon) / Math.max(1e-4, maxLon - minLon)) * width,
    height - ((lat - minLat) / Math.max(1e-4, maxLat - minLat)) * height,
  ];

  const polysSvg = snapshot.territories.features
    .map((f) => {
      const pid = f.properties.polity_id ?? f.properties.face_id;
      const fill = polityColors[pid] ?? "#2dbd66";
      const pts = (f.geometry.coordinates[0] ?? [])
        .map((p) => proj(p[0] ?? 0, p[1] ?? 0))
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
        .join(" ");
      return `<polygon points="${pts}" fill="${fill}" fill-opacity="${stylePack.territory_rendering.pure_mode_fill_opacity}" />`;
    })
    .join("\n  ");

  const arcsSvg = snapshot.boundaries.features
    .map((b) => {
      const pts = b.geometry.coordinates
        .map((p) => proj(p[0] ?? 0, p[1] ?? 0))
        .map(([x, y], idx) => `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
        .join(" ");
      return `<path d="${pts}" fill="none" stroke="${stylePack.border_shader.outer_stroke_hex}" stroke-width="${stylePack.border_shader.outer_stroke_width_px}" stroke-linejoin="round" />`;
    })
    .join("\n  ");

  const citiesSvg = bundle.toponyms
    .map((t) => {
      const [cx, cy] = proj(t.coordinates[0], t.coordinates[1]);
      return `<g><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="#fff" stroke="#0f172a" stroke-width="1.5" /><text x="${cx.toFixed(1)}" y="${(cy - 8).toFixed(1)}" font-size="13" font-family="sans-serif" fill="#0f172a" text-anchor="middle">${t.name_zh}</text></g>`;
    })
    .join("\n  ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <rect width="100%" height="100%" fill="#e2e8f0" />`,
    `  ${polysSvg}`,
    `  ${arcsSvg}`,
    `  ${citiesSvg}`,
    `  <text x="36" y="48" font-size="28" font-weight="700" font-family="serif" fill="#0f172a">${bundle.epoch_label_zh} · ${bundle.historical_year_display}</text>`,
    `</svg>`,
  ].join("\n");
}
