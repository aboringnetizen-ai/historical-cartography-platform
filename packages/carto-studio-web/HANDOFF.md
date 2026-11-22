# 任务交接与验收记录 — `packages/carto-studio-web`

- **当前主工作状态**: 已完成公元 960–975 年中亚五期维基百科 `T3` 测试数据集、1:10m 纯自然地理 + Terrarium Z6 DEM 温和精细共享弧段平面图、中国官方标准现代参考国界合规替换、小浏览器窗口国名完整显示适配、制图规范 [border.md](border.md) 及一键启动脚本 [start-studio.bat](start-studio.bat)。
- **工作分支**: `frontend/studio`（可无缝合入 `integration/core-scholar-studio`）。

## 本轮核心交付与技术亮点

1. **彻底摆脱现代政区，实现 1:10m 纯自然地理 + DEM 温和引导共享弧段平面图**
   - [scripts/fetch-real-gis.mjs](scripts/fetch-real-gis.mjs) & [scripts/fetch-dem-ca.mjs](scripts/fetch-dem-ca.mjs)：持久化本地 1:10m Natural Earth 物理岸线/历史咸海/水系（`public/gis/*.geojson`）与 Zoom 6 Terrarium 离线高程栅格（`data/raw-gis/` 已加入 `.gitignore`，避免 85MB 原始缓存进入 Git）。
   - [scripts/lib/natural-topo-builder.mjs](scripts/lib/natural-topo-builder.mjs) & [scripts/lib/dem-pathfinder.mjs](scripts/lib/dem-pathfinder.mjs) & [scripts/build-central-asia-960-975.mjs](scripts/build-central-asia-960-975.mjs)：禁用 `admin_1` / `admin_0` 现代政区，以 1:10m 海岸线（波斯湾、里海、历史未干涸咸海）+ 12 段主河道（阿姆-喷赤、锡尔、阿特雷克、乌拉尔、阿克苏、叶尔羌、塔里木）+ Z6 DEM 温和地形走廊编译 20 个零缝隙面、69 条共享弧段（含 19 条 `NATURAL_FEATURE`）、8,589 个顶点（平均段长 4.66 km，最大 17.97 km），全部 29 座历史名城 100% 落位校验通过。
2. **公元 960–975 年中亚五期连续切片（Wikipedia `T3_GENERAL_ENCYCLOPEDIA`）**
   - [src/core/data/demo-sources-events.ts](src/core/data/demo-sources-events.ts)、[src/core/data/demo-events-960-975.ts](src/core/data/demo-events-960-975.ts)、[src/core/data/demo-dataset.ts](src/core/data/demo-dataset.ts)：覆盖 17 个政权、29 个多语地名、9 篇维基百科信源（均诚实标为 `T3_GENERAL_ENCYCLOPEDIA`）、5 期连续半开切片（960 / 962 / 968 / 970 / 975）及自动前后差异 `diff_record`。
3. **中国现代参考国界合规替换**
   - `fetch-real-gis.mjs` 已剔除 Natural Earth 涉华及 `Unrecognized` 冲突线段，全量合入中国官方标准边界（`china_standard_100000.json`，`sovereignty_pov: "CHN_OFFICIAL"`）至 `public/gis/modern_borders.geojson`；[src/components/map-webgl-layers.tsx](src/components/map-webgl-layers.tsx) 中 `modern_reference` 底图已切为无第三方国界的物理地形图，单测内置防退化守卫。
4. **小窗适配与国名防裁切**
   - [src/components/MapCanvas.tsx](src/components/MapCanvas.tsx) 补全 `ResizeObserver → map.resize()` 与视口自适应 `fitOverviewBounds`；[src/components/map-svg-overlay.tsx](src/components/map-svg-overlay.tsx) 实现视口缩放因子、`endsInsideSafe` 严格防 `<textPath>` 截断与可见区安全夹紧；[src/components/EvidenceDiffDrawer.tsx](src/components/EvidenceDiffDrawer.tsx) 支持直接展示 `PENDING_REVIEW` 下的维基 `T3` 外链与 `affected_arc_ids` 芯片。
5. **模型协作规范与一键运行**
   - 新增 [border.md](border.md)（共享弧段、有机轮廓、零空白填满、二级附庸/土司控制力、内战正统分级、多级遗址标注与“不知则问”铁律）。
   - 新增 [start-studio.bat](start-studio.bat) 一键本地启动脚本（`http://127.0.0.1:4179/`）。

## 验证命令
```powershell
Set-Location "I:\历史地图\AI赋能-frontend-studio"
npm run check
npm --workspace @historical-cartography/carto-studio-web run typecheck
npm --workspace @historical-cartography/carto-studio-web run build
```
