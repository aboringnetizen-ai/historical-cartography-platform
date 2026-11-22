# 任务交接与验收记录 — `packages/carto-studio-web` (`F-01` 至 `F-04`)

- **任务号 / 标题**: `F-01` 地图工作台 · `F-02` 底图、样式与调色 · `F-03` 四轨研究工作台 · `F-04` 导播编辑与帧就绪协议
- **负责人 / 复核人 / 状态**: Gemini（前端主开发） / 复核待办：Codex（接口与门禁） & Claude（`Q-01`~`Q-03` 排版与画幅视觉） / 状态：`review`
- **基线 SHA / 工作分支 / 工作区位置**:
  - 基线分支与提交：`master` @ `c880eeececaef1d421bee9787929b3418d16d996`（含 Phase 0 验收提交 `b42a8c3`）
  - 工作分支：`frontend/studio`
  - 独立工作树：`I:\历史地图\AI赋能-frontend-studio`（未改动主目录 `I:\历史地图\AI赋能` 上 Codex 正在进行的 `backend/core`）
- **目标与写入路径**:
  - 新增工作区包 `packages/carto-studio-web/`（`@historical-cartography/carto-studio-web`）
  - 因引入 React 19、MapLibre GL JS 5、Vite 6 等前端工作区依赖，同步更新根目录 `package-lock.json`
  - 未修改 `packages/shared-schema/*`、`INVARIANTS.md`、根 `package.json`、根 `tsconfig.json` 或 `docs/architecture-state.json`
- **依赖任务和接口样例 / SPEC 章节 / 受影响的门禁**:
  - 依赖 `C-00` 共享契约（`packages/shared-schema/src/{canonical.ts, gates.ts, historical-time.ts, service-contracts.ts}` 与 `packages/shared-schema/examples/service-examples.ts`）
  - 对齐 SPEC v4.0 第 7、8、9、10、11、12 节
  - 涉及门禁：`G5`（高优先级地名碰撞检测、`map_idle + fonts_loaded + shaders_ready` 确定性帧同步屏障、`9:16` HUD 安全区验证）；前端只读消费拓扑与证据契约，配合服务端执行 `G1–G4`

## 完成内容与关键文件

### 1. 纯 TypeScript 核心引擎（受根 `tsconfig.json` 严格检查）
- [demo-types.ts](src/core/data/demo-types.ts) & [topology-builder.ts](src/core/data/topology-builder.ts)：按 `SharedBoundaryArc` 共享弧段组装零缝隙闭合拓扑面（含赫拉特飞地内环支持），派生平滑曲线 `rendered_spline_geometry` 严格只读不反写 `canonical_geometry`。
- [demo-sources-events.ts](src/core/data/demo-sources-events.ts) & [demo-dataset.ts](src/core/data/demo-dataset.ts)：提供 `epoch-842-samanid`（公元 842 年）、`epoch-928-samanid-ziyarid`（公元 928 年萨曼—齐亚尔黄金场景，含 `0–100` 控制力、荒漠低控闭合面、`DISPUTED_OVERLAP`、`human_locked_override`、`CONSENSUS` / `T1_SCHOLARLY_DISPUTE` / `PENDING_T1_VERIFICATION` 事件及 Before/After 差异）、`epoch-001bce-cross-zero`（公元前 1 年→公元 1 年跨零点）、以及 Codex 的 `contract-fixture`（`draftSnapshot`）。
- [snapshot-client.ts](src/core/services/snapshot-client.ts)：`MapSnapshotClient`（消费 `MapSnapshotRequest` -> `MapSnapshot` 与 `EventEvidenceReader.verifyEvent`），内置单调请求序号防乱序丢弃过期响应（stale-response guard）、显式 `LOADING | READY | NO_DATA | ERROR` 状态及 `HttpSnapshotTransport` 后端切换入口。
- [style-presets.ts](src/core/styles/style-presets.ts)：全部 7 类 `BasemapId`、6 类 `BorderShaderMode`、10 套可继承旗舰预设 `ComposableStylePack`、`resolveStylePack` 继承链解析器及 5 套调色盘。
- [ciede2000.ts](src/core/color/ciede2000.ts)：精确 CIELAB + CIEDE2000 ΔE 实现、基于共享弧段 `left_face_id` / `right_face_id` 的邻接图四色防撞求解器 `solvePolityPalette`、母子政权色彩继承 `deriveInheritedPolityColor` 与 `0–100` 控制力梯度计算。
- [label-collision.ts](src/core/layout/label-collision.ts)：高优先级 `HistoricalToponym` 屏幕碰撞检测与 G5 `LABEL_COLLISION` 报告、存疑 `?` 标注、双语排版及政权中轴弧排路径生成。
- [timeline-math.ts](src/core/director/timeline-math.ts)：纯儒略日 `julian_day_number` 与 `astronomical_year` 双向转换（禁用原生 `Date`）、千年↔小时级弹性缩放、四轨数据投影与 `configureBottomTimeline`。
- [recorder-and-hud.ts](src/core/director/recorder-and-hud.ts)：60Hz 遥测采样平滑滤波 `importRecordingTelemetry`、事件/文案自动分镜 `generateVideoStoryboard`、两阶段拓扑过渡分类器 `classifyTopologyTransition`、7 类 HUD 挂件布局与 `16:9` / `9:16` / `1:1` / `21:9` 竖屏安全区自动折叠及 G5 `HUD_SAFE_AREA_VIOLATION` 校验。
- [deterministic-bridge.ts](src/core/render/deterministic-bridge.ts)：暴露 `window.__STEP_FRAME__(timeMs)`，强制校验 `map_idle + tiles_loaded + fonts_loaded + shaders_ready`（禁用固定 `setTimeout`），并提供 `A-42` 故障注入钩子。

### 2. React + MapLibre GL JS + 自定义 WebGL 工作台 UI
- [map-webgl-layers.tsx](src/components/map-webgl-layers.tsx)：离线确定性 `carto-basemap://` 程序化瓦片协议（覆盖全部 7 类底图）+ MapLibre v5 `CustomLayerInterface` WebGL 着色器（实现 `inner_band_glow`、`watercolor_vignette`、`occupation_hatch_frontline`）。
- [MapCanvas.tsx](src/components/MapCanvas.tsx)、[TopToolbar.tsx](src/components/TopToolbar.tsx)、[StyleLayerPanel.tsx](src/components/StyleLayerPanel.tsx)、[EvidenceDiffDrawer.tsx](src/components/EvidenceDiffDrawer.tsx)、[BottomTimeline.tsx](src/components/BottomTimeline.tsx)、[DirectorHudOverlay.tsx](src/components/DirectorHudOverlay.tsx)、[DirectorExportModal.tsx](src/components/DirectorExportModal.tsx)、[StudioShell.tsx](src/components/StudioShell.tsx)。

## 未完成项、阻塞原因与后端联调前置条件
1. **真实后端数据与服务切换**：当前默认使用同契约演示夹具（`DemoSnapshotTransport`）。待 Codex 交付 `topo-core` HTTP/RPC 服务、后端 AI 2 交付 `scholar-agent` 引文索引服务、Codex 交付 `video-renderer` 渲染端点后，通过 `VITE_CARTO_API_BASE` 环境变量切换 `HttpSnapshotTransport` 并跑通 `A-32` / `A-41` / `A-43` / `A-50` 真实集成验收。
2. **无头真实浏览器视觉与 Playwright 烟测**：本工作区命令沙箱无法直接启动 Chromium 渲染进程，因此尚未运行 Playwright/Chromium 对真实 WebGL 画面像素及 `Q-01`~`Q-03` 截图的视觉检查，需由 Claude 与 Codex 在具备桌面/Playwright 环境的集成端复核。

## 验收表（本地工作树运行于 2026-11-22，Node v24.19.0 / npm 11.17.0 / Windows）

| 验收编号 | 实际命令及环境 | 输入版本与哈希 | 预期 | 实测 | 结果 | 证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| `A-00` / `A-30`~`A-34` / `A-42` | `npm run check` | `canonical.ts` `877aa14a...`; `carto-studio-core.test.ts` `b247edb7...` | 全仓 TS 编译通过，10 项单元测试全部 PASS | 10/10 项测试全部通过（含共享弧段零缝隙、单快照双模式、防乱序丢弃、7底图/6着色器/10预设、CIEDE2000 邻接 ΔE>=18、跨零点JDN、G5碰撞与9:16安全区、A-42故障注入） | `PASS` | `packages/carto-studio-web/test/carto-studio-core.test.ts` |
| `F-01`~`F-04` UI 类型与打包 | `npm --workspace @historical-cartography/carto-studio-web run typecheck` & `build` | 同上 | React/MapLibre v5 TSX 零错误并产出 `dist/` | TS 类型检查通过，Vite 打包 55 模块成功 | `PASS` | `packages/carto-studio-web/vite.config.mts` |
| 预览静态服务烟测 | `node .../vite.js preview --port 4179` + HTTP GET | 本地 `dist/` | 200 OK 返回入口 HTML、JS 与 CSS | HTML 200 (匹配标题)，JS 1,443,408 bytes 200，CSS 77,464 bytes 200 | `PASS` | `packages/carto-studio-web/index.html` |
| `Q-01`~`Q-03` / `A-41`~`A-50` | 无头 Chromium/Playwright & 真实后端联调 | 待集成真实服务 | 真实 WebGL 截图与逐帧像素哈希通过 | 命令沙箱未拉起 Chromium 渲染器，且后端 `topo-core`/`scholar-agent` 未联调 | `NOT_RUN` | 待集成与 Claude 复核 |

## 建议 Codex 在集成分支合入后同步更新 `docs/architecture-state.json` 的状态增量
- `packages.carto-studio-web.status`: `"review"`
- `packages.carto-studio-web.implemented`: `["MapLibre 工作台与契约适配 (F-01)", "7底图/6着色器/10预设/CIEDE2000调色 (F-02)", "JDN四轨时间轴与证据差异抽屉 (F-03)", "60Hz遥测/7类HUD安全区/确定性帧屏障 (F-04)"]`
- `packages.carto-studio-web.remaining`: `["联调真实 topo-core 与 scholar-agent HTTP 端点", "Claude Q-01~Q-03 视觉与无头浏览器像素验收"]`

## 下一条操作与恢复命令
```powershell
Set-Location "I:\历史地图\AI赋能-frontend-studio"
git status --short
npm run check
npm --workspace @historical-cartography/carto-studio-web run typecheck
npm --workspace @historical-cartography/carto-studio-web run build
```
