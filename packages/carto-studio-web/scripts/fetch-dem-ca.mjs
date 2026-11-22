import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TILE_DIR = path.resolve(__dirname, "../data/raw-gis/dem-z6");
const OUT_BIN = path.resolve(__dirname, "../data/raw-gis/dem-ca-z6.int16");
const OUT_META = path.resolve(__dirname, "../data/raw-gis/dem-ca-z6.meta.json");

const ZOOM = 6;
const X_MIN = 39;
const X_MAX = 48;
const Y_MIN = 20;
const Y_MAX = 27;
const STEP_PX = 2;

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgb(buf) {
  let pos = 8; // Skip PNG 8-byte signature
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 2;
  const idatChunks = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const dataStart = pos + 8;
    const dataEnd = dataStart + len;
    if (type === "IHDR") {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === "IDAT") {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    pos = dataEnd + 4;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const rowInStart = y * (stride + 1);
    const filter = raw[rowInStart];
    const rowOutStart = y * stride;
    const prevRowStart = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const val = raw[rowInStart + 1 + x];
      const left = x >= bpp ? pixels[rowOutStart + x - bpp] : 0;
      const up = y > 0 ? pixels[prevRowStart + x] : 0;
      const upLeft = x >= bpp && y > 0 ? pixels[prevRowStart + x - bpp] : 0;
      let recon = val;
      if (filter === 1) recon = (val + left) & 0xff;
      else if (filter === 2) recon = (val + up) & 0xff;
      else if (filter === 3) recon = (val + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) recon = (val + paethPredictor(left, up, upLeft)) & 0xff;
      pixels[rowOutStart + x] = recon;
    }
  }
  return { width, height, bpp, pixels };
}

async function ensureTile(x, y) {
  const filePath = path.join(TILE_DIR, `${x}_${y}.png`);
  try {
    const existing = await fs.readFile(filePath);
    if (existing.length > 200) return existing;
  } catch {
    // cache miss
  }
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(filePath, buf);
      return buf;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Failed downloading tile ${x}/${y}: ${lastErr?.message ?? lastErr}`);
}

async function main() {
  await fs.mkdir(TILE_DIR, { recursive: true });
  const coords = [];
  for (let y = Y_MIN; y <= Y_MAX; y++) {
    for (let x = X_MIN; x <= X_MAX; x++) {
      coords.push([x, y]);
    }
  }

  const cols = X_MAX - X_MIN + 1;
  const rows = Y_MAX - Y_MIN + 1;
  const tileOutW = 256 / STEP_PX;
  const tileOutH = 256 / STEP_PX;
  const outWidth = cols * tileOutW;
  const outHeight = rows * tileOutH;
  const grid = new Int16Array(outWidth * outHeight);

  let idx = 0;
  let downloaded = 0;
  async function worker() {
    while (idx < coords.length) {
      const cur = coords[idx++];
      const [x, y] = cur;
      const buf = await ensureTile(x, y);
      downloaded += 1;
      const { width, height, bpp, pixels } = decodePngRgb(buf);
      if (width !== 256 || height !== 256) {
        throw new Error(`Unexpected tile size ${width}x${height}`);
      }
      const ox = (x - X_MIN) * tileOutW;
      const oy = (y - Y_MIN) * tileOutH;
      for (let ty = 0; ty < 256; ty += STEP_PX) {
        for (let tx = 0; tx < 256; tx += STEP_PX) {
          let sum = 0;
          let cnt = 0;
          for (let dy = 0; dy < STEP_PX; dy++) {
            for (let dx = 0; dx < STEP_PX; dx++) {
              const p = ((ty + dy) * width + (tx + dx)) * bpp;
              const elev = pixels[p] * 256 + pixels[p + 1] + pixels[p + 2] / 256 - 32768;
              sum += elev;
              cnt += 1;
            }
          }
          const avg = Math.max(-32768, Math.min(32767, Math.round(sum / cnt)));
          const gx = ox + (tx / STEP_PX);
          const gy = oy + (ty / STEP_PX);
          grid[gy * outWidth + gx] = avg;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: 8 }, () => worker()));
  await fs.writeFile(OUT_BIN, Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength));

  const meta = {
    source: "AWS Terrarium Elevation Tiles (Mapzen/SRTM/ETOPO)",
    zoom: ZOOM,
    xMin: X_MIN,
    xMax: X_MAX,
    yMin: Y_MIN,
    yMax: Y_MAX,
    stepPx: STEP_PX,
    width: outWidth,
    height: outHeight,
    tileCount: coords.length,
    downloaded_at_iso: new Date().toISOString(),
  };
  await fs.writeFile(OUT_META, JSON.stringify(meta, null, 2), "utf8");

  // Quick physical spot checks: Caspian, Pamirs, Turpan Basin
  const sampleAt = (lon, lat) => {
    const n = 2 ** ZOOM * 256;
    const wx = ((lon + 180) / 360) * n;
    const sin = Math.sin((lat * Math.PI) / 180);
    const wy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n;
    const gx = Math.floor((wx - X_MIN * 256) / STEP_PX);
    const gy = Math.floor((wy - Y_MIN * 256) / STEP_PX);
    return grid[gy * outWidth + gx];
  };
  let minElev = Infinity;
  let maxElev = -Infinity;
  for (const v of grid) {
    if (v < minElev) minElev = v;
    if (v > maxElev) maxElev = v;
  }

  console.log(
    `Cached DEM Z${ZOOM} (${downloaded}/${coords.length} tiles -> ${outWidth}x${outHeight} grid) | min=${minElev}m max=${maxElev}m | Caspian(50.5,41.0)=${sampleAt(50.5, 41.0)}m | PamirPeak(74.9,38.9)=${sampleAt(74.9, 38.9)}m | Turpan(89.3,42.7)=${sampleAt(89.3, 42.7)}m`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
