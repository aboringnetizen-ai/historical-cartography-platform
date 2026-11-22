# 空间拓扑内核

## 草稿拓扑

数据库使用 PostgreSQL 17 与 PostGIS Topology 3.7。运行 `migrateTopology(pool)` 应用有校验值的 SQL 迁移。用于迁移的开发角色需要创建扩展和 schema 的权限。

`createDraftTopologyRevision(pool, input)` 接收研究范围外圈线、分割线和每个面的内部种子点。统一使用二维 WGS84 坐标，将相邻面建在同一套原生 PostGIS 节点、边和面上。研究区范围可以排除明确处于范围之外的水域，研究区内的荒漠等低控制区仍作为有分值的面。地图面从拓扑动态派生。

每个修订有自己的拓扑 schema。多个草稿修订可以对应同一个纪元，逻辑纪元区间互不重叠。构建未通过拓扑校验或覆盖不完整时，原生拓扑、修订和面标签在同一次数据库操作内回滚。

`readMapSnapshot(pool, { revision_id, historical_jdn })` 读取指定修订的 GeoJSON 草稿。纪元左闭右开。共享弧段和节点的 ID 以修订 ID 为前缀，弧段的两侧引用同一快照中的面。精确标注、跨修订弧段对应、正式变更事务与证据门禁由后续工作补齐。

## 古地理参考线

服务端资料导入通过 `registerPaleoReference` 登记带纪元、来源文档和要素类型的古河道、古岸线或古湖泊参考线。同一纪元下相同的登记可以重复执行。来源或几何变化时保留原记录，以新参考要素交接后续修订。

草稿请求的 `paleo_feature_ids` 按草稿纪元解析。导入器使用登记的整段参考线作为建网输入，同时避免再提交与该线重复的试绘分割线。找不到当前纪元版本时拒绝构建。建网后重新核对与原参考线的空间相等性及零 Hausdorff 距离。在地图快照中，匹配的共享弧段返回 `snapped_paleo_feature_id`。子段吸附和任意边界平移由后续编辑任务交付。

## 共享弧段的只读平滑预览

`previewSharedArcSmoothing` 根据地图修订、弧段 ID 和视口生成候选曲线。使用 Visvalingam–Whyatt 简化和固定端点的张力样条。候选须保持简单有效，并在局部等距投影下通过双向偏移带检查。允许偏移取配置值、视口宽 0.8% 和 25 km 中最小值。已吸附古地理要素的弧段直接读出登记的形状。

预览返回原始骨架、候选或拦截原因。调用后数据库中的原始弧段保持原值。分形维数、微折角、相邻弧段及地标归属的正式联动校验待接入 G1.5，并在该门禁通过前保留候选状态。

## 运行验证

~~~powershell
npm ci
npm run check
# 将 CARTOGRAPHY_TEST_DATABASE_URL 设为开发 PostgreSQL 的连接 URL
npm run test:postgis --workspace @historical-cartography/topo-core
~~~

数据库测试在指定开发服务器上创建本次运行专用的数据库，完成后清理。测试用的角色需要能创建数据库和扩展。CI 使用 PostgreSQL 17 与 PostGIS 3.7 容器。数据库测试使用人工研究区几何，验证拓扑、零缝隙、失败回滚和按纪元吸附。
