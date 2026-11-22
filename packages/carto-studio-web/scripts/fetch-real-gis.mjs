import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../public/gis");
const BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

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
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        hit = true;
      }
      return;
    }
    for (const child of node) scan(child);
  };
  scan(geometry.coordinates);
  return hit;
}

async function fetchJson(fileName) {
  const url = `${BASE}/${fileName}`;
  console.log(`Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const text = await res.text();
  return {
    url,
    sha256: crypto.createHash("sha256").update(text).digest("hex"),
    json: JSON.parse(text),
  };
}

async function writeLayer(outName, features) {
  const fc = {
    type: "FeatureCollection",
    features,
  };
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
  const provenance = {
    license: "Natural Earth Public Domain (https://www.naturalearthdata.com/about/terms-of-use/)",
    generated_at_iso: new Date().toISOString(),
    sources: [],
    outputs: [],
  };

  // 1. Real 50m Ocean polygons (global coastlines)
  const oceanRaw = await fetchJson("ne_50m_ocean.geojson");
  provenance.sources.push({ file: "ne_50m_ocean.geojson", url: oceanRaw.url, sha256: oceanRaw.sha256 });
  const oceanFeatures = oceanRaw.json.features.map((f, idx) => ({
    type: "Feature",
    id: `ocean-${idx}`,
    properties: { name: f.properties?.name ?? "Ocean" },
    geometry: {
      type: f.geometry.type,
      coordinates: roundCoord(f.geometry.coordinates),
    },
  }));
  provenance.outputs.push(await writeLayer("ocean.geojson", oceanFeatures));

  // 2. Real 10m Lakes + Historic Lakes (Caspian is in ocean.geojson; historic gives full Aral Sea & Lop Nur!)
  const lakesRaw = await fetchJson("ne_10m_lakes.geojson");
  const historicLakesRaw = await fetchJson("ne_10m_lakes_historic.geojson");
  provenance.sources.push({ file: "ne_10m_lakes.geojson", url: lakesRaw.url, sha256: lakesRaw.sha256 });
  provenance.sources.push({ file: "ne_10m_lakes_historic.geojson", url: historicLakesRaw.url, sha256: historicLakesRaw.sha256 });
  const eurasiaBbox = [-15, 5, 145, 72];
  const modernAralNames = new Set(["North Aral Sea", "South Aral Sea"]);
  const combinedLakes = [
    ...lakesRaw.json.features.filter((f) => !modernAralNames.has(String(f.properties?.name ?? ""))),
    ...historicLakesRaw.json.features,
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
        properties: {
          name: en,
          name_zh: zh,
          scalerank: Number(f.properties?.scalerank ?? 2),
        },
        geometry: {
          type: f.geometry.type,
          coordinates: roundCoord(f.geometry.coordinates),
        },
      };
    });
  provenance.outputs.push(await writeLayer("lakes.geojson", lakesFeatures));

  // 3. Real 10m Rivers clipped to Eurasia
  const riversRaw = await fetchJson("ne_10m_rivers_lake_centerlines.geojson");
  provenance.sources.push({
    file: "ne_10m_rivers_lake_centerlines.geojson",
    url: riversRaw.url,
    sha256: riversRaw.sha256,
  });
  const riversFeatures = riversRaw.json.features
    .filter((f) => Number(f.properties?.scalerank ?? 99) <= 8 && bboxIntersects(f.geometry, eurasiaBbox))
    .map((f, idx) => ({
      type: "Feature",
      id: `river-${idx}`,
      properties: {
        name: String(f.properties?.name ?? ""),
        scalerank: Number(f.properties?.scalerank ?? 6),
        strokeweig: Number(f.properties?.strokeweig ?? 0.5),
      },
      geometry: {
        type: f.geometry.type,
        coordinates: roundCoord(f.geometry.coordinates),
      },
    }));
  provenance.outputs.push(await writeLayer("rivers.geojson", riversFeatures));

  // 4. Real 50m Modern Admin-0 Borders
  const bordersRaw = await fetchJson("ne_50m_admin_0_boundary_lines_land.geojson");
  provenance.sources.push({
    file: "ne_50m_admin_0_boundary_lines_land.geojson",
    url: bordersRaw.url,
    sha256: bordersRaw.sha256,
  });
  const borderFeatures = bordersRaw.json.features.map((f, idx) => ({
    type: "Feature",
    id: `mod-border-${idx}`,
    properties: { name: String(f.properties?.name ?? "") },
    geometry: {
      type: f.geometry.type,
      coordinates: roundCoord(f.geometry.coordinates),
    },
  }));
  provenance.outputs.push(await writeLayer("modern_borders.geojson", borderFeatures));

  await fs.writeFile(path.join(OUT_DIR, "provenance.json"), JSON.stringify(provenance, null, 2), "utf8");
  console.log("Saved public/gis/provenance.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
