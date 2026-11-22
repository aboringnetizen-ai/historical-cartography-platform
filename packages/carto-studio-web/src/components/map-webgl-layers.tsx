import maplibregl from "maplibre-gl";
import type { BasemapId, BorderShaderMode } from "@historical-cartography/shared-schema";

export interface RealBasemapRenderTheme {
  tileUrl: string;
  rasterSaturation: number;
  rasterBrightnessMin: number;
  rasterBrightnessMax: number;
  rasterContrast: number;
  rasterHueRotate: number;
  rasterOpacity: number;
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

export function getRealBasemapTheme(
  basemapId: BasemapId,
  desaturation: number,
  hillshadeExaggeration: number,
): RealBasemapRenderTheme {
  const desat = Math.max(0, Math.min(1, desaturation));
  switch (basemapId) {
    case "hypsometric_dem":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -desat * 0.45,
        rasterBrightnessMin: 0.08,
        rasterBrightnessMax: 0.96,
        rasterContrast: 0.14,
        rasterHueRotate: 0,
        rasterOpacity: 0.95,
        bgHex: "#d5dce6",
        oceanFillHex: "#b7b8f0",
        shorelineHex: "#ffffff",
        riverHex: "#2563eb",
        hillshadeHighlightHex: "#ffffff",
        hillshadeShadowHex: "#182230",
        hillshadeExaggerationBoost: Math.min(1, 0.55 + hillshadeExaggeration * 0.35),
        reliefOverlayOpacity: 0.72,
        isDark: false,
      };
    case "swiss_relief_engraved":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -Math.max(0.25, desat),
        rasterBrightnessMin: 0.12,
        rasterBrightnessMax: 0.98,
        rasterContrast: 0.18,
        rasterHueRotate: 0,
        rasterOpacity: 0.92,
        bgHex: "#dfe5ea",
        oceanFillHex: "#c2dbf2",
        shorelineHex: "#334155",
        riverHex: "#3b76b8",
        hillshadeHighlightHex: "#fffbeb",
        hillshadeShadowHex: "#334155",
        hillshadeExaggerationBoost: Math.min(1, 0.6 + hillshadeExaggeration * 0.35),
        reliefOverlayOpacity: 0.65,
        isDark: false,
      };
    case "alabaster_clay_relief":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -1,
        rasterBrightnessMin: 0.32,
        rasterBrightnessMax: 1.0,
        rasterContrast: 0.22,
        rasterHueRotate: 0,
        rasterOpacity: 0.96,
        bgHex: "#f1f3f5",
        oceanFillHex: "#c0bded",
        shorelineHex: "#ffffff",
        riverHex: "#3b82f6",
        hillshadeHighlightHex: "#ffffff",
        hillshadeShadowHex: "#3b4252",
        hillshadeExaggerationBoost: Math.min(1, 0.65 + hillshadeExaggeration * 0.35),
        reliefOverlayOpacity: 0.75,
        isDark: false,
      };
    case "satellite_natural":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -desat * 0.4,
        rasterBrightnessMin: 0.0,
        rasterBrightnessMax: 0.95,
        rasterContrast: 0.08,
        rasterHueRotate: 0,
        rasterOpacity: 0.95,
        bgHex: "#182433",
        oceanFillHex: "#1c334d",
        shorelineHex: "#e2e8f0",
        riverHex: "#60a5fa",
        hillshadeHighlightHex: "#f8fafc",
        hillshadeShadowHex: "#0f172a",
        hillshadeExaggerationBoost: Math.min(1, 0.45 + hillshadeExaggeration * 0.3),
        reliefOverlayOpacity: 0.45,
        isDark: true,
      };
    case "satellite_dark_mono":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -1,
        rasterBrightnessMin: 0.0,
        rasterBrightnessMax: 0.36,
        rasterContrast: 0.25,
        rasterHueRotate: 0,
        rasterOpacity: 0.98,
        bgHex: "#15181e",
        oceanFillHex: "#1d2430",
        shorelineHex: "#f8fafc",
        riverHex: "#64748b",
        hillshadeHighlightHex: "#64748b",
        hillshadeShadowHex: "#090d14",
        hillshadeExaggerationBoost: Math.min(1, 0.5 + hillshadeExaggeration * 0.35),
        reliefOverlayOpacity: 0.55,
        isDark: true,
      };
    case "antique_parchment":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -0.78,
        rasterBrightnessMin: 0.22,
        rasterBrightnessMax: 0.92,
        rasterContrast: 0.12,
        rasterHueRotate: 25,
        rasterOpacity: 0.58,
        bgHex: "#e6dcc2",
        oceanFillHex: "#cbd7d9",
        shorelineHex: "#5c4d3c",
        riverHex: "#3e699c",
        hillshadeHighlightHex: "#fef9ec",
        hillshadeShadowHex: "#6b5a44",
        hillshadeExaggerationBoost: Math.min(1, 0.42 + hillshadeExaggeration * 0.3),
        reliefOverlayOpacity: 0.48,
        isDark: false,
      };
    case "modern_reference":
      return {
        tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}",
        rasterSaturation: -Math.max(0.35, desat),
        rasterBrightnessMin: 0.14,
        rasterBrightnessMax: 0.98,
        rasterContrast: 0.1,
        rasterHueRotate: 0,
        rasterOpacity: 0.85,
        bgHex: "#e5ecf2",
        oceanFillHex: "#bdd8f1",
        shorelineHex: "#475569",
        riverHex: "#3b82f6",
        hillshadeHighlightHex: "#ffffff",
        hillshadeShadowHex: "#475569",
        hillshadeExaggerationBoost: Math.min(1, 0.35 + hillshadeExaggeration * 0.25),
        reliefOverlayOpacity: 0.4,
        isDark: false,
      };
  }
}

export interface BorderShaderRingBuffer {
  colorRgb: [number, number, number];
  verticesMercator: Float32Array;
}

/**
 * Custom WebGL layer implementing inward band glow (`inner_band_glow`),
 * antique watercolor perimeter vignette (`watercolor_vignette`), and crisp diagonal
 * occupation hatch (`occupation_hatch_frontline`) inside MapLibre's WebGL pass.
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
          gl_FragColor = vec4(u_color, u_opacity * pow(glow, 1.45));
        } else if (u_mode == 2) {
          float feather = smoothstep(0.0, 1.0, 1.0 - v_edge_dist);
          vec3 edgeTint = mix(u_color * 0.72, u_color, feather);
          gl_FragColor = vec4(edgeTint, u_opacity * pow(feather, 1.15) * 0.92);
        } else if (u_mode == 4) {
          float rad = radians(u_hatch_angle);
          float proj = gl_FragCoord.x * cos(rad) + gl_FragCoord.y * sin(rad);
          float stripe = step(0.54, fract(proj / 8.0));
          gl_FragColor = vec4(u_color, u_opacity * (0.12 + 0.64 * stripe));
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
    gl.uniform1f(uOpacity, Math.max(0.08, Math.min(0.88, this.opacity * (this.bandWidthPx / 15))));
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
