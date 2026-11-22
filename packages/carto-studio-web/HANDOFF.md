# 任务交接与验收记录 — `packages/carto-studio-web` (`F-01` 至 `F-04`)

- **任务号 / 标题**: `F-01` 地图工作台 · `F-02` 真实 GIS 底图与样式调色 · `F-03` 四轨研究工作台 · `F-04` 导播编辑与帧就绪协议
- **负责人 / 复核人 / 状态**: Gemini（前端主开发） / 复核待办：Codex（接口与门禁） & Claude（`Q-01`~`Q-03` 排版与画幅视觉） / 状态：`review`
- **基线 SHA / 工作分支 / 工作区位置**:
  - 基线分支与提交：`master` @ `c880eeececaef1d421bee9787929b3418d16d996`（含 Phase 0 验收提交 `b42a8c3`）
  - 工作分支：`frontend/studio`
  - 独立工作树：`I:\历史地图\AI赋能-frontend-studio`（未改动主目录 `I:\历史地图\AI赋能` 上 Codex 正在进行的 `backend/core`）
- **目标与写入路径**:
  - 工作区包 `packages/carto-studio-web/`（`@historical-cartography/carto-studio-web`）
  - 根目录 `package-lock.json`（前序工作区依赖锁定）
  - 未修改 `packages/shared-schema/*`、`INVARIANTS.md`、根 `package.json`、根 `tsconfig.json` 或 `docs/architecture-state.json`

## 完成内容与关键文件

### 1. 真实地理 GIS 数据管线与拓扑夹具
- [fetch-real-gis.mjs](scripts/fetch-real-gis.mjs) & `public/gis/{ocean,lakes,rivers,modern_borders}.geojson` + [provenance.json](public/gis/provenance.json)：抓取并持久化真实 Natural Earth 50m/10m 全球海洋、海岸线（含里海）、历史湖泊（`ne_10m_lakes_historic.geojson` 保留完整古咸海与罗布泊，及伊塞克湖、巴尔喀什湖、青海湖、贝加尔湖）、551 条欧亚水系及 390 条现代国界。
- [demo-sources-events.ts](src/core/data/demo-sources-events.ts)、[demo-sources-events-extra.ts](src/core/data/demo-sources-events-extra.ts)、[demo-dataset.ts](src/core/data/demo-dataset.ts)、[demo-dataset-extra.ts](src/core/data/demo-dataset-extra.ts)：7 套零缝隙共享弧段平面拓扑场景，对照 5 张参考截图与 SPEC 黄金用例：
  - `epoch-928-samanid-ziyarid`（默认，公元 928 年中亚萨曼王朝、齐亚尔、乌古斯、花剌子模、喀喇汗国、阿拔斯、萨法尔、印度沙希与雷伊进军）
  - `epoch-842-samanid`（公元 842 年萨曼家族河中统合、赫拉特飞地与艾哈迈德一世盾徽钉）
  - `epoch-1300-jochi-ulus`（坤舆府 · 术赤兀鲁思古卷水彩晕边风）
  - `epoch-1672-rampjaar`（1672 年 12 月 09 日 20:00 小时级法荷战役斜线占领与左侧参战花名册）
  - `epoch-1841-qing-atlas`（公元 1841 年 / 清宣宗道光 21 年史图馆典藏风与南海画中画）
  - `epoch-001bce-cross-zero`（公元前 1 年→公元 1 年跨零点）与 `contract-fixture`（Codex Phase 0 `draftSnapshot`）。

### 2. 真实 GIS 底图渲染、WebGL 着色器与 60fps 实时跟手投影
- [map-webgl-layers.tsx](src/components/map-webgl-layers.tsx) & [MapCanvas.tsx](src/components/MapCanvas.tsx)：移除伪造噪声底图，接入真实 Esri `World_Shaded_Relief` / `World_Imagery` / `World_Physical_Map` 栅格底图与 AWS Terrarium `raster-dem` GPU `hillshade` 浮雕层（真实山脉阴影穿透政权色块），叠加 Natural Earth 水系、海洋与湖泊岸线精准裁切；并在 `move` / `zoom` / `rotate` / `pitch` 每帧同步重算弧排国名、水系注记、地名符号及 [DirectorHudOverlay.tsx](src/components/DirectorHudOverlay.tsx) 地图锚定人物立绘钉，消除拖动文字滞后。
- 其余核心引擎：[snapshot-client.ts](src/core/services/snapshot-client.ts)、[style-presets.ts](src/core/styles/style-presets.ts)、[ciede2000.ts](src/core/color/ciede2000.ts)、[label-collision.ts](src/core/layout/label-collision.ts)、[timeline-math.ts](src/core/director/timeline-math.ts)、[recorder-and-hud.ts](src/core/director/recorder-and-hud.ts)、[deterministic-bridge.ts](src/core/render/deterministic-bridge.ts)。

## 验收表（本地工作树运行于 2026-11-22，Node v24.19.0 / npm 11.17.0 / Windows）

| 验收编号 | 实际命令及环境 | 输入版本与哈希 | 预期 | 实测 | 结果 | 证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| `A-00` / `A-30`~`A-34` / `A-42` | `npm run check` | `canonical.ts` `877aa14a...`; `carto-studio-core.test.ts` `298a7a07...` | 全仓 TS 编译通过，11 项测试全部 PASS | 11/11 项测试通过（含真实 GIS 资产、1300/1672/1841 场景、小时级 JDN、连续拖动投影及 G5 门禁检查） | `PASS` | `packages/carto-studio-web/test/carto-studio-core.test.ts` |
| `F-01`~`F-04` UI 类型与打包 | `npm --workspace @historical-cartography/carto-studio-web run typecheck` & `build` | 同上 | React/MapLibre v5 TSX 零错误并产出 `dist/` | TS 类型检查通过，Vite 打包成功 | `PASS` | `packages/carto-studio-web/vite.config.mts` |
| 真实 GIS 与静态预览烟测 | `vite preview --port 4183` + HTTP GET | `public/gis/*.geojson` + `dist/` | `/`, JS 与 4 份真实 GeoJSON 返回 200 | HTML 200，JS 200，`ocean`/`lakes`/`rivers`/`modern_borders.geojson` 全返回 200 | `PASS` | `packages/carto-studio-web/public/gis/provenance.json` |
| `Q-01`~`Q-03` / `A-41`~`A-50` | 无头 Chromium/Playwright & 真实后端联调 | 待集成真实服务 | 真实 WebGL 截图与逐帧像素哈希通过 | 命令沙箱未拉起 Chromium 渲染器，且后端 `topo-core`/`scholar-agent` 未联调 | `NOT_RUN` | 待集成与 Claude 复核 |

## 下一条操作与恢复命令
```powershell
Set-Location "I:\历史地图\AI赋能-frontend-studio"
git status --short
npm run check
npm --workspace @historical-cartography/carto-studio-web run typecheck
npm --workspace @historical-cartography/carto-studio-web run build
npm --workspace @historical-cartography/carto-studio-web run dev
```
