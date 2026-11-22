import maplibregl from "maplibre-gl";
import type { BasemapId, BorderShaderMode, ComposableStylePack } from "@historical-cartography/shared-schema";
import type { Position } from "geojson";
import { normalizeRingWinding, triangulatePolygonRing } from "../core/data/topology-builder.ts";

export interface RealBasemapRenderTheme {
  tileUrl: string;
  secondaryOverlayUrl?: string;
  rasterSaturation: number;
  rasterBrightnessMin: number;
  rasterBrightnessMax: number;
  rasterContrast: number;
  rasterHueRotate: number;
  rasterOpacity: number;
  parchmentOpacity: number;
  bgHex: string;
  oceanFillHex: string;
  shorelineHex: string;
  riverHex: string;
  hillshadeHighlightHex: string;
  hillshadeShadowHex: string;
  hillshadeExaggerationBoost: number;
  reliefOverlayOpacity: number;
  isDark: boolean;
}

export const AWS_TERRARIUM_DEM_TILES = [
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
];

let cachedParchmentDataUrl: string | null = null;

/**
 * Deterministic antique parchment fiber & foxing grain data URI (no random noise).
 */
export function getParchmentPaperDataUrl(): string {
  if (cachedParchmentDataUrl) return cachedParchmentDataUrl;
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#efe2c2";
  ctx.fillRect(0, 0, 256, 256);

  // Subtle crossed laid-paper ribs & organic mottling
  for (let i = 0; i < 256; i += 4) {
    ctx.fillStyle = i % 8 === 0 ? "rgba(162, 130, 82, 0.08)" : "rgba(255, 249, 232, 0.1)";
    ctx.fillRect(0, i, 256, 1);
  }
  for (let i = 0; i < 180; i++) {
    const x = (i * 73 + 19) % 256;
    const y = (i * 139 + 41) % 256;
    const r = ((i * 29) % 18) + 6;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(156, 122, 68, 0.09)");
    grad.addColorStop(1, "rgba(156, 122, 68, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  cachedParchmentDataUrl = canvas.toDataURL("image/png");
  return cachedParchmentDataUrl;
}

let cachedParchmentPattern: { width: number; height: number; data: Uint8Array } | null = null;

/**
 * Deterministic 256x256 RGBA pattern buffer for synchronous `map.addImage()` tiling in WebGL.
 */
export function getParchmentPatternData(): { width: number; height: number; data: Uint8Array } {
  if (cachedParchmentPattern) return cachedParchmentPattern;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const grain = (hash - Math.floor(hash)) * 18 - 9;
      const rib = y % 6 === 0 ? -10 : x % 12 === 0 ? -4 : 0;
      const foxing = Math.sin(x * 0.05) * Math.cos(y * 0.05) * 11;
      const delta = grain + rib + foxing;
      data[idx] = Math.max(0, Math.min(255, Math.round(234 + delta)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(218 + delta * 0.9)));
      data[idx + 2] = Math.max(0, Math.min(255, Math.round(182 + delta * 0.75)));
      data[idx + 3] = 255;
    }
  }
  cachedParchmentPattern = { width: size, height: size, data };
  return cachedParchmentPattern;
}

export function getRealBasemapTheme(
  basemapId: BasemapId,
  desaturation: number,
  hillshadeExaggeration: number,
  spotlightActive = false,
): RealBasemapRenderTheme {
  if (spotlightActive) {
    return {
      tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      rasterSaturation: -1,
      rasterBrightnessMin: 0.0,
      rasterBrightnessMax: 0.3,
      rasterContrast: 0.25,
      rasterHueRotate: 0,
      rasterOpacity: 0.96,
      parchmentOpacity: 0,
      bgHex: "#10141c",
      oceanFillHex: "#151d28",
      shorelineHex: "#e2e8f0",
      riverHex: "#475569",
      hillshadeHighlightHex: "#64748b",
      hillshadeShadowHex: "#06090f",
      hillshadeExaggerationBoost: Math.min(1, 0.5 + hillshadeExaggeration * 0.35),
      reliefOverlayOpacity: 0.5,
      isDark: true,
    };
  }

  const desat = Math.max(0, Math.min(1, desaturation));
  switch (basemapId) {
    case "hypsometric_dem":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -desat * 0.35,
        rasterBrightnessMin: 0.06,
        rasterBrightnessMax: 0.96,
        rasterContrast: 0.14,
        rasterHueRotate: 0,
        rasterOpacity: 0.95,
        parchmentOpacity: 0,
        bgHex: "#d5e4ee",
        oceanFillHex: "#b7c4f2",
        shorelineHex: "#ffffff",
        riverHex: "#2563eb",
        hillshadeHighlightHex: "#fffbeb",
        hillshadeShadowHex: "#182230",
        hillshadeExaggerationBoost: Math.min(1, 0.45 + hillshadeExaggeration * 0.35),
        reliefOverlayOpacity: 0.55,
        isDark: false,
      };
    case "swiss_relief_engraved":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -Math.max(0.25, desat),
        rasterBrightnessMin: 0.14,
        rasterBrightnessMax: 0.98,
        rasterContrast: 0.18,
        rasterHueRotate: 0,
        rasterOpacity: 0.92,
        parchmentOpacity: 0,
        bgHex: "#dfe5ea",
        oceanFillHex: "#c2dbf2",
        shorelineHex: "#334155",
        riverHex: "#3b76b8",
        hillshadeHighlightHex: "#fff9e6",
        hillshadeShadowHex: "#2d3b4d",
        hillshadeExaggerationBoost: Math.min(1, 0.52 + hillshadeExaggeration * 0.35),
        reliefOverlayOpacity: 0.58,
        isDark: false,
      };
    case "alabaster_clay_relief":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -1,
        rasterBrightnessMin: 0.46,
        rasterBrightnessMax: 1.0,
        rasterContrast: 0.24,
        rasterHueRotate: 0,
        rasterOpacity: 0.96,
        parchmentOpacity: 0,
        bgHex: "#f3f5f7",
        oceanFillHex: "#b8b6ee",
        shorelineHex: "#ffffff",
        riverHex: "#3b82f6",
        hillshadeHighlightHex: "#ffffff",
        hillshadeShadowHex: "#475569",
        hillshadeExaggerationBoost: Math.min(1, 0.58 + hillshadeExaggeration * 0.35),
        reliefOverlayOpacity: 0.65,
        isDark: false,
      };
    case "satellite_natural":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -desat * 0.35,
        rasterBrightnessMin: 0.0,
        rasterBrightnessMax: 0.95,
        rasterContrast: 0.08,
        rasterHueRotate: 0,
        rasterOpacity: 0.96,
        parchmentOpacity: 0,
        bgHex: "#182433",
        oceanFillHex: "#1c334d",
        shorelineHex: "#e2e8f0",
        riverHex: "#60a5fa",
        hillshadeHighlightHex: "#f8fafc",
        hillshadeShadowHex: "#0f172a",
        hillshadeExaggerationBoost: Math.min(1, 0.4 + hillshadeExaggeration * 0.28),
        reliefOverlayOpacity: 0.42,
        isDark: true,
      };
    case "satellite_dark_mono":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -1,
        rasterBrightnessMin: 0.0,
        rasterBrightnessMax: 0.35,
        rasterContrast: 0.28,
        rasterHueRotate: 0,
        rasterOpacity: 0.98,
        parchmentOpacity: 0,
        bgHex: "#141820",
        oceanFillHex: "#1c2330",
        shorelineHex: "#f8fafc",
        riverHex: "#64748b",
        hillshadeHighlightHex: "#64748b",
        hillshadeShadowHex: "#090d14",
        hillshadeExaggerationBoost: Math.min(1, 0.48 + hillshadeExaggeration * 0.32),
        reliefOverlayOpacity: 0.52,
        isDark: true,
      };
    case "antique_parchment":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -0.92,
        rasterBrightnessMin: 0.28,
        rasterBrightnessMax: 0.94,
        rasterContrast: 0.14,
        rasterHueRotate: 0,
        rasterOpacity: 0.48,
        parchmentOpacity: 0.72,
        bgHex: "#e8d9b5",
        oceanFillHex: "#c3d4da",
        shorelineHex: "#624e35",
        riverHex: "#3b6ea5",
        hillshadeHighlightHex: "#fdf4dc",
        hillshadeShadowHex: "#735f43",
        hillshadeExaggerationBoost: Math.min(1, 0.38 + hillshadeExaggeration * 0.28),
        reliefOverlayOpacity: 0.44,
        isDark: false,
      };
    case "modern_reference":
      return {
        // Use borderless physical base + compliant /gis/modern_borders.geojson (CHN_OFFICIAL) so no third-party border claims appear
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -Math.max(0.15, desat),
        rasterBrightnessMin: 0.05,
        rasterBrightnessMax: 0.98,
        rasterContrast: 0.06,
        rasterHueRotate: 0,
        rasterOpacity: 0.92,
        parchmentOpacity: 0,
        bgHex: "#e5ecf2",
        oceanFillHex: "#bdd8f1",
        shorelineHex: "#475569",
        riverHex: "#2563eb",
        hillshadeHighlightHex: "#ffffff",
        hillshadeShadowHex: "#64748b",
        hillshadeExaggerationBoost: Math.min(1, 0.25 + hillshadeExaggeration * 0.2),
        reliefOverlayOpacity: 0.3,
        isDark: false,
      };
  }
}

export interface BorderShaderPolyBuffer {
  colorRgb: [number, number, number];
  /** Packed stride-5 floats: [mx, my, edgeDist(0..1), inwardDx, inwardDy] */
  verticesMercator: Float32Array;
}

export interface TerritoryFillPolyBuffer extends BorderShaderPolyBuffer {
  opacity: number;
}

/**
 * Custom WebGL layer implementing blend-mode-aware polygon fills (`u_mode == 5`),
 * pixel-accurate inward glow (`inner_band_glow`), organic feather vignette
 * (`watercolor_vignette`), and full-face ear-clipped diagonal occupation hatch
 * (`occupation_hatch_frontline`) with configurable `blend_mode`.
 */
export class BorderShaderWebGLLayer implements maplibregl.CustomLayerInterface {
  readonly id = "carto-border-shader-webgl";
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;

  private mode: BorderShaderMode = "crisp_outlined";
  private blendMode: ComposableStylePack["basemap"]["blend_mode"] = "normal";
  private opacity = 0.42;
  private bandWidthPx = 16;
  private hatchAngleDeg = 45;
  private hatchSpacingPx = 9;
  private ribbonPolys: BorderShaderPolyBuffer[] = [];
  private fillHatchPolys: BorderShaderPolyBuffer[] = [];
  private territoryFillPolys: TerritoryFillPolyBuffer[] = [];
  private mapInstance: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private onReadyChange: ((ready: boolean) => void) | undefined;

  constructor(onReadyChange?: (ready: boolean) => void) {
    this.onReadyChange = onReadyChange;
  }

  isReady(): boolean {
    return Boolean(this.program && this.vbo);
  }

  updateConfig(params: {
    mode: BorderShaderMode;
    blendMode: ComposableStylePack["basemap"]["blend_mode"];
    opacity: number;
    bandWidthPx: number;
    hatchAngleDeg: number;
    hatchSpacingPx: number;
    ribbonPolygons: BorderShaderPolyBuffer[];
    hatchPolygons: BorderShaderPolyBuffer[];
    fillPolygons?: TerritoryFillPolyBuffer[];
  }): void {
    this.mode = params.mode;
    this.blendMode = params.blendMode;
    this.opacity = params.opacity;
    this.bandWidthPx = params.bandWidthPx;
    this.hatchAngleDeg = params.hatchAngleDeg;
    this.hatchSpacingPx = params.hatchSpacingPx;
    this.ribbonPolys = params.ribbonPolygons;
    this.fillHatchPolys = params.hatchPolygons;
    this.territoryFillPolys = params.fillPolygons ?? [];
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    this.mapInstance = map;
    const vsSource = `
      uniform mat4 u_matrix;
      uniform float u_band_mercator;
      attribute vec2 a_pos;
      attribute float a_edge_dist;
      attribute vec2 a_inward;
      varying float v_edge_dist;
      void main() {
        v_edge_dist = a_edge_dist;
        vec2 displaced = a_pos + a_inward * u_band_mercator;
        gl_Position = u_matrix * vec4(displaced, 0.0, 1.0);
      }
    `;
    const fsSource = `
      precision mediump float;
      uniform vec3 u_color;
      uniform float u_opacity;
      uniform int u_mode;
      uniform int u_premultiply;
      uniform float u_hatch_angle;
      uniform float u_hatch_spacing;
      varying float v_edge_dist;
      void main() {
        vec3 rgb = u_color;
        float alpha = 0.0;
        if (u_mode == 1) {
          float glow = clamp(1.0 - v_edge_dist, 0.0, 1.0);
          alpha = u_opacity * pow(glow, 1.55);
        } else if (u_mode == 2) {
          float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          float feather = clamp(1.0 - v_edge_dist - noise * 0.14, 0.0, 1.0);
          rgb = mix(u_color * 0.7, u_color, feather);
          alpha = u_opacity * pow(feather, 1.25);
        } else if (u_mode == 4) {
          float rad = radians(u_hatch_angle);
          float proj = gl_FragCoord.x * cos(rad) + gl_FragCoord.y * sin(rad);
          float spacing = max(4.0, u_hatch_spacing);
          float stripe = step(0.56, fract(proj / spacing));
          alpha = u_opacity * (0.14 + 0.72 * stripe);
        } else if (u_mode == 5) {
          alpha = u_opacity;
        }
        gl_FragColor = u_premultiply == 1 ? vec4(rgb * alpha, alpha) : vec4(rgb, alpha);
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
    this.onReadyChange?.(Boolean(this.program && this.vbo));
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
    const activePolys = modeCode === 4 ? this.fillHatchPolys : this.ribbonPolys;
    const renderBlendedFills = this.blendMode !== "normal" && this.territoryFillPolys.length > 0;
    if (!renderBlendedFills && (modeCode === 0 || activePolys.length === 0)) return;

    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    const useMultiply = this.blendMode === "multiply";
    if (useMultiply) {
      gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else if (this.blendMode === "overlay" || this.blendMode === "soft-light") {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    const uMatrix = gl.getUniformLocation(this.program, "u_matrix");
    const uBandMercator = gl.getUniformLocation(this.program, "u_band_mercator");
    const uOpacity = gl.getUniformLocation(this.program, "u_opacity");
    const uMode = gl.getUniformLocation(this.program, "u_mode");
    const uPremultiply = gl.getUniformLocation(this.program, "u_premultiply");
    const uHatchAngle = gl.getUniformLocation(this.program, "u_hatch_angle");
    const uHatchSpacing = gl.getUniformLocation(this.program, "u_hatch_spacing");
    const uColor = gl.getUniformLocation(this.program, "u_color");

    gl.uniformMatrix4fv(uMatrix, false, matrix);
    gl.uniform1i(uPremultiply, useMultiply ? 1 : 0);
    gl.uniform1f(uHatchAngle, this.hatchAngleDeg);
    gl.uniform1f(uHatchSpacing, this.hatchSpacingPx);

    const aPos = gl.getAttribLocation(this.program, "a_pos");
    const aEdgeDist = gl.getAttribLocation(this.program, "a_edge_dist");
    const aInward = gl.getAttribLocation(this.program, "a_inward");

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 5 * 4;
    if (aPos >= 0) {
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    }
    if (aEdgeDist >= 0) {
      gl.enableVertexAttribArray(aEdgeDist);
      gl.vertexAttribPointer(aEdgeDist, 1, gl.FLOAT, false, stride, 8);
    }
    if (aInward >= 0) {
      gl.enableVertexAttribArray(aInward);
      gl.vertexAttribPointer(aInward, 2, gl.FLOAT, false, stride, 12);
    }

    if (renderBlendedFills) {
      gl.uniform1f(uBandMercator, 0);
      gl.uniform1i(uMode, 5);
      for (const poly of this.territoryFillPolys) {
        if (poly.verticesMercator.length < 15) continue;
        gl.uniform1f(uOpacity, Math.max(0.05, Math.min(0.95, poly.opacity)));
        gl.uniform3f(uColor, poly.colorRgb[0] / 255, poly.colorRgb[1] / 255, poly.colorRgb[2] / 255);
        gl.bufferData(gl.ARRAY_BUFFER, poly.verticesMercator, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, poly.verticesMercator.length / 5);
      }
    }

    if (modeCode !== 0 && activePolys.length > 0) {
      const zoom = this.mapInstance ? this.mapInstance.getZoom() : 4.5;
      const worldPx = 512 * 2 ** Math.max(0.5, zoom);
      const bandMercator = modeCode === 4 ? 0 : Math.max(0.0002, Math.min(0.025, this.bandWidthPx / worldPx));
      gl.uniform1f(uBandMercator, bandMercator);
      gl.uniform1f(uOpacity, Math.max(0.05, Math.min(0.95, this.opacity)));
      gl.uniform1i(uMode, modeCode);
      for (const poly of activePolys) {
        if (poly.verticesMercator.length < 15) continue;
        gl.uniform3f(uColor, poly.colorRgb[0] / 255, poly.colorRgb[1] / 255, poly.colorRgb[2] / 255);
        gl.bufferData(gl.ARRAY_BUFFER, poly.verticesMercator, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, poly.verticesMercator.length / 5);
      }
    }
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext): void {
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.program) gl.deleteProgram(this.program);
    this.vbo = null;
    this.program = null;
  }
}

/**
 * Concave-safe inward normal + miter-clamped buffer in Mercator coordinates.
 * Eliminates centroid radial collapse on U-shaped, concave, or elongated polities.
 */
export function buildConcaveSafeInwardRibbonBuffer(
  ring: readonly Position[],
  colorRgb: [number, number, number],
  zoom: number,
  bandWidthPx: number,
): BorderShaderPolyBuffer {
  const ccw = normalizeRingWinding(ring, true);
  if (ccw.length < 4) return { colorRgb, verticesMercator: new Float32Array(0) };

  const mercPts = ccw.slice(0, -1).map((p) => {
    const mc = maplibregl.MercatorCoordinate.fromLngLat([p[0] ?? 0, p[1] ?? 0]);
    return { x: mc.x, y: mc.y };
  });
  const n = mercPts.length;
  if (n < 3) return { colorRgb, verticesMercator: new Float32Array(0) };

  const worldPx = 512 * 2 ** Math.max(0.5, zoom);
  const targetStep = Math.max(0.0002, Math.min(0.025, bandWidthPx / worldPx));

  const inwardDirs: Array<{ dx: number; dy: number }> = [];
  for (let i = 0; i < n; i++) {
    const prev = mercPts[(i + n - 1) % n]!;
    const cur = mercPts[i]!;
    const next = mercPts[(i + 1) % n]!;

    const e1x = cur.x - prev.x;
    const e1y = cur.y - prev.y;
    const l1 = Math.max(1e-9, Math.hypot(e1x, e1y));
    const n1x = e1y / l1;
    const n1y = -e1x / l1;

    const e2x = next.x - cur.x;
    const e2y = next.y - cur.y;
    const l2 = Math.max(1e-9, Math.hypot(e2x, e2y));
    const n2x = e2y / l2;
    const n2y = -e2x / l2;

    const bx = n1x + n2x;
    const by = n1y + n2y;
    const bl = Math.max(1e-9, Math.hypot(bx, by));
    const mx = bx / bl;
    const my = by / bl;
    const dot = Math.max(0.45, mx * n2x + my * n2y);
    const miterFactor = Math.min(2.0, 1.0 / dot);
    const localClamp = Math.min(1.0, (Math.min(l1, l2) * 0.48) / Math.max(1e-6, targetStep));
    inwardDirs.push({
      dx: mx * miterFactor * localClamp,
      dy: my * miterFactor * localClamp,
    });
  }

  const floats: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = mercPts[i]!;
    const b = mercPts[j]!;
    const da = inwardDirs[i]!;
    const db = inwardDirs[j]!;
    floats.push(
      a.x, a.y, 0.0, 0.0, 0.0,
      b.x, b.y, 0.0, 0.0, 0.0,
      a.x, a.y, 1.0, da.dx, da.dy,
      b.x, b.y, 0.0, 0.0, 0.0,
      b.x, b.y, 1.0, db.dx, db.dy,
      a.x, a.y, 1.0, da.dx, da.dy,
    );
  }
  return { colorRgb, verticesMercator: new Float32Array(floats) };
}

/**
 * Full-interior ear-clipped triangle buffer for `occupation_hatch_frontline`
 * so diagonal hatch lines fill the entire occupied territory (not only margins).
 */
export function buildPolygonHatchBuffer(
  ring: readonly Position[],
  colorRgb: [number, number, number],
): BorderShaderPolyBuffer {
  const tris = triangulatePolygonRing(ring);
  const floats: number[] = [];
  for (const [p0, p1, p2] of tris) {
    const m0 = maplibregl.MercatorCoordinate.fromLngLat([p0[0] ?? 0, p0[1] ?? 0]);
    const m1 = maplibregl.MercatorCoordinate.fromLngLat([p1[0] ?? 0, p1[1] ?? 0]);
    const m2 = maplibregl.MercatorCoordinate.fromLngLat([p2[0] ?? 0, p2[1] ?? 0]);
    floats.push(
      m0.x, m0.y, 0.5, 0.0, 0.0,
      m1.x, m1.y, 0.5, 0.0, 0.0,
      m2.x, m2.y, 0.5, 0.0, 0.0,
    );
  }
  return { colorRgb, verticesMercator: new Float32Array(floats) };
}

export function buildTerritoryFillBuffer(
  ring: readonly Position[],
  colorRgb: [number, number, number],
  opacity: number,
): TerritoryFillPolyBuffer {
  const base = buildPolygonHatchBuffer(ring, colorRgb);
  return { ...base, opacity };
}
