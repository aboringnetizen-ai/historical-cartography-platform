import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import type { VideoExportJobSpec } from "@historical-cartography/shared-schema";
import { renderMapVideo } from "../src/index.ts";
import type { CapturedFrame } from "../src/index.ts";

const browserExecutable = process.env.CARTOGRAPHY_TEST_BROWSER;
const ffmpeg = process.env.CARTOGRAPHY_TEST_FFMPEG;
const ffprobe = process.env.CARTOGRAPHY_TEST_FFPROBE;
if (!browserExecutable || !ffmpeg || !ffprobe) {
  throw new Error("Set the browser, FFmpeg and FFprobe executable paths in the render test environment");
}

const fixturePage = `<!doctype html><html><meta charset="utf-8"><style>
html,body,canvas { width:100%;height:100%;margin:0;display:block }
</style><canvas></canvas><script>
let job, index = 0;
window.__CARTO_LOAD_RENDER_JOB__ = async (spec) => {
  job = spec;
  return { accepted: true, project_id: job.project_id };
};
window.__STEP_FRAME__ = async (time) => {
  index++;
  await document.fonts.ready;
  const canvas = document.querySelector("canvas");
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const paint = canvas.getContext("2d");
  paint.fillStyle = "#173047";
  paint.fillRect(0, 0, canvas.width, canvas.height);
  paint.fillStyle = job.project_id === "fixture-project" ? "#348777" : "#fefefe";
  paint.fillRect(0, 0, canvas.width / 3 + time / 12, canvas.height);
  paint.fillStyle = "#e3bd7b";
  paint.fillRect(canvas.width - 140, 48, 80, 34);
  if (job.output_format === "WEBM_ALPHA" || job.output_format === "PRORES_4444") {
    paint.clearRect(canvas.width - 20, canvas.height - 20, 20, 20);
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const rejected = location.pathname === "/blocked" && index === 2;
  const revision = "fixture-revision";
  return {
    accepted: !rejected, revision_id: revision, time_ms: time, frame_index: index,
    signals: { map_idle: true, tiles_loaded: true, fonts_loaded: document.fonts.status === "loaded",
      shaders_ready: !rejected, revision_id: revision, time_ms: time, frame_index: index },
    g5_gate: { gate: "G5", passed: !rejected, issues: rejected ? [{ code: "FRAME_NOT_READY" }] : [] }
  };
};
</script></html>`;

test("headless capture is deterministic at both required aspect ratios, and G5 blocks a failed frame", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "cartography-render-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(fixturePage);
  });
  server.listen(0, "127.0.0.1");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const entry of await readdir(output, { withFileTypes: true })) {
      assert.ok(entry.isDirectory() && entry.name.startsWith("cartography-"));
      const child = join(output, entry.name);
      for (const file of await readdir(child, { withFileTypes: true })) {
        assert.ok(file.isFile());
        await unlink(join(child, file.name));
      }
      await rmdir(child);
    }
    await rmdir(output);
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = "http://127.0.0.1:" + address.port;
  const spec: VideoExportJobSpec = {
    project_id: "fixture-project", resolution: "1080p", aspect_ratio: "16:9", fps: 30, output_format: "MP4_H264",
    keyframes: [{ keyframe_id: "start", video_time_sec: 0, historical_jdn: 2390198.5, easing: "LINEAR",
      camera: { center: [0, 0], zoom: 4, bearing_deg: 0, pitch_deg: 0 } }],
    hud_widgets: [{ widget_id: "fixture-subtitle", type: "SUBTITLE_BAR", anchor: "BOTTOM_CENTER",
      visible_from_sec: 0, visible_to_sec: 3, data_binding: { text: "Backend fixture" } }],
    auto_generate_srt: true, auto_generate_bibliography_credits: false,
  };
  const options = {
    page_url: origin, ffmpeg_executable: ffmpeg, browser_executable: browserExecutable,
    output_directory: output, duration_sec: 3, revision_cues: [{ from_frame: 0, revision_id: "fixture-revision" }],
  };
  const getManifest = async (path: string) => JSON.parse(await readFile(path, "utf8")) as { frames: CapturedFrame[] };
  for (const [aspect, width, height] of [["16:9", 1920, 1080], ["9:16", 1080, 1920]] as const) {
    const first = await renderMapVideo({ ...spec, aspect_ratio: aspect }, options);
    const second = await renderMapVideo({ ...spec, aspect_ratio: aspect }, options);
    assert.equal(first.frame_count, 90);
    assert.deepEqual((await getManifest(first.manifest_path)).frames, (await getManifest(second.manifest_path)).frames);
    const probe: { stdout: string } = await promisify(execFile)(ffprobe, [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_frames,avg_frame_rate",
      "-of", "json", first.video_path,
    ]);
    assert.deepEqual(JSON.parse(probe.stdout).streams, [{ codec_name: "h264", width, height, avg_frame_rate: "30/1", nb_frames: "90" }]);
    assert.match(await readFile(join(first.directory, "subtitles.srt"), "utf8"), /00:00:00,000 --> 00:00:03,000/);
  }

  for (const [format, codec] of [["MP4_HEVC", "hevc"], ["WEBM_ALPHA", "vp9"], ["PRORES_4444", "prores"]] as const) {
    const sample = await renderMapVideo({ ...spec, output_format: format, auto_generate_srt: false }, {
      ...options, duration_sec: 0.1,
    });
    const probe: { stdout: string } = await promisify(execFile)(ffprobe, [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height",
      "-of", "json", sample.video_path,
    ]);
    assert.deepEqual(JSON.parse(probe.stdout).streams, [{ codec_name: codec, width: 1920, height: 1080 }]);
    if (format === "MP4_HEVC") continue;
    const pixel: { stdout: Buffer } = await promisify(execFile)(ffmpeg, [
      "-v", "error", ...(format === "WEBM_ALPHA" ? ["-c:v", "libvpx-vp9"] : []),
      "-i", sample.video_path, "-frames:v", "1", "-vf", "alphaextract,crop=1:1:1910:1070",
      "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ], { encoding: "buffer" });
    assert.deepEqual([...pixel.stdout], [0], format + " must keep the transparent test pixel");
  }

  const before = (await readdir(output)).sort();
  await assert.rejects(renderMapVideo(spec, { ...options, page_url: origin + "/blocked" }), /G5 rejected frame 2/);
  await assert.rejects(renderMapVideo(spec, {
    ...options, revision_cues: [{ from_frame: 0, revision_id: "unexpected" }],
  }), /unexpected frame state at frame 1/);
  assert.deepEqual((await readdir(output)).sort(), before);
});
