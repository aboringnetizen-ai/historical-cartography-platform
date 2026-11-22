import type { GateIssue, GateResult } from "@historical-cartography/shared-schema";
import type { AspectSafeAreaLayout } from "../director/recorder-and-hud.ts";
import type { LabelLayoutReport } from "../layout/label-collision.ts";

export interface FrameReadinessSignals {
  map_idle: boolean;
  fonts_loaded: boolean;
  shaders_ready: boolean;
  tiles_loaded: boolean;
  revision_id: string;
  frame_index: number;
  time_ms: number;
}

export interface DeterministicFaultFlags {
  force_map_not_idle?: boolean;
  force_fonts_not_loaded?: boolean;
  force_shaders_not_ready?: boolean;
  force_tiles_incomplete?: boolean;
}

export interface StepFrameResult {
  accepted: boolean;
  frame_index: number;
  time_ms: number;
  revision_id: string;
  signals: FrameReadinessSignals;
  g5_gate: GateResult;
}

export type StepFrameHandler = (timeMs: number) => Promise<void> | void;

export class DeterministicFrameBridge {
  private frameCounter = 0;
  private currentTimeMs = 0;
  private revisionId = "rev-init";
  private mapIdle = true;
  private fontsLoaded = true;
  private shadersReady = true;
  private tilesLoaded = true;
  private faultFlags: DeterministicFaultFlags = {};
  private onStepHandler: StepFrameHandler | undefined;
  private labelReportProvider: (() => LabelLayoutReport) | undefined;
  private hudLayoutProvider: (() => AspectSafeAreaLayout) | undefined;

  setRevision(revisionId: string): void {
    this.revisionId = revisionId;
  }

  setSignals(partial: Partial<Omit<FrameReadinessSignals, "frame_index" | "time_ms">>): void {
    if (partial.map_idle !== undefined) this.mapIdle = partial.map_idle;
    if (partial.fonts_loaded !== undefined) this.fontsLoaded = partial.fonts_loaded;
    if (partial.shaders_ready !== undefined) this.shadersReady = partial.shaders_ready;
    if (partial.tiles_loaded !== undefined) this.tilesLoaded = partial.tiles_loaded;
    if (partial.revision_id !== undefined) this.revisionId = partial.revision_id;
  }

  setFaultFlags(flags: DeterministicFaultFlags): void {
    this.faultFlags = { ...flags };
  }

  registerHandlers(params: {
    onStep?: StepFrameHandler;
    getLabelReport?: () => LabelLayoutReport;
    getHudLayout?: () => AspectSafeAreaLayout;
  }): void {
    this.onStepHandler = params.onStep;
    this.labelReportProvider = params.getLabelReport;
    this.hudLayoutProvider = params.getHudLayout;
  }

  snapshotSignals(): FrameReadinessSignals {
    return {
      map_idle: this.faultFlags.force_map_not_idle ? false : this.mapIdle,
      fonts_loaded: this.faultFlags.force_fonts_not_loaded ? false : this.fontsLoaded,
      shaders_ready: this.faultFlags.force_shaders_not_ready ? false : this.shadersReady,
      tiles_loaded: this.faultFlags.force_tiles_incomplete ? false : this.tilesLoaded,
      revision_id: this.revisionId,
      frame_index: this.frameCounter,
      time_ms: this.currentTimeMs,
    };
  }

  evaluateG5Gate(signals: FrameReadinessSignals): GateResult {
    const issues: GateIssue[] = [];
    if (!signals.map_idle) {
      issues.push({
        gate: "G5",
        code: "FRAME_NOT_READY",
        entity_id: `frame-${signals.frame_index}`,
        message: `第 ${signals.frame_index} 帧 (${signals.time_ms}ms) 地图未进入 idle 状态（map_idle=false）。`,
      });
    }
    if (!signals.tiles_loaded) {
      issues.push({
        gate: "G5",
        code: "FRAME_NOT_READY",
        entity_id: `frame-${signals.frame_index}:tiles`,
        message: `第 ${signals.frame_index} 帧 (${signals.time_ms}ms) 底图瓦片未完整加载（tiles_loaded=false）。`,
      });
    }
    if (!signals.fonts_loaded) {
      issues.push({
        gate: "G5",
        code: "FRAME_NOT_READY",
        entity_id: `frame-${signals.frame_index}:fonts`,
        message: `第 ${signals.frame_index} 帧 (${signals.time_ms}ms) 字体字形尚未就绪（fonts_loaded=false）。`,
      });
    }
    if (!signals.shaders_ready) {
      issues.push({
        gate: "G5",
        code: "FRAME_NOT_READY",
        entity_id: `frame-${signals.frame_index}:shaders`,
        message: `第 ${signals.frame_index} 帧 (${signals.time_ms}ms) 自定义边界着色器未就绪（shaders_ready=false）。`,
      });
    }

    if (this.labelReportProvider) {
      const labelReport = this.labelReportProvider();
      for (const issue of labelReport.g5_label_gate.issues) {
        issues.push(issue);
      }
    }
    if (this.hudLayoutProvider) {
      const hudLayout = this.hudLayoutProvider();
      for (const issue of hudLayout.g5_hud_gate.issues) {
        issues.push(issue);
      }
    }

    return {
      gate: "G5",
      passed: issues.length === 0,
      issues,
    };
  }

  async stepFrame(timeMs: number): Promise<StepFrameResult> {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new RangeError(`timeMs must be finite and >= 0, got ${timeMs}`);
    }
    this.frameCounter += 1;
    this.currentTimeMs = timeMs;

    if (this.onStepHandler) {
      await this.onStepHandler(timeMs);
    }
    const g = globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } };
    if (g.document?.fonts?.ready) {
      await g.document.fonts.ready;
    }

    const signals = this.snapshotSignals();
    const g5Gate = this.evaluateG5Gate(signals);
    return {
      accepted: g5Gate.passed,
      frame_index: signals.frame_index,
      time_ms: signals.time_ms,
      revision_id: signals.revision_id,
      signals,
      g5_gate: g5Gate,
    };
  }
}

export function attachGlobalDeterministicBridge(bridge: DeterministicFrameBridge): void {
  const g = globalThis as {
    window?: {
      __STEP_FRAME__?: (timeMs: number) => Promise<StepFrameResult>;
      __CARTO_RENDER_BRIDGE__?: DeterministicFrameBridge;
    };
  };
  if (!g.window) return;
  g.window.__CARTO_RENDER_BRIDGE__ = bridge;
  g.window.__STEP_FRAME__ = (timeMs: number) => bridge.stepFrame(timeMs);
}
