import fs from "node:fs/promises";
import path from "node:path";

export function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

export function ptsEqual(a, b, eps = 1e-6) {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

export function roundPt(pt) {
  return [Number(pt[0].toFixed(5)), Number(pt[1].toFixed(5))];
}

export function ringSignedArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return s * 0.5;
}

export function pointInRing(pt, ring) {
  let inside = false;
  const px = pt[0];
  const py = pt[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const hit = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-15) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segsProperlyIntersect(a, b, c, d) {
  if (ptsEqual(a, c, 1e-7) || ptsEqual(a, d, 1e-7) || ptsEqual(b, c, 1e-7) || ptsEqual(b, d, 1e-7)) {
    return false;
  }
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) - 1e-9
    || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) - 1e-9
    || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) - 1e-9
    || Math.max(c[1], d[1]) < Math.min(a[1], b[1]) - 1e-9
  ) {
    return false;
  }
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
}

export function findRingSelfIntersection(ring) {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsProperlyIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
        return { i, j, a: ring[i], b: ring[i + 1], c: ring[j], d: ring[j + 1] };
      }
    }
  }
  return null;
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

export function densifyPolylineKm(pts, maxSegKm = 28) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = roundPt(pts[i]);
    if (out.length === 0) {
      out.push(cur);
      continue;
    }
    const prev = out[out.length - 1];
    if (ptsEqual(prev, cur, 1e-6)) continue;
    const km = haversineKm(prev, cur);
    if (km > maxSegKm) {
      const steps = Math.ceil(km / maxSegKm);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push(roundPt([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]));
      }
    }
    out.push(cur);
  }
  return out;
}

export async function loadPhysicalGis(rawGisDir) {
  const ocean = JSON.parse(await fs.readFile(path.join(rawGisDir, "ne_10m_ocean.geojson"), "utf8"));
  const histLakes = JSON.parse(await fs.readFile(path.join(rawGisDir, "ne_10m_lakes_historic.geojson"), "utf8"));
  const rivers = JSON.parse(await fs.readFile(path.join(rawGisDir, "ne_10m_rivers_lake_centerlines.geojson"), "utf8"));

  const eurasiaCoastRing = ocean.features[0].geometry.coordinates[0][0];
  const caspianRing = ocean.features[0].geometry.coordinates[1][0];
  const aralFeature = histLakes.features.find((f) => f.properties?.name === "Aral Sea");
  if (!aralFeature) throw new Error("Missing Aral Sea in ne_10m_lakes_historic.geojson");
  const aralRing = aralFeature.geometry.coordinates[0];

  const extractNamedSegments = (names) => {
    const set = new Set(names);
    const segs = [];
    for (const f of rivers.features) {
      if (!set.has(f.properties?.name)) continue;
      if (f.geometry.type === "LineString") segs.push(f.geometry.coordinates);
      else if (f.geometry.type === "MultiLineString") segs.push(...f.geometry.coordinates);
    }
    return segs;
  };

  return { eurasiaCoastRing, caspianRing, aralRing, extractNamedSegments };
}

export function stitchRiverChain(segments, seedPt) {
  if (segments.length === 0) throw new Error("Empty river segment list");
  const remaining = segments.map((s) => s.map((p) => [p[0], p[1]]));
  // Start with the segment closest to seedPt
  let bestIdx = 0;
  let bestDist = Infinity;
  let reverseStart = false;
  remaining.forEach((seg, idx) => {
    for (const [rev, pt] of [[false, seg[0]], [true, seg[seg.length - 1]]]) {
      const d = Math.hypot(pt[0] - seedPt[0], pt[1] - seedPt[1]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
        reverseStart = rev;
      }
    }
  });
  let chain = remaining.splice(bestIdx, 1)[0];
  if (reverseStart) chain.reverse();

  while (remaining.length > 0) {
    const tail = chain[chain.length - 1];
    let hit = -1;
    let rev = false;
    let bestD = 0.25;
    remaining.forEach((seg, idx) => {
      const d0 = Math.hypot(seg[0][0] - tail[0], seg[0][1] - tail[1]);
      const d1 = Math.hypot(seg[seg.length - 1][0] - tail[0], seg[seg.length - 1][1] - tail[1]);
      if (d0 < bestD) { bestD = d0; hit = idx; rev = false; }
      if (d1 < bestD) { bestD = d1; hit = idx; rev = true; }
    });
    if (hit < 0) break;
    const picked = remaining.splice(hit, 1)[0];
    if (rev) picked.reverse();
    chain = [...chain, ...picked.slice(1)];
  }
  return chain;
}

export function nearestPointIndex(pts, queryPt, searchBox = null) {
  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (searchBox && (p[0] < searchBox[0] || p[0] > searchBox[2] || p[1] < searchBox[1] || p[1] > searchBox[3])) {
      continue;
    }
    const d = Math.hypot(p[0] - queryPt[0], p[1] - queryPt[1]);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) throw new Error(`Failed to snap point [${queryPt.join(",")}]`);
  return bestIdx;
}

export function extractRingSubpath(ring, startCoord, endCoord, viaCoord, dpEps = 0.015, maxSegKm = 28) {
  const open = ptsEqual(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
  const n = open.length;
  const i1 = nearestPointIndex(open, startCoord);
  const i2 = nearestPointIndex(open, endCoord);

  const buildPath = (step) => {
    const pts = [];
    let idx = i1;
    for (let k = 0; k <= n; k++) {
      pts.push(open[idx]);
      if (idx === i2) break;
      idx = (idx + step + n) % n;
    }
    return pts;
  };
  const fwd = buildPath(1);
  const bwd = buildPath(-1);
  const minDistTo = (pts, q) => Math.min(...pts.map((p) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  const chosen = minDistTo(fwd, viaCoord) <= minDistTo(bwd, viaCoord) ? fwd : bwd;
  const simplified = simplifyDP(chosen, dpEps);
  simplified[0] = roundPt(startCoord);
  simplified[simplified.length - 1] = roundPt(endCoord);
  return densifyPolylineKm(simplified, maxSegKm);
}

export function extractPolylineSubpath(chain, startCoord, endCoord, dpEps = 0.012, maxSegKm = 28) {
  const i1 = nearestPointIndex(chain, startCoord);
  const i2 = nearestPointIndex(chain, endCoord);
  const slice = i1 <= i2 ? chain.slice(i1, i2 + 1) : chain.slice(i2, i1 + 1).reverse();
  const simplified = simplifyDP(slice, dpEps);
  simplified[0] = roundPt(startCoord);
  simplified[simplified.length - 1] = roundPt(endCoord);
  return densifyPolylineKm(simplified, maxSegKm);
}

function chaikinOpen(pts, iterations = 2) {
  let cur = pts.map((p) => [p[0], p[1]]);
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) break;
    const next = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      if (i > 0) next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      if (i < cur.length - 2) next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

export function buildOrganicArc(startCoord, endCoord, waypoints, seedKey, amplitudeDeg = 0.045, maxSegKm = 26) {
  const base = [startCoord, ...waypoints, endCoord];
  const smooth = chaikinOpen(base, 2);
  let hash = 2166136261;
  for (let i = 0; i < seedKey.length; i++) {
    hash ^= seedKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const phase = (hash % 628) / 100;
  const perturbed = smooth.map((p, idx) => {
    if (idx === 0 || idx === smooth.length - 1) return roundPt(p);
    const t = idx / (smooth.length - 1);
    const env = Math.sin(Math.PI * t) * amplitudeDeg;
    const dx = Math.sin(t * Math.PI * 5 + phase) * env;
    const dy = Math.cos(t * Math.PI * 4.3 + phase * 0.7) * env * 0.75;
    return roundPt([p[0] + dx, p[1] + dy]);
  });
  return densifyPolylineKm(perturbed, maxSegKm);
}

function stitchFaceArcsCCW(faceId, arcIds, arcById) {
  const unused = arcIds.map((aid) => {
    const a = arcById.get(aid);
    if (!a) throw new Error(`Face ${faceId} references missing arc ${aid}`);
    return a;
  });
  const orderedArcs = [];
  let coords = [];

  // Choose initial arc orientation by testing which connects cleanly to next arc
  const first = unused.shift();
  const second = unused[0];
  let revFirst = false;
  if (second) {
    const endF = first.coordinates[first.coordinates.length - 1];
    const startF = first.coordinates[0];
    const s0 = second.coordinates[0];
    const s1 = second.coordinates[second.coordinates.length - 1];
    if (!ptsEqual(endF, s0, 1e-4) && !ptsEqual(endF, s1, 1e-4)) {
      if (ptsEqual(startF, s0, 1e-4) || ptsEqual(startF, s1, 1e-4)) {
        revFirst = true;
      }
    }
  }
  orderedArcs.push({ arc_id: first.arc_id, reversed: revFirst });
  const firstPts = revFirst ? [...first.coordinates].reverse() : first.coordinates;
  coords.push(...firstPts);

  while (unused.length > 0) {
    const tail = coords[coords.length - 1];
    let hit = -1;
    let rev = false;
    for (let i = 0; i < unused.length; i++) {
      const c = unused[i].coordinates;
      if (ptsEqual(tail, c[0], 1e-4)) { hit = i; rev = false; break; }
      if (ptsEqual(tail, c[c.length - 1], 1e-4)) { hit = i; rev = true; break; }
    }
    if (hit < 0) {
      throw new Error(`Gap in face ${faceId} after tail [${tail.join(",")}] (remaining: ${unused.map((u) => u.arc_id).join(",")})`);
    }
    const picked = unused.splice(hit, 1)[0];
    orderedArcs.push({ arc_id: picked.arc_id, reversed: rev });
    const pts = rev ? [...picked.coordinates].reverse() : picked.coordinates;
    coords.push(...pts.slice(1));
  }

  if (!ptsEqual(coords[0], coords[coords.length - 1], 1e-4)) {
    throw new Error(`Face ${faceId} loop did not close!`);
  }
  coords[coords.length - 1] = [...coords[0]];

  // Ensure strictly CCW winding; if CW, reverse arc traversal order & directions
  if (ringSignedArea(coords) < 0) {
    coords.reverse();
    orderedArcs.reverse();
    for (const item of orderedArcs) item.reversed = !item.reversed;
  }
  return { orderedArcs, ring: coords };
}

export function compilePlanarTopology({ arcs, faceSpecs, cityChecks }) {
  const arcById = new Map(arcs.map((a) => [a.arc_id, a]));
  const compiledFaces = [];
  const leftOwner = new Map();
  const rightOwner = new Map();
  const topoErrors = [];

  for (const spec of faceSpecs) {
    const { orderedArcs, ring } = stitchFaceArcsCCW(spec.face_id, spec.arc_ids, arcById);
    const selfHit = findRingSelfIntersection(ring);
    if (selfHit) {
      topoErrors.push(
        `Self-intersection in ${spec.face_id} at segs (${selfHit.i},${selfHit.j}): [${selfHit.a.join(",")}]->[${selfHit.b.join(",")}] vs [${selfHit.c.join(",")}]->[${selfHit.d.join(",")}]`,
      );
    }
    for (const item of orderedArcs) {
      if (item.reversed) {
        if (rightOwner.has(item.arc_id)) {
          topoErrors.push(`Arc ${item.arc_id} traversed in reverse twice (${rightOwner.get(item.arc_id)} & ${spec.face_id})`);
        }
        rightOwner.set(item.arc_id, spec.face_id);
      } else {
        if (leftOwner.has(item.arc_id)) {
          topoErrors.push(`Arc ${item.arc_id} traversed forward twice (${leftOwner.get(item.arc_id)} & ${spec.face_id})`);
        }
        leftOwner.set(item.arc_id, spec.face_id);
      }
    }
    compiledFaces.push({
      face_id: spec.face_id,
      boundary_arc_ids: orderedArcs.map((o) => o.arc_id),
      ring,
      area: ringSignedArea(ring),
    });
  }

  for (const a of arcs) {
    const l = leftOwner.get(a.arc_id);
    const r = rightOwner.get(a.arc_id);
    if (!l && !r) topoErrors.push(`Orphan arc ${a.arc_id} unused by any face`);
    a.left_face_id = l ?? "EXTERIOR_WORLD";
    a.right_face_id = r ?? "EXTERIOR_WORLD";
  }

  const faceRingById = new Map(compiledFaces.map((f) => [f.face_id, f.ring]));
  for (const chk of cityChecks) {
    const ring = faceRingById.get(chk.face_id);
    if (!ring) {
      topoErrors.push(`City check references unknown face ${chk.face_id}`);
      continue;
    }
    if (!pointInRing(chk.coords, ring)) {
      topoErrors.push(`City ${chk.id} [${chk.coords.join(",")}] not in ${chk.face_id}`);
    }
  }
  if (topoErrors.length > 0) {
    throw new Error(`Topology / city checks failed:\n  ${topoErrors.join("\n  ")}`);
  }

  const segKms = [];
  let totalVertices = 0;
  for (const a of arcs) {
    totalVertices += a.coordinates.length;
    for (let i = 0; i < a.coordinates.length - 1; i++) {
      segKms.push(haversineKm(a.coordinates[i], a.coordinates[i + 1]));
    }
  }
  const avgSegKm = segKms.reduce((s, v) => s + v, 0) / Math.max(1, segKms.length);
  const maxSegKm = Math.max(...segKms);
  return { compiledFaces, totalVertices, avgSegKm, maxSegKm };
}

export async function writeGeneratedCentralAsiaTs(outPath, exportName, data) {
  const header = `// AUTO-GENERATED from pure 1:10m Natural Earth physical coastlines, historic Aral Sea & rivers (NO modern admin boundaries).
import type { BoundaryCertainty, CredibilityTier, ZoneSemantics } from "@historical-cartography/shared-schema";
import type { Position } from "geojson";

export interface GeneratedArcSeed {
  arc_id: string;
  coordinates: Position[];
  start_node_id: string;
  end_node_id: string;
  left_face_id: string;
  right_face_id: string;
  certainty?: BoundaryCertainty;
}

export interface GeneratedFaceSeed {
  face_id: string;
  polity_id: string;
  admin_unit_id?: string;
  boundary_arc_ids: string[];
  interior_hole_arc_ids?: string[];
  control_score: number;
  zone_semantics: ZoneSemantics;
  control_semantic_tag?: string;
  highest_credibility_tier: Exclude<CredibilityTier, "REJECTED_UNVERIFIED">;
  disputed_claimant_polity_ids?: string[];
}

export const ${exportName}: {
  arcs: GeneratedArcSeed[];
  slices: Record<string, GeneratedFaceSeed[]>;
} = ${JSON.stringify(data, null, 2)};
`;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, header, "utf8");
}
