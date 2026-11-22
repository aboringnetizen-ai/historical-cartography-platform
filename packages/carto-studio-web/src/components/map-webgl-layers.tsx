import maplibregl from "maplibre-gl";
import type { BasemapId, BorderShaderMode } from "@historical-cartography/shared-schema";
import { BASEMAP_CATALOG } from "../core/styles/style-presets.ts";

let protocolRegistered = false;

function hash2d(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function fbm(lon: number, lat: number, seed: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = 0.08;
  for (let i = 0; i < 4; i++) {
    const gx = Math.floor(lon * freq);
    const gy = Math.floor(lat * freq);
    const fx = lon * freq - gx;
    const fy = lat * freq - gy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash2d(gx, gy, seed + i);
    const b = hash2d(gx + 1, gy, seed + i);
    const c = hash2d(gx, gy + 1, seed + i);
    const d = hash2d(gx + 1, gy + 1, seed + i);
    const lerp1 = a + (b - a) * u;
    const lerp2 = c + (d - c) * u;
    value += (lerp1 + (lerp2 - lerp1) * v) * amp;
    freq *= 2.05;
    amp *= 0.5;
  }
  return value;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [
    Number.parseInt(c.slice(0, 2), 16) || 0,
    Number.parseInt(c.slice(2, 4), 16) || 0,
    Number.parseInt(c.slice(4, 6), 16) || 0,
  ];
}

function tileToLonLat(z: number, x: number, y: number): { lon: number; lat: number } {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lon, lat };
}

/**
 * Coarse historical Eurasia/Central Asia sea-vs-land mask so offline procedural tiles
 * cleanly depict Caspian Sea, Aral Sea, Persian Gulf, Mediterranean & Black Sea.
 */
function isWaterMask(lon: number, lat: number): boolean {
  // Caspian Sea approx
  if (lon >= 46.8 && lon <= 54.0 && lat >= 36.6 && lat <= 46.5) {
    const centerLon = 50.3 + Math.sin((lat - 37) * 0.45) * 1.1;
    if (Math.abs(lon - centerLon) < 1.85) return true;
  }
  // Aral Sea approx
  if (lon >= 58.3 && lon <= 61.6 && lat >= 43.4 && lat <= 46.4) return true;
  // Persian Gulf / Indian Ocean south of 27.5
  if (lat < 26.8 && lon >= 48 && lon <= 66) return true;
  // Black Sea
  if (lon >= 28 && lon <= 41.8 && lat >= 41.0 && lat <= 46.4) return true;
  // Mediterranean
  if (lon >= -5 && lon <= 36.2 && lat >= 31.2 && lat <= 38.5) return true;
  return false;
}

async function renderProceduralTile(basemapId: BasemapId, z: number, x: number, y: number): Promise<Uint8Array> {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Uint8Array();

  const meta = BASEMAP_CATALOG.find((item) => item.id === basemapId) ?? BASEMAP_CATALOG[0]!;
  const waterRgb = hexToRgbTuple(meta.water_hex);
  const lowRgb = hexToRgbTuple(meta.land_low_hex);
  const highRgb = hexToRgbTuple(meta.land_high_hex);

  const img = ctx.createImageData(size, size);
  const data = img.data;
  const step = 4; // 4x4 microblock sampling keeps deterministic tile generation instant (<4ms)

  for (let py = 0; py < size; py += step) {
    const ty = y + py / size;
    for (let px = 0; px < size; px += step) {
      const tx = x + px / size;
      const { lon, lat } = tileToLonLat(z, tx, ty);
      const water = isWaterMask(lon, lat);

      let r: number;
      let g: number;
      let b: number;

      if (water) {
        const wave = (fbm(lon * 2.1, lat * 2.1, 17) - 0.5) * 12;
        r = waterRgb[0] + wave;
        g = waterRgb[1] + wave;
        b = waterRgb[2] + wave;
      } else {
        // Synthetic Kopet Dag, Pamir/Tian Shan & Zagros elevation ridges
        const pamir = Math.exp(-(((lon - 73) / 7.5) ** 2 + ((lat - 38.5) / 5.5) ** 2)) * 0.72;
        const zagros = Math.exp(-(((lon - 50) / 5.5) ** 2 + ((lat - 33) / 5.0) ** 2)) * 0.46;
        const elev = Math.max(0, Math.min(1, fbm(lon, lat, 3) * 0.65 + pamir + zagros));
        const elevDx = fbm(lon + 0.15, lat, 3) - fbm(lon - 0.15, lat, 3);
        const elevDy = fbm(lon, lat + 0.15, 3) - fbm(lon, lat - 0.15, 3);
        const hillshade = (elevDx * -0.7 + elevDy * 0.7) * 85;

        r = lowRgb[0] + (highRgb[0] - lowRgb[0]) * elev + hillshade;
        g = lowRgb[1] + (highRgb[1] - lowRgb[1]) * elev + hillshade;
        b = lowRgb[2] + (highRgb[2] - lowRgb[2]) * elev + hillshade * (basemapId === "swiss_relief_engraved" ? 0.65 : 1);

        if (basemapId === "antique_parchment") {
          const grain = (hash2d(px, py, 91) - 0.5) * 14;
          r += grain;
          g += grain * 0.9;
          b += grain * 0.6;
        }
      }

      const cr = Math.max(0, Math.min(255, Math.round(r)));
      const cg = Math.max(0, Math.min(255, Math.round(g)));
      const cb = Math.max(0, Math.min(255, Math.round(b)));

      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const idx = ((py + dy) * size + (px + dx)) * 4;
          data[idx] = cr;
          data[idx + 1] = cg;
          data[idx + 2] = cb;
          data[idx + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  if (basemapId === "satellite_dark_mono") {
    ctx.strokeStyle = "rgba(248, 250, 252, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, size, size);
  }
  if (basemapId === "modern_reference") {
    ctx.strokeStyle = "rgba(100, 116, 139, 0.24)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.stroke();
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}

export function ensureCartoBasemapProtocol(): void {
  if (protocolRegistered) return;
  protocolRegistered = true;
  maplibregl.addProtocol("carto-basemap", async (params) => {
    const clean = params.url.replace("carto-basemap://", "");
    const parts = clean.split("/");
    const basemapId = (parts[0] || "hypsometric_dem") as BasemapId;
    const z = Number.parseInt(parts[1] || "0", 10) || 0;
    const x = Number.parseInt(parts[2] || "0", 10) || 0;
    const y = Number.parseInt(parts[3] || "0", 10) || 0;
    const bytes = await renderProceduralTile(basemapId, z, x, y);
    return { data: bytes.buffer as ArrayBuffer };
  });
}

export interface BorderShaderRingBuffer {
  colorRgb: [number, number, number];
  verticesMercator: Float32Array;
}

/**
 * Custom WebGL layer implementing SDF-style inward band glow (`inner_band_glow`),
 * watercolor feathering (`watercolor_vignette`), and diagonal military occupation hatch
 * (`occupation_hatch_frontline`) directly inside MapLibre's WebGL render pass.
 */
export class BorderShaderWebGLLayer implements maplibregl.CustomLayerInterface {
  readonly id = "carto-border-shader-webgl";
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;

  private mode: BorderShaderMode = "crisp_outlined";
  private opacity = 0.4;
  private bandWidthPx = 14;
  private hatchAngleDeg = 45;
  private polygons: BorderShaderRingBuffer[] = [];
  private program: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private onReadyChange: ((ready: boolean) => void) | undefined;

  constructor(onReadyChange?: (ready: boolean) => void) {
    this.onReadyChange = onReadyChange;
  }

  updateConfig(params: {
    mode: BorderShaderMode;
    opacity: number;
    bandWidthPx: number;
    hatchAngleDeg: number;
    polygons: BorderShaderRingBuffer[];
  }): void {
    this.mode = params.mode;
    this.opacity = params.opacity;
    this.bandWidthPx = params.bandWidthPx;
    this.hatchAngleDeg = params.hatchAngleDeg;
    this.polygons = params.polygons;
  }

  onAdd(_map: maplibregl.Map, gl: WebGLRenderingContext): void {
    const vsSource = `
      uniform mat4 u_matrix;
      attribute vec2 a_pos;
      attribute float a_edge_dist;
      varying float v_edge_dist;
      void main() {
        v_edge_dist = a_edge_dist;
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
      }
    `;
    const fsSource = `
      precision mediump float;
      uniform vec3 u_color;
      uniform float u_opacity;
      uniform int u_mode;
      uniform float u_hatch_angle;
      varying float v_edge_dist;
      void main() {
        if (u_mode == 1) {
          float glow = clamp(1.0 - v_edge_dist, 0.0, 1.0);
          gl_FragColor = vec4(u_color, u_opacity * pow(glow, 1.35));
        } else if (u_mode == 2) {
          float feather = smoothstep(0.0, 1.0, 1.0 - v_edge_dist);
          gl_FragColor = vec4(u_color, u_opacity * feather * 0.85);
        } else if (u_mode == 4) {
          float rad = radians(u_hatch_angle);
          float proj = gl_FragCoord.x * cos(rad) + gl_FragCoord.y * sin(rad);
          float stripe = step(0.58, fract(proj / 9.0));
          gl_FragColor = vec4(u_color, u_opacity * (0.14 + 0.55 * stripe));
        } else {
          gl_FragColor = vec4(u_color, 0.0);
        }
      }
    `;

    const compile = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) {
      this.onReadyChange?.(false);
      return;
    }

    const prog = gl.createProgram();
    if (!prog) {
      this.onReadyChange?.(false);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      this.onReadyChange?.(false);
      return;
    }

    this.program = prog;
    this.vbo = gl.createBuffer();
    this.onReadyChange?.(true);
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: maplibregl.CustomRenderMethodInput): void {
    if (!this.program || !this.vbo) return;
    const matrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
    const modeCode =
      this.mode === "inner_band_glow"
        ? 1
        : this.mode === "watercolor_vignette"
          ? 2
          : this.mode === "occupation_hatch_frontline"
            ? 4
            : 0;
    if (modeCode === 0 || this.polygons.length === 0) return;

    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const uMatrix = gl.getUniformLocation(this.program, "u_matrix");
    const uColor = gl.getUniformLocation(this.program, "u_color");
    const uOpacity = gl.getUniformLocation(this.program, "u_opacity");
    const uMode = gl.getUniformLocation(this.program, "u_mode");
    const uHatch = gl.getUniformLocation(this.program, "u_hatch_angle");
    const aPos = gl.getAttribLocation(this.program, "a_pos");
    const aEdgeDist = gl.getAttribLocation(this.program, "a_edge_dist");

    gl.uniformMatrix4fv(uMatrix, false, matrix);
    gl.uniform1f(uOpacity, Math.max(0.05, Math.min(0.85, this.opacity * (this.bandWidthPx / 16))));
    gl.uniform1i(uMode, modeCode);
    gl.uniform1f(uHatch, this.hatchAngleDeg);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 3 * 4;
    if (aPos >= 0) {
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    }
    if (aEdgeDist >= 0) {
      gl.enableVertexAttribArray(aEdgeDist);
      gl.vertexAttribPointer(aEdgeDist, 1, gl.FLOAT, false, stride, 8);
    }

    for (const poly of this.polygons) {
      if (poly.verticesMercator.length < 9) continue;
      gl.uniform3f(uColor, poly.colorRgb[0] / 255, poly.colorRgb[1] / 255, poly.colorRgb[2] / 255);
      gl.bufferData(gl.ARRAY_BUFFER, poly.verticesMercator, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, poly.verticesMercator.length / 3);
    }
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext): void {
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.program) gl.deleteProgram(this.program);
    this.vbo = null;
    this.program = null;
  }
}

export function buildInwardRibbonBuffer(
  rings: number[][][],
  colorRgb: [number, number, number],
  inwardFraction = 0.28,
): BorderShaderRingBuffer {
  const outer = rings[0] ?? [];
  if (outer.length < 3) return { colorRgb, verticesMercator: new Float32Array(0) };

  let cx = 0;
  let cy = 0;
  for (const pt of outer) {
    cx += pt[0] ?? 0;
    cy += pt[1] ?? 0;
  }
  cx /= outer.length;
  cy /= outer.length;

  const mcCenter = maplibregl.MercatorCoordinate.fromLngLat([cx, cy]);
  const floats: number[] = [];

  for (let i = 0; i < outer.length - 1; i++) {
    const p1 = outer[i]!;
    const p2 = outer[i + 1]!;
    const m1 = maplibregl.MercatorCoordinate.fromLngLat([p1[0] ?? 0, p1[1] ?? 0]);
    const m2 = maplibregl.MercatorCoordinate.fromLngLat([p2[0] ?? 0, p2[1] ?? 0]);
    const i1x = m1.x + (mcCenter.x - m1.x) * inwardFraction;
    const i1y = m1.y + (mcCenter.y - m1.y) * inwardFraction;
    const i2x = m2.x + (mcCenter.x - m2.x) * inwardFraction;
    const i2y = m2.y + (mcCenter.y - m2.y) * inwardFraction;

    floats.push(
      m1.x, m1.y, 0.0,
      m2.x, m2.y, 0.0,
      i1x, i1y, 1.0,
      m2.x, m2.y, 0.0,
      i2x, i2y, 1.0,
      i1x, i1y, 1.0,
    );
  }

  return { colorRgb, verticesMercator: new Float32Array(floats) };
}
