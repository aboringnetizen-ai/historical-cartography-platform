# 空间拓扑内核

## 草稿拓扑

数据库使用 PostgreSQL 17 与 PostGIS Topology 3.7。运行 `migrateTopology(pool)` 应用有校验值的 SQL 迁移。用于迁移的开发角色需要创建扩展和 schema 的权限。

`createDraftTopologyRevision(pool, input)` 接收研究范围外圈线、分割线和每个面的内部种子点。统一使用二维 WGS84 坐标，将相邻面建在同一套原生 PostGIS 节点、边和面上。研究区范围可以排除明确处于范围之外的水域，研究区内的荒漠等低控制区仍作为有分值的面。地图面从拓扑动态派生。

每个修订有自己的拓扑 schema。多个草稿修订可以对应同一个纪元，逻辑纪元区间互不重叠。构建未通过拓扑校验或覆盖不完整时，原生拓扑、修订和面标签在同一次数据库操作内回滚。

`readMapSnapshot(pool, { revision_id, historical_jdn })` 读取指定修订的 GeoJSON 草稿。纪元左闭右开。共享弧段和节点的 ID 以修订 ID 为前缀，弧段的两侧引用同一快照中的面。精确标注、跨修订弧段对应、正式变更事务与证据门禁由后续工作补齐。

## 运行验证

~~~powershell
npm ci
npm run check
# 将 CARTOGRAPHY_TEST_DATABASE_URL 设为开发 PostgreSQL 的连接 URL
npm run test:postgis --workspace @historical-cartography/topo-core
~~~

数据库测试在指定开发服务器上创建本次运行专用的数据库，完成后清理。测试用的角色需要能创建数据库和扩展。CI 使用 PostGIS 17-3.7 容器。数据库测试使用人工研究区几何，验证拓扑、零缝隙和失败回滚。
