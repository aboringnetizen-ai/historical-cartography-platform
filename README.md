# Historical Cartography Platform（历史地理考证与历史地图制图平台）
### 基于 **SPEC v4.0** 规范构建的历史地理考证、共享弧段平面拓扑建模与交互式制图导出平台。系统将文献考证门禁（`T1/T2/T3` 可信度溯源）、双时态共享弧段拓扑、控制力梯度建模、WebGL/MapLibre 多层样式渲染与视频导播合成整合于同一 Monorepo 中。
---
## 核心特性
- **零缝隙共享弧段平面拓扑（Shared-Arc Planar Topology）**
  - 内部边界只存储 1 条 `SharedBoundaryArc`（通过 `left_face_id` / `right_face_id` 双向闭合成 `TerritorialFace`），杜绝独立多边形拼合产生的缝隙、重叠与平滑撕裂；
  - 纯疆域模式（`PURE_TERRITORY`）下同政权子面自动无缝融合，控制力模式（`CONTROL_INTENSITY`）通过 `control_score`（0–100）与 `control_semantic_tag`（如宗主核心、`TRIBUTARY_VASSAL` 附庸/土司二级控制力、稀疏边疆、争议区）驱动同一份快照渲染。
- **1:10m 纯自然地理 + Terrarium DEM 温和引导**
  - 历史疆域严禁套用现代省界（`admin_1/0`）；内置公元 **960–975 年中亚五期测试场景**（`960 / 962 / 968 / 970 / 975`，基于 Wikipedia `T3` 公开条目待学者精修），吸附 1:10m 海岸线（波斯湾、里海、未干涸历史咸海）与主河道（阿姆-喷赤、锡尔、阿特雷克、乌拉尔、阿克苏、叶尔羌、塔里木），结合本地 Zoom 6 DEM 高程实现精细自然陆界。
  - 现代参考国界（`public/gis/modern_borders.geojson`）已剔除第三方涉华冲突线段并采用中国官方标准边界（`CHN_OFFICIAL`）。
- **文献溯源门禁与双纪年时间轴**
  - 任何边界变更需绑定 `HistoricalEvent` 与 `EvidenceCitation`；`scholar-agent` 提供检索、OCR 与原文核验门禁（`T3` 百科线索仅作待复核底稿，不得直接冒充 `T1` 定论）；
  - 全系统采用连续儒略日（`julian_day_number`）桥接公元前后（无公元 0 年），支持世纪至小时级无缝缩放。
- **制图防碰撞与视频导播导出**
  - `CIEDE2000` 邻接四色防撞与宗主同色系继承；
  - `Polylabel` 避洞置标、缩放分层地名避让（`label_priority`）及小窗国名安全区夹紧；
  - 支持 4 态同步卷帘对照（古今对照 / 双模对照 / 事件前后对比）、60Hz 镜头遥测录制与确定性帧门禁视频导出。
---
## Monorepo 目录结构
| 目录 / 包 | 说明 |
| :--- | :--- |
| `packages/shared-schema` | `@historical-cartography/shared-schema`：冻结核心数据结构（`canonical.ts`）、JDN 历法与门禁校验 |
| `packages/topo-core` | 共享弧段平面拓扑内核、事件驱动事务变更集（`SpatialChangeSet`）与 PostGIS 集成 |
| `packages/scholar-agent` | 学术文献检索、授权文本摄入、OCR 与 MCP 工具集（`T1/T2/T3` 证据验证） |
| `packages/carto-studio-web` | React + Vite + MapLibre GL 交互式历史地图制图工作台与视频导播界面 |
| `packages/video-renderer` | 确定性地图视频渲染管线与帧门禁集成 |
| `scripts/studio-api.ts` | 本地后端只读/投影联调 API 服务入口 |
| `docs/` & `INVARIANTS.md` | 系统架构状态（`architecture-state.json`）、不变量约定与多 Agent 协作手册 |
| `packages/carto-studio-web/border.md` | **历史边界制作与学术制图规范**（给各 Agent 的几何、控制力、内战与遗址标注细则） |
---
## 快速开始
### 环境要求
- **Node.js `>= 22.18.0`**（含 npm workspaces）
### 1. 安装依赖与全仓检查
```bash
npm install
npm run check
```
> `npm run check` 会运行全仓 TypeScript 类型检查与 28 项单元测试（涵盖 `shared-schema`、`scholar-agent`、`carto-studio-web`）。
### 2. 启动前端制图工作台
- **方式 A（命令行开发/预览）**：
  ```bash
  npm --workspace @historical-cartography/carto-studio-web run build
  npm --workspace @historical-cartography/carto-studio-web run preview
  ```
- **方式 B（Windows 一键双击启动）**：
  直接双击运行 [`packages/carto-studio-web/start-studio.bat`](packages/carto-studio-web/start-studio.bat)，将自动打开 `http://127.0.0.1:4179/`。
### 3. 重建离线原始 GIS / DEM 缓存（可选）
为控制仓库体积，`packages/carto-studio-web/data/raw-gis/`（约 85 MB 原始下载文件）已加入 `.gitignore`。如需重新编译 960–975 中亚拓扑，请先拉取本地物理数据：
```bash
cd packages/carto-studio-web
node scripts/fetch-real-gis.mjs
node scripts/fetch-dem-ca.mjs
node scripts/build-central-asia-960-975.mjs
```
---
## 常用脚本
- `npm run typecheck`：全仓 `tsc` 类型检查
- `npm test`：运行 `packages/**/*.test.ts` 单元测试
- `npm run check`：同时执行 `typecheck` 与 `test`
- `npm run studio:api`：启动后端联调 API（`scripts/studio-api.ts`）
- `npm run test:scholar-topology`：运行跨模块学术与拓扑集成测试（需对应后端服务配置）
---
## Agent 协作与边界规范
开始开发或交接新历史时期制图任务前，请先阅读：
1. [`INVARIANTS.md`](INVARIANTS.md) 与 [`AGENTS.md`](AGENTS.md)
2. [`packages/carto-studio-web/border.md`](packages/carto-studio-web/border.md)（含共享弧段、防现代政区套壳、二级附庸/土司控制力、内战正统分级与“不知则问”学术铁律）
3. ---
## 开源协议
本项目采用 **Apache License 2.0** 开源协议，详见 [`LICENSE`](https://www.apache.org/licenses/LICENSE-2.0.html)。
