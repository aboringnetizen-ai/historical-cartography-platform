import fs from "node:fs/promises";
import path from "node:path";
import { densifyPolylineKm, roundPt } from "./natural-topo-builder.mjs";

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(node) {
    this.items.push(node);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].f <= this.items[i].f) break;
      const tmp = this.items[p];
      this.items[p] = this.items[i];
      this.items[i] = tmp;
      i = p;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      while (true) {
        let best = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < n && this.items[l].f < this.items[best].f) best = l;
        if (r < n && this.items[r].f < this.items[best].f) best = r;
        if (best === i) break;
        const tmp = this.items[i];
        this.items[i] = this.items[best];
        this.items[best] = tmp;
        i = best;
      }
    }
    return top;
  }
}

function pointToSegDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
}

function simplifyDP(pts, eps) {
  if (pts.length <= 3 || eps <= 0) return pts.map(roundPt);
  let maxD = 0;
  let maxIdx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const t = lenSq > 1e-14 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq)) : 0;
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d > maxD) {
      maxD = d;
      maxIdx = i;
    }
  }
  if (maxD > eps) {
    const left = simplifyDP(pts.slice(0, maxIdx + 1), eps);
    const right = simplifyDP(pts.slice(maxIdx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [roundPt(a), roundPt(b)];
}

function chaikinPass(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (i > 0) out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    if (i < pts.length - 2) out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export async function createDemPathfinder(rawGisDir) {
  const meta = JSON.parse(await fs.readFile(path.join(rawGisDir, "dem-ca-z6.meta.json"), "utf8"));
  const buf = await fs.readFile(path.join(rawGisDir, "dem-ca-z6.int16"));
  const elev = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);

  const { zoom, xMin, yMin, stepPx, width, height } = meta;
  const worldPx = 2 ** zoom * 256;

  const lonLatToGrid = (lon, lat) => {
    const clamped = Math.max(-85, Math.min(85, lat));
    const wx = ((lon + 180) / 360) * worldPx;
    const sin = Math.sin((clamped * Math.PI) / 180);
    const wy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldPx;
    const gx = Math.max(0, Math.min(width - 1, Math.round((wx - xMin * 256) / stepPx)));
    const gy = Math.max(0, Math.min(height - 1, Math.round((wy - yMin * 256) / stepPx)));
    return [gx, gy];
  };

  const gridToLonLat = (gx, gy) => {
    const wx = xMin * 256 + gx * stepPx;
    const wy = yMin * 256 + gy * stepPx;
    const lon = (wx / worldPx) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * wy) / worldPx;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return roundPt([lon, lat]);
  };

  // Precompute mild local TPI (elevation minus 5px box neighborhood mean)
  const tpi = new Float32Array(width * height);
  const rad = 4;
  const prefix = new Float64Array((width + 1) * (height + 1));
  const pw = width + 1;
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += elev[y * width + x];
      prefix[(y + 1) * pw + (x + 1)] = prefix[y * pw + (x + 1)] + rowSum;
    }
  }
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - rad);
    const y1 = Math.min(height - 1, y + rad);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - rad);
      const x1 = Math.min(width - 1, x + rad);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        prefix[(y1 + 1) * pw + (x1 + 1)]
        - prefix[y0 * pw + (x1 + 1)]
        - prefix[(y1 + 1) * pw + x0]
        + prefix[y0 * pw + x0];
      tpi[y * width + x] = elev[y * width + x] - sum / area;
    }
  }

  const occupiedMask = new Uint8Array(width * height);

  const stampOccupiedPolyline = (coords) => {
    for (let i = 0; i < coords.length - 1; i++) {
      const [x0, y0] = lonLatToGrid(coords[i][0], coords[i][1]);
      const [x1, y1] = lonLatToGrid(coords[i + 1][0], coords[i + 1][1]);
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let s = 0; s <= steps; s++) {
        const px = Math.round(x0 + ((x1 - x0) * s) / steps);
        const py = Math.round(y0 + ((y1 - y0) * s) / steps);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              occupiedMask[ny * width + nx] = 1;
            }
          }
        }
      }
    }
  };

  const traceLeg = (ax, ay, bx, by, mode, corridorPx, terrainWeight, seedPhase) => {
    const corridorSq = corridorPx * corridorPx;
    const minX = Math.max(0, Math.min(ax, bx) - corridorPx - 2);
    const maxX = Math.min(width - 1, Math.max(ax, bx) + corridorPx + 2);
    const minY = Math.max(0, Math.min(ay, by) - corridorPx - 2);
    const maxY = Math.min(height - 1, Math.max(ay, by) + corridorPx + 2);
    const subW = maxX - minX + 1;
    const subH = maxY - minY + 1;
    const gScore = new Float32Array(subW * subH).fill(Infinity);
    const cameFrom = new Int32Array(subW * subH).fill(-1);
    const closed = new Uint8Array(subW * subH);

    const targetElev = (elev[ay * width + ax] + elev[by * width + bx]) * 0.5;
    const sIdx = (ay - minY) * subW + (ax - minX);
    const eIdx = (by - minY) * subW + (bx - minX);
    gScore[sIdx] = 0;
    const pq = new MinHeap();
    pq.push({ idx: sIdx, f: Math.hypot(bx - ax, by - ay) });

    const dirs = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1, -1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [1, 1, 1.4142],
    ];

    let found = false;
    while (pq.size > 0) {
      const cur = pq.pop();
      if (cur.idx === eIdx) { found = true; break; }
      if (closed[cur.idx]) continue;
      closed[cur.idx] = 1;

      const lx = cur.idx % subW;
      const ly = (cur.idx - lx) / subW;
      const gx = minX + lx;
      const gy = minY + ly;

      for (const [dx, dy, baseStep] of dirs) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        const distSq = pointToSegDistSq(nx, ny, ax, ay, bx, by);
        if (distSq > corridorSq) continue;

        const nIdx = (ny - minY) * subW + (nx - minX);
        if (closed[nIdx]) continue;

        const gGlobal = ny * width + nx;
        const nearEnd = (nx - ax) ** 2 + (ny - ay) ** 2 <= 9 || (nx - bx) ** 2 + (ny - by) ** 2 <= 9;
        const occPenalty = !nearEnd && occupiedMask[gGlobal] ? 1500 : 0;

        // Mild terrain guidance + soft corridor pull so borders look organic yet never jaggedly literal
        const h = elev[gGlobal];
        const tVal = tpi[gGlobal];
        let terrCost = 0;
        if (mode === "ridge") {
          const ridgeBonus = Math.max(-0.3, Math.min(0.45, -tVal / 500));
          const elevPenalty = h < 1200 ? 0.25 : 0;
          terrCost = terrainWeight * (ridgeBonus + elevPenalty);
        } else if (mode === "contour") {
          terrCost = terrainWeight * Math.min(1.0, Math.abs(h - targetElev) / 650);
        } else {
          // steppe / hillock divide with soft wave modulation
          const wave = 0.08 * Math.sin(nx * 0.22 + ny * 0.19 + seedPhase);
          terrCost = terrainWeight * (Math.max(-0.2, Math.min(0.35, -tVal / 260)) + wave);
        }
        const corridorPull = (distSq / corridorSq) * 0.35;
        const stepCost = baseStep * (1 + Math.max(-0.22, terrCost) + corridorPull) + occPenalty;
        const candG = gScore[cur.idx] + stepCost;
        if (candG < gScore[nIdx]) {
          gScore[nIdx] = candG;
          cameFrom[nIdx] = cur.idx;
          const hDist = Math.hypot(bx - nx, by - ny) * 0.85;
          pq.push({ idx: nIdx, f: candG + hDist });
        }
      }
    }

    if (!found) return [gridToLonLat(ax, ay), gridToLonLat(bx, by)];
    const pxPath = [];
    let cur = eIdx;
    while (cur >= 0) {
      const lx = cur % subW;
      const ly = (cur - lx) / subW;
      pxPath.push(gridToLonLat(minX + lx, minY + ly));
      if (cur === sIdx) break;
      cur = cameFrom[cur];
    }
    pxPath.reverse();
    return pxPath;
  };

  const traceRefinedBorderArc = ({
    start,
    end,
    waypoints = [],
    mode = "divide",
    corridorPx = 11,
    terrainWeight = 0.34,
    seedKey = "arc",
    maxSegKm = 18,
  }) => {
    let hash = 2166136261;
    for (let i = 0; i < seedKey.length; i++) {
      hash ^= seedKey.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    const seedPhase = (hash % 628) / 100;

    const fullWaypoints = [start, ...waypoints, end];
    let combined = [];
    for (let i = 0; i < fullWaypoints.length - 1; i++) {
      const a = lonLatToGrid(fullWaypoints[i][0], fullWaypoints[i][1]);
      const b = lonLatToGrid(fullWaypoints[i + 1][0], fullWaypoints[i + 1][1]);
      const legCoords = traceLeg(a[0], a[1], b[0], b[1], mode, corridorPx, terrainWeight, seedPhase + i);
      combined = i === 0 ? legCoords : [...combined, ...legCoords.slice(1)];
    }

    // Smooth staircase pixels cleanly into refined cartographic curves, keeping subtle natural texture
    let refined = simplifyDP(combined, 0.015);
    refined = chaikinPass(refined);
    refined[0] = roundPt(start);
    refined[refined.length - 1] = roundPt(end);
    refined = densifyPolylineKm(refined, maxSegKm);
    stampOccupiedPolyline(refined);
    return refined;
  };

  return { traceRefinedBorderArc, stampOccupiedPolyline };
}
