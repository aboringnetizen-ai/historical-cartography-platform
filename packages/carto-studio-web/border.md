# 历史地图边界制作与拓扑构建指南（`border.md`）

> 本文档面向**学术考证 Agent**、**制图/拓扑编译 Agent** 与前端协作者，沉淀在本项目（`packages/carto-studio-web`）制作 **960–975 年中亚五期历史疆域** 期间的架构规范、避坑细节与学术建模规则。

---

## 一、核心原则与三代演进

### 1. 四条底线原则
- **禁用现代政区拼合**：严禁使用 `ne_10m_admin_1_states_provinces` 或 `admin_0` 拼合古代疆域（苏联划界、现代伊阿直边等会造成时代错置）；同时严禁让模型各自输出独立 `Polygon`（必然产生缝隙与重叠）。**唯一正解是共享弧段平面图（`SharedBoundaryArc` + `TerritorialFace`）**。
- **政权之间尽量填满，不留空白**：研究区陆地通过共享弧段无缝镶嵌（只有海洋、大湖与最外缘 `EXTERIOR_WORLD` 留作域外/水体）。荒漠、高山与无主缓冲带**不得挖空留白**：归属某政权的稀疏区设 `is_sparse_or_desert_zone: true` + `LOOSE_OR_SPARSE_FRONTIER`（20–54 分）；无单一主权的过渡/拉锯区设为闭合 `BUFFER_ZONE` 或 `DISPUTED_OVERLAP` 面。
- **不知则问，严禁臆测**：历史地图不同寻常软件，凡遇**史料缺载/多说冲突、正统性或政区考订口径未定、遗址/古河道坐标未定**，必须第一时间向用户提问确认，严禁自行脑补或编造引文；获准先出占位底稿时必须如实标注 `T3_GENERAL_ENCYCLOPEDIA`、`UNCERTAIN` 或 `T1_SCHOLARLY_DISPUTE`。

### 2. 三代边界制作对比
| 代次 | 技术路线 | 实测指标 | 结论 |
| :--- | :--- | :--- | :--- |
| 第 1 代（废弃） | `1:10m` 现代省界拼合 + 新疆经纬直切 | 20 面 / 56 弧 / 2,612 点 / 均长 19.56 km | 出现现代国界与直线切口，时代错置。 |
| 第 2 代（升级） | 纯 `1:10m` 岸线河道 + 少量手写拐点 Chaikin | 20 面 / 69 弧 / 5,889 点 / 均长 6.67 km | 岸线自然，但内陆边界显得“随意大弯”。 |
| **第 3 代（现行）** | **`1:10m` 岸线/历史咸海/河道 + 本地 Z6 DEM 温和引导** | **20 面 / 69 弧（19 自然） / 8,589 点 / 均长 4.66 km / 最大 17.97 km** | **兼具自然起伏与历史走向，29/29 城全落位**。 |

---

## 二、几何制作、地形引导与前端渲染细节

### 1. 自然水系与有机陆地轮廓（拒绝“类四边形”）
- **海岸与历史湖泊**：潮汐海湾/河口（如波斯湾西北端）严禁大阈值抽稀，必须保持 **`dpEps = 0`** 保留 `1:10m` 原貌；陆地入海须从内陆绕开海湾凹口防跨海自交。内陆湖泊优先用 `ne_10m_lakes_historic.geojson`（如未干涸咸海 572 点）。
- **河流拼接与穿城陷阱**：`stitchRiverChain()` 先拼接断裂河段（`< 0.25°`）再按枢纽截取 `NATURAL_FEATURE`。注意**勿用河道劈开跨河政权**（如花剌子模跨阿姆河两岸，养吉干在锡尔河三角洲南汊，均只在上游分段取河为界）。
- **破除“类四边形”与温和 DEM 寻路**：不要只设 4 个角点成框；每条陆地长边沿河曲、鞍部、绿洲外缘设 **3–6 个非共线途径点**制造有机凸凹与走廊，飞地/独立山地用 `interiorHoleArcIdsByFaceId` 设为内环洞（`computePolylabel` 已支持避洞）。在 `scripts/lib/dem-pathfinder.mjs` 中基于 `data/raw-gis/dem-ca-z6.int16`（1280×1024）的 TPI 起伏，采用**窄走廊（`corridorPx: 8–16`）+ 温和低地形权重（`0.25–0.45`）**区分 `ridge`（山脊）/ `contour`（盆地崖坎）/ `divide`（草原微丘），经 Chaikin 与 `simplifyDP(0.015°)` 得到细腻流畅边界（分形维数保持在 `[1.04, 1.22]`，Hausdorff 偏差 `<= 25 km`）。
- **水陆铺设顺序**：先提取所有海岸与河道并写入 `occupiedMask`（3×3 占格），再布设内陆寻路弧段，非端点像素施加高罚分（`+1500`）以防跨弧交叉。

### 2. 自动化平面校验、合规底线与小窗防裁切
- **平面图自检（`scripts/lib/natural-topo-builder.mjs`）**：枢纽节点先统一吸附到 `1:10m` 几何真实顶点；`stitchFaceArcsCCW()` 自动统一逆时针闭合并推导 `left_face_id` / `right_face_id`；`findRingSelfIntersection()` 查零自交；全部名城与遗址必须通过 `cityChecks`（`pointInRing`）校验。对高密弧段（`rawPts.length > 35`），前端 `deriveBoundedSplineGeometry()` 只做轻量 `[0.12, 0.76, 0.12]` 平滑而不翻倍顶点数。
- **中国国界合规与国名显示**：`public/gis/modern_borders.geojson` 在生成时剔除 Natural Earth 涉华及 `Unrecognized` 冲突线段，全量合入中国标准边界（`china_standard_100000.json`，`sovereignty_pov: "CHN_OFFICIAL"`），且 `modern_reference` 底图改用无第三方国界的物理地形瓦片。图面 `PolityMetadata.name_zh` 保持 **2–4 字**（全称放 `era_label`），前端对 `<textPath>` 做像素长度与视口安全边距检验，不足时回退居中平排并按多边形可见区夹紧，配合 `ResizeObserver → map.resize() + fitBounds` 确保缩小浏览器后国名仍完整显示。

---

## 三、历史建模：细粒度演变、控制力与多级遗址

### 1. 细粒度疆域演进
- **预拆易变子面**：提前将争夺绿洲、关隘走廊与藩镇拆为独立 `face_id`（如 `face-ca-semnan`、`face-ca-ghazna`、`face-ca-kashgar`）。`PURE_TERRITORY` 模式下同政权内部接缝自动融合（`is_same_polity_internal`），局部易手即可精准翻转小面而不动大版图。
- **精细时间轴与差异绑定**：利用 `HistoricalTimestamp` 的连续 `julian_day_number`（支持年/月/日/时/分）为短期攻防单独切分 `[valid_from_jdn, valid_to_jdn)` 半开区间；每次变更配套 `DiffComparisonRecord`（`before_snapshot`、`after_snapshot`、`affected_arc_ids`、`affected_toponym_ids`）供卷帘与抽屉审查。

### 2. 控制力分级、附庸/土司、内战并立与行政区划
- **单源双模驱动**：纯疆域与控制力模式共享 `TerritorialFace.control_score`（0–100）与 `control_semantic_tag`，严禁建两套几何：
  - **一级控制力**：`DIRECT_CORE`（88–98，京畿核心）、`REGULAR_ADMIN`（72–86，常规行省州县）；
  - **二级控制力（附庸/土司）**：`TRIBUTARY_VASSAL`（**55–78**，政权内部附庸国、世袭藩侯、土司/宣慰司及军镇），必须设 `PolityMetadata.parent_polity_id` 指向宗主国以触发同色系继承；
  - **外围/稀疏/争议**：`INDIRECT_JIMI`（38–58，松散羁縻）、`LOOSE_OR_SPARSE_FRONTIER`（20–54 + `is_sparse_or_desert_zone: true`，草原荒漠不挖空）、`DISPUTED_CONTESTED`（25–64 + `zone_semantics: "DISPUTED_OVERLAP"`）。
- **势力并立与内战规则**：
  - **有正统之分**：正统方用**一级控制力**（主色）；割据/叛军/支系用**二级控制力** + `parent_polity_id` 同源色，且 **`name_zh` 须加括号明示区别**（如 `萨法尔（侯赛因）`、`白益（法尔斯系）`）；
  - **无正统之分**：去掉 `parent_polity_id` 绑定，拆成独立 `PolityMetadata` 交由四色防撞器**分别上色**；拉锯未定区同步标记 `DISPUTED_OVERLAP`。
- **内部行政区划（按需考订）**：当用户要求呈现内部区划时，建立 0–3 级 `AdminUnit[]`（绑定至 `TerritorialFace.admin_unit_id`）及 `AdminEvolutionRecord[]`（`ESTABLISHED` / `MERGED` / `SPLIT` / `RENAMED` / `SEAT_MOVED` / `JURISDICTION_CHANGED`），`buildBoundaryRenderMetadata()` 会据此驱动 `admin_divisions` 与 `multi_tier_ink` 分级墨线。

### 3. 多标注城市、关隘与遗址（`HistoricalToponym`）
- **全等级入库**：除 `CAPITAL` 外，应大量补充 `MAJOR_CITY`、`PREFECTURE_SEAT`、`COUNTY_SEAT`、`PASS_FORT`（关隘军镇）与 `NATURAL_FEATURE`（遗址/地标），填齐多语原文 `name_original_script`、`alt_names_and_transliterations`、`modern_name` 及 `citations`。
- **精度标注与缩放渐显**：考证确凿标 `EXACT_SITE`，区间范围标 `APPROXIMATE_AREA`，史载但遗址未定点必须标 **`UNCERTAIN`**（开启 `show_uncertainty_question_mark` 自动加 `" ?"`）。**将全部遗址写入 `toponyms`，通过 `label_priority`（1–100）分层**：`88–99` 全览显都城、`68–84` 中景显州城关隘、`40–66` 推近后由 `evaluateToponymLayout()` 自动释放小绿洲与考古遗址并避让国名 `obstacle_boxes`。

---

## 四、当前 960–975 中亚边界弧段交接清单（供学术 Agent 精修）

- **19 条 `NATURAL_FEATURE`（已对齐 1:10m 物理要素）**：波斯湾/霍尔木兹/马克兰/里海/历史咸海 7 条岸线，以及阿姆-喷赤河（5 段）、锡尔河、阿特雷克河、乌拉尔河（2 段）、阿克苏河、叶尔羌河、塔里木河 12 条河道。
- **50 条 `APPROXIMATE_FUZZY` / `DISPUTED_SCHOLARLY`（待 T1 原典精修）**：重点需用《世界境域志》、伊本·阿西尔、拜哈基与敦煌于阗文书精修乌古斯—基马克草原界（`arc-ogh-kim`, `arc-kim-qar`）、喀喇汗—高昌天山北麓界（`arc-qar-qoc`）、加兹尼—印度沙希喀布尔前沿（`arc-gha-hs`）及古尔山地范围（`arc-kho-gur`, `arc-gha-gur`）。
