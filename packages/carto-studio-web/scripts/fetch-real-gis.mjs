import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../public/gis");
const RAW_DIR = path.resolve(__dirname, "../data/raw-gis");
const HIST_DIR = path.resolve(RAW_DIR, "historical-basemaps");
const NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const HB_BASE = "https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson";

const FORCE_DOWNLOAD = process.argv.includes("--force");

const LAKE_NAME_ZH = new Map([
  ["Caspian Sea", "里海"],
  ["Aral Sea", "咸海"],
  ["North Aral Sea", "北咸海"],
  ["South Aral Sea", "南咸海"],
  ["Lake Balkhash", "巴尔喀什湖"],
  ["Ozero Balkhash", "巴尔喀什湖"],
  ["Issyk-Kul", "伊塞克湖"],
  ["Ozero Issyk-Kul", "伊塞克湖"],
  ["Lake Issyk-Kul", "伊塞克湖"],
  ["Lake Urmia", "乌尔米耶湖"],
  ["Daryacheh-ye Orumiyeh", "乌尔米耶湖"],
  ["Lake Van", "凡湖"],
  ["Qinghai Lake", "青海湖"],
  ["Lake Baikal", "贝加尔湖"],
  ["Ozero Baykal", "贝加尔湖"],
  ["Lop Nur", "罗布泊"],
  ["Bosten Lake", "博斯腾湖"],
  ["IJsselmeer", "艾瑟尔湖"],
  ["Zuiderzee", "须德海"],
]);

function roundCoord(coord) {
  if (typeof coord[0] === "number") {
    return [Number(coord[0].toFixed(3)), Number(coord[1].toFixed(3))];
  }
  return coord.map(roundCoord);
}

function bboxIntersects(geometry, bbox) {
  if (!geometry || !geometry.coordinates) return false;
  const [minX, minY, maxX, maxY] = bbox;
  let hit = false;
  const scan = (node) => {
    if (hit) return;
    if (typeof node[0] === "number") {
      const x = node[0];
      const y = node[1];
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) hit = true;
      return;
    }
    for (const child of node) scan(child);
  };
  scan(geometry.coordinates);
  return hit;
}

async function fetchOrReuseRaw(url, destPath, label) {
  let exists = false;
  if (!FORCE_DOWNLOAD) {
    try {
      await fs.access(destPath);
      exists = true;
    } catch {
      exists = false;
    }
  }
  let text;
  if (exists) {
    text = await fs.readFile(destPath, "utf8");
    console.log(`Reusing local ${label} (${Math.round(Buffer.byteLength(text, "utf8") / 1024)} KB)`);
  } else {
    console.log(`Downloading ${url}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    text = await res.text();
    await fs.writeFile(destPath, text, "utf8");
    console.log(`Saved ${label} (${Math.round(Buffer.byteLength(text, "utf8") / 1024)} KB)`);
  }
  return {
    file: path.basename(destPath),
    local_path: path.relative(path.resolve(__dirname, ".."), destPath).replace(/\\/g, "/"),
    url,
    sha256: crypto.createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text, "utf8"),
    text,
  };
}

async function writeLayer(outName, features) {
  const fc = { type: "FeatureCollection", features };
  const outPath = path.join(OUT_DIR, outName);
  const body = JSON.stringify(fc);
  await fs.writeFile(outPath, body, "utf8");
  console.log(`Wrote ${outName}: ${features.length} features (${Math.round(body.length / 1024)} KB)`);
  return {
    file: outName,
    feature_count: features.length,
    bytes: Buffer.byteLength(body, "utf8"),
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(HIST_DIR, { recursive: true });

  const neFiles = [
    "ne_10m_ocean.geojson",
    "ne_10m_lakes.geojson",
    "ne_10m_lakes_historic.geojson",
    "ne_10m_lakes_europe.geojson",
    "ne_10m_rivers_lake_centerlines.geojson",
    "ne_10m_rivers_europe.geojson",
    "ne_10m_admin_0_boundary_lines_land.geojson",
    "ne_10m_admin_1_states_provinces.geojson",
  ];
  const hbFiles = [
    "world_bc1.geojson",
    "world_800.geojson",
    "world_900.geojson",
    "world_1300.geojson",
    "world_1650.geojson",
    "world_1815.geojson",
  ];

  const neCache = {};
  const manifestRaw = [];

  for (const fname of neFiles) {
    const rec = await fetchOrReuseRaw(`${NE_BASE}/${fname}`, path.join(RAW_DIR, fname), fname);
    neCache[fname] = JSON.parse(rec.text);
    manifestRaw.push({
      file: rec.file,
      local_path: rec.local_path,
      url: rec.url,
      sha256: rec.sha256,
      bytes: rec.bytes,
    });
  }

  for (const hname of hbFiles) {
    const rec = await fetchOrReuseRaw(
      `${HB_BASE}/${hname}`,
      path.join(HIST_DIR, hname),
      `historical-basemaps/${hname}`,
    );
    manifestRaw.push({
      file: rec.file,
      local_path: rec.local_path,
      url: rec.url,
      sha256: rec.sha256,
      bytes: rec.bytes,
    });
  }

  await fs.writeFile(
    path.join(RAW_DIR, "manifest.json"),
    JSON.stringify({
      generated_at_iso: new Date().toISOString(),
      natural_earth_scale: "1:10m",
      files: manifestRaw,
    }, null, 2),
    "utf8",
  );

  // 1. 1:10m Ocean polygons (high-precision real global coastlines)
  const oceanFeatures = neCache["ne_10m_ocean.geojson"].features.map((f, idx) => ({
    type: "Feature",
    id: `ocean-${idx}`,
    properties: { name: f.properties?.name ?? "Ocean" },
    geometry: { type: f.geometry.type, coordinates: roundCoord(f.geometry.coordinates) },
  }));

  // 2. 1:10m Global + Historic + Europe Lakes clipped to Eurasia
  const eurasiaBbox = [-15, 5, 148, 74];
  const europeBbox = [-10, 35, 65, 68];
  const modernAralNames = new Set(["North Aral Sea", "South Aral Sea"]);
  const combinedLakes = [
    ...neCache["ne_10m_lakes.geojson"].features.filter((f) => !modernAralNames.has(String(f.properties?.name ?? ""))),
    ...neCache["ne_10m_lakes_historic.geojson"].features,
    ...neCache["ne_10m_lakes_europe.geojson"].features.filter((f) => Number(f.properties?.scalerank ?? 99) <= 7),
  ];
  const lakesFeatures = combinedLakes
    .filter((f) => {
      const rank = Number(f.properties?.scalerank ?? 99);
      const name = String(f.properties?.name ?? "");
      return (rank <= 6 && bboxIntersects(f.geometry, eurasiaBbox)) || LAKE_NAME_ZH.has(name);
    })
    .map((f, idx) => {
      const en = String(f.properties?.name ?? "");
      const zh = LAKE_NAME_ZH.get(en) ?? f.properties?.name_zh ?? "";
      return {
        type: "Feature",
        id: `lake-${idx}`,
        properties: { name: en, name_zh: zh, scalerank: Number(f.properties?.scalerank ?? 4) },
        geometry: { type: f.geometry.type, coordinates: roundCoord(f.geometry.coordinates) },
      };
    });

  // 3. 1:10m Global + European Rivers
  const riversCombined = [
    ...neCache["ne_10m_rivers_lake_centerlines.geojson"].features.filter(
      (f) => Number(f.properties?.scalerank ?? 99) <= 8 && bboxIntersects(f.geometry, eurasiaBbox),
    ),
    ...neCache["ne_10m_rivers_europe.geojson"].features.filter(
      (f) => Number(f.properties?.scalerank ?? 99) <= 9 && bboxIntersects(f.geometry, europeBbox),
    ),
  ];
  const riversFeatures = riversCombined.map((f, idx) => ({
    type: "Feature",
    id: `river-${idx}`,
    properties: {
      name: String(f.properties?.name ?? ""),
      scalerank: Number(f.properties?.scalerank ?? 6),
      strokeweig: Number(f.properties?.strokeweig ?? 0.5),
    },
    geometry: { type: f.geometry.type, coordinates: roundCoord(f.geometry.coordinates) },
  }));

  // 4. 1:10m Modern Admin-0 Borders clipped to Eurasia + Compliant China Standard Boundary (100000.json)
  const chinaRec = await fetchOrReuseRaw(
    "https://geo.datav.aliyun.com/areas_v3/bound/100000.json",
    path.join(RAW_DIR, "china_standard_100000.json"),
    "china_standard_100000.json",
  );
  manifestRaw.push({
    file: chinaRec.file,
    local_path: chinaRec.local_path,
    url: chinaRec.url,
    sha256: chinaRec.sha256,
    bytes: chinaRec.bytes,
  });
  const chinaStandard = JSON.parse(chinaRec.text);

  const isRemovedChinaOrConflictLine = (f) => {
    const p = f.properties ?? {};
    const codes = new Set([p.ADM0_A3_L, p.ADM0_A3_R, p.SOV_A3_L, p.SOV_A3_R]);
    if (codes.has("CHN") || codes.has("CH1") || codes.has("TWN") || codes.has("HKG") || codes.has("MAC") || codes.has("KAS")) {
      return true;
    }
    if (p.FCLASS_CN === "Unrecognized" || p.FCLASS_CN === "Map unit boundary") {
      return true;
    }
    const lr = `${p.ADM0_LEFT ?? ""}|${p.ADM0_RIGHT ?? ""}`;
    return /China|Taiwan|Hong Kong|Macau|Siachen/i.test(lr);
  };

  const borderFeatures = neCache["ne_10m_admin_0_boundary_lines_land.geojson"].features
    .filter((f) => bboxIntersects(f.geometry, [-15, 5, 155, 76]) && !isRemovedChinaOrConflictLine(f))
    .map((f, idx) => ({
      type: "Feature",
      id: `mod-border-${idx}`,
      properties: { name: String(f.properties?.name ?? f.properties?.NAME ?? "") },
      geometry: { type: f.geometry.type, coordinates: roundCoord(f.geometry.coordinates) },
    }));

  // Convert official China boundary MultiPolygon/Polygon rings into compliant LineString features
  let cnIdx = 0;
  for (const cf of chinaStandard.features ?? []) {
    const polys =
      cf.geometry?.type === "MultiPolygon"
        ? cf.geometry.coordinates
        : cf.geometry?.type === "Polygon"
          ? [cf.geometry.coordinates]
          : [];
    for (const poly of polys) {
      for (const ring of poly) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        borderFeatures.push({
          type: "Feature",
          id: `mod-border-chn-official-${cnIdx++}`,
          properties: {
            name: "中华人民共和国国界（中国标准主张）",
            sovereignty_pov: "CHN_OFFICIAL",
            adcode: 100000,
          },
          geometry: { type: "LineString", coordinates: roundCoord(ring) },
        });
      }
    }
  }

  // Re-write manifest including china_standard_100000.json
  await fs.writeFile(
    path.join(RAW_DIR, "manifest.json"),
    JSON.stringify({
      generated_at_iso: new Date().toISOString(),
      natural_earth_scale: "1:10m + CHN_OFFICIAL_100000",
      files: manifestRaw,
    }, null, 2),
    "utf8",
  );

  const provenance = {
    license: "Natural Earth Public Domain + PRC Standard Boundary GeoJSON (adcode 100000) + aourednik/historical-basemaps",
    generated_at_iso: new Date().toISOString(),
    sources: manifestRaw.map(({ file, local_path, url, sha256 }) => ({ file, local_path, url, sha256 })),
    outputs: [
      await writeLayer("ocean.geojson", oceanFeatures),
      await writeLayer("lakes.geojson", lakesFeatures),
      await writeLayer("rivers.geojson", riversFeatures),
      await writeLayer("modern_borders.geojson", borderFeatures),
    ],
  };

  await fs.writeFile(path.join(OUT_DIR, "provenance.json"), JSON.stringify(provenance, null, 2), "utf8");
  console.log("Saved public/gis/provenance.json & data/raw-gis/manifest.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
