import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import type { SourceDocument, VideoExportJobSpec } from "@historical-cartography/shared-schema";

export interface RenderVideoOptions {
  page_url: string;
  output_directory: string;
  ffmpeg_executable: string;
  browser_executable?: string;
  frame_timeout_ms?: number;
  duration_sec: number;
  revision_cues: readonly { from_frame: number; revision_id: string }[];
  t1_sources?: readonly SourceDocument[];
}

export interface CapturedFrame {
  frame_index: number;
  time_ms: number;
  revision_id: string;
  sha256: string;
}

export interface RenderedVideo {
  directory: string;
  video_path: string;
  manifest_path: string;
  frame_count: number;
  width: number;
  height: number;
  video_sha256: string;
}

interface FrameReceipt {
  accepted: boolean;
  frame_index: number;
  time_ms: number;
  revision_id: string;
  signals: { map_idle: boolean; fonts_loaded: boolean; shaders_ready: boolean; tiles_loaded: boolean;
    revision_id: string; frame_index: number; time_ms: number };
  g5_gate: { gate: string; passed: boolean; issues: { code?: string; message?: string }[] };
}

const OUTPUT_FORMATS = {
  MP4_H264: { name: "map.mp4", args: ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"], audio: "aac", alpha: false },
  MP4_HEVC: { name: "map.mp4", args: ["-c:v", "libx265", "-preset", "fast", "-crf", "20", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-movflags", "+faststart"], audio: "aac", alpha: false },
  WEBM_ALPHA: { name: "map.webm", args: ["-c:v", "libvpx-vp9", "-crf", "18", "-b:v", "0", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0"], audio: "libopus", alpha: true },
  PRORES_4444: { name: "map.mov", args: ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le"], audio: "pcm_s16le", alpha: true },
} as const;

const heights = { "1080p": 1080, "1440p": 1440, "4K": 2160 } as const;
const ratio = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "21:9": [21, 9] } as const;

function dimensions(spec: VideoExportJobSpec): { width: number; height: number } {
  if (!Object.hasOwn(heights, spec.resolution) || !Object.hasOwn(ratio, spec.aspect_ratio)) {
    throw new RangeError("Unsupported render size or aspect ratio");
  }
  const shortEdge = heights[spec.resolution];
  const [x, y] = ratio[spec.aspect_ratio];
  const scale = shortEdge / Math.min(x, y);
  return { width: Math.round(x * scale / 2) * 2, height: Math.round(y * scale / 2) * 2 };
}

function localPage(input: string): URL {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.username || url.password) {
    throw new Error("The offline video renderer requires a local scene URL");
  }
  return url;
}

async function within<T>(work: Promise<T>, milliseconds: number, label: string): Promise<T> {
  const signal = AbortSignal.timeout(milliseconds);
  let expiration: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      expiration = () => reject(new Error(label + " exceeded the frame deadline"));
      signal.addEventListener("abort", expiration, { once: true });
    })]);
  } finally {
    if (expiration) signal.removeEventListener("abort", expiration);
  }
}

async function inspectFrame(page: Page, index: number, time: number, revision: string, deadline: number): Promise<void> {
  const response = await within(page.evaluate(async (timeMs) => {
    const target = globalThis as unknown as { __STEP_FRAME__?: (at: number) => Promise<unknown> };
    if (typeof target.__STEP_FRAME__ !== "function") throw new Error("Render page is missing __STEP_FRAME__");
    return target.__STEP_FRAME__(timeMs);
  }, time), deadline, "Frame " + index) as FrameReceipt | null;

  if (response?.frame_index !== index || response.time_ms !== time || response.revision_id !== revision
      || response.signals?.frame_index !== index || response.signals.time_ms !== time || response.signals.revision_id !== revision) {
    throw new Error("G5 rejected stale or unexpected frame state at frame " + index);
  }
  const signals = response.signals;
  if (response.accepted !== true || ![signals.map_idle, signals.tiles_loaded, signals.fonts_loaded, signals.shaders_ready]
    .every((ready) => ready === true) || response.g5_gate?.gate !== "G5" || response.g5_gate.passed !== true
      || !Array.isArray(response.g5_gate.issues) || response.g5_gate.issues.length > 0) {
    const reasons = response.g5_gate?.issues?.map((issue) => issue.code ?? issue.message).join(", ");
    throw new Error("G5 rejected frame " + index + (reasons ? " (" + reasons + ")" : ""));
  }
}

function subtitleTimestamp(seconds: number): string {
  const millis = Math.round(seconds * 1000);
  return [Math.floor(millis / 3_600_000), Math.floor(millis / 60_000) % 60, Math.floor(millis / 1000) % 60]
    .map((value) => String(value).padStart(2, "0")).join(":") + "," + String(millis % 1000).padStart(3, "0");
}

function subtitleFile(spec: VideoExportJobSpec, duration: number): string {
  const entries = spec.hud_widgets.flatMap((widget) => {
    const { text } = widget.data_binding;
    if (widget.type !== "SUBTITLE_BAR" || typeof text !== "string" || !text.trim()
      || !Number.isFinite(widget.visible_from_sec) || !Number.isFinite(widget.visible_to_sec)) return [];
    const start = Math.max(0, widget.visible_from_sec);
    const end = Math.min(duration, widget.visible_to_sec);
    return end > start ? [{ start, end, text: text.replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n").trim() }] : [];
  }).sort((a, b) => a.start - b.start);
  return entries.map(({ start, end, text }, i) =>
    [i + 1, subtitleTimestamp(start) + " --> " + subtitleTimestamp(end), text, ""].join("\n")).join("\n");
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function renderMapVideo(spec: VideoExportJobSpec, options: RenderVideoOptions): Promise<RenderedVideo> {
  const pageUrl = localPage(options.page_url);
  if (spec.output_format === "INTERACTIVE_WEB_BUNDLE" || !Object.hasOwn(OUTPUT_FORMATS, spec.output_format)) {
    throw new Error("This renderer accepts encoded video export formats");
  }
  if (spec.fps !== 30 && spec.fps !== 60) throw new RangeError("Video frame rate must be 30 or 60");
  const frameCount = Math.round(options.duration_sec * spec.fps);
  const deadline = options.frame_timeout_ms ?? 15_000;
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || !Number.isFinite(deadline) || deadline < 1) {
    throw new RangeError("An export needs a positive frame count and frame deadline");
  }
  const cues = options.revision_cues;
  if (!cues.length || cues[0]?.from_frame !== 0 || cues.some(({ from_frame, revision_id }, i) =>
    !Number.isSafeInteger(from_frame) || from_frame >= frameCount || !revision_id.trim()
    || (i > 0 && from_frame <= cues[i - 1]!.from_frame))) {
    throw new Error("Render revisions must start at frame 0 and mark increasing frame indices");
  }
  if (spec.auto_generate_bibliography_credits && !options.t1_sources) {
    throw new Error("Supply the verified sources for the requested bibliography");
  }

  let audio: string | undefined;
  if (spec.audio_narration_uri) {
    audio = spec.audio_narration_uri.startsWith("file:") ? fileURLToPath(spec.audio_narration_uri) : spec.audio_narration_uri;
    if (!isAbsolute(audio) || !(await stat(audio)).isFile()) throw new Error("Narration must be a local audio file");
  }
  const format = OUTPUT_FORMATS[spec.output_format];
  const { width, height } = dimensions(spec);
  const parent = resolve(options.output_directory);
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "cartography-"));
  const video_path = join(directory, format.name);
  const manifest_path = join(directory, "frame-manifest.json");
  const subtitles = join(directory, "subtitles.srt");
  const bibliography = join(directory, "t1-bibliography.json");
  const frames: CapturedFrame[] = [];
  let browser: Browser | undefined;
  let succeeded = false;
  try {
    browser = await chromium.launch({
      headless: true, ...(options.browser_executable ? { executablePath: options.browser_executable } : {}),
    });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const failures: string[] = [];
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === pageUrl.origin) await route.continue();
      else {
        failures.push("A frame resource requested a different origin");
        await route.abort();
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failures.push("Frame resource returned HTTP " + response.status());
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText;
      if (failure && failure !== "net::ERR_ABORTED") failures.push("Frame resource failed: " + failure);
    });
    await page.goto(pageUrl.href, { waitUntil: "load", timeout: deadline });
    await page.waitForFunction(() => {
      const target = globalThis as unknown as { __STEP_FRAME__?: unknown; __CARTO_LOAD_RENDER_JOB__?: unknown };
      return typeof target.__STEP_FRAME__ === "function" && typeof target.__CARTO_LOAD_RENDER_JOB__ === "function";
    }, null, { timeout: deadline });
    const loaded = await within(page.evaluate(async (job) => {
      const target = globalThis as unknown as {
        __CARTO_LOAD_RENDER_JOB__: (spec: VideoExportJobSpec) => Promise<unknown>;
      };
      return target.__CARTO_LOAD_RENDER_JOB__(job);
    }, spec), deadline, "Render job setup") as { accepted: boolean; project_id: string } | null;
    if (loaded?.accepted !== true || loaded.project_id !== spec.project_id) {
      throw new Error("Render page did not acknowledge the supplied project");
    }

    const encoder = spawn(options.ffmpeg_executable, [
      "-hide_banner", "-loglevel", "error", "-n", "-f", "image2pipe", "-framerate", String(spec.fps), "-i", "pipe:0",
      ...(audio ? ["-protocol_whitelist", "file", "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:a", format.audio,
        "-af", "apad", "-shortest"] : ["-an"]),
      ...format.args, "-frames:v", String(frameCount), video_path,
    ], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    encoder.stderr.setEncoding("utf8");
    encoder.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-8_000); });
    encoder.stdin.on("error", () => { /* Individual writes and encoder exit surface the failure. */ });
    const exit = new Promise<{ code: number | null; error?: Error }>((done) => {
      encoder.once("error", (error) => done({ code: null, error }));
      encoder.once("close", (code) => done({ code }));
    });
    try {
      let cueIndex = 0;
      for (let frame = 0; frame < frameCount; frame++) {
        if (cues[cueIndex + 1]?.from_frame === frame) cueIndex++;
        const revisionId = cues[cueIndex]!.revision_id;
        const timeMs = frame * 1000 / spec.fps;
        await inspectFrame(page, frame + 1, timeMs, revisionId, deadline);
        if (failures.length) throw new Error("G5 rejected frame " + (frame + 1) + ": " + failures[0]);
        const captured = await page.screenshot({ type: "png", omitBackground: format.alpha, timeout: deadline });
        if (failures.length) throw new Error("G5 rejected captured frame " + (frame + 1) + ": " + failures[0]);
        frames.push({ frame_index: frame + 1, time_ms: timeMs, revision_id: revisionId,
          sha256: createHash("sha256").update(captured).digest("hex") });
        await within(new Promise<void>((accept, reject) =>
          encoder.stdin.write(captured, (error) => error ? reject(error) : accept())
        ), deadline, "Encoding frame " + (frame + 1));
      }
      encoder.stdin.end();
      const result = await exit;
      if (result.error || result.code !== 0) throw result.error ?? new Error("FFmpeg failed: " + stderr.trim());
    } catch (error) {
      encoder.stdin.destroy();
      encoder.kill();
      const result = await exit;
      if (result.error) throw result.error;
      throw error;
    }

    const video_sha256 = await fileSha256(video_path);
    if (spec.auto_generate_srt) await writeFile(subtitles, subtitleFile(spec, frameCount / spec.fps), { flag: "wx" });
    if (spec.auto_generate_bibliography_credits) {
      const sources = options.t1_sources!.filter((source) => source.credibility_tier === "T1_PRIMARY_AND_LOCAL_ACADEMIC");
      const unique = [...new Map(sources.map((source) => [source.source_doc_id, source])).values()];
      const publicSources = unique.map(({ source_doc_id, title, authors, publication_year, source_url, archive_snapshot_url }) =>
        ({ source_doc_id, title, authors, publication_year, source_url, archive_snapshot_url }));
      await writeFile(bibliography, JSON.stringify(publicSources, null, 2) + "\n", { flag: "wx" });
    }
    await writeFile(manifest_path, JSON.stringify({
      project_id: spec.project_id,
      job_sha256: createHash("sha256").update(JSON.stringify(spec)).digest("hex"),
      width, height, fps: spec.fps, video_sha256, frame_count: frameCount, frames,
    }, null, 2) + "\n", { flag: "wx" });
    succeeded = true;
    return { directory, video_path, manifest_path, frame_count: frameCount, width, height, video_sha256 };
  } finally {
    await browser?.close().catch(() => {});
    if (!succeeded) {
      for (const path of [video_path, manifest_path, subtitles, bibliography]) {
        await unlink(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      await rmdir(directory);
    }
  }
}
