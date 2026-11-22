# 仓库工作约定

每次开始开发先读 [INVARIANTS.md](INVARIANTS.md) 和 [架构状态](docs/architecture-state.json)。
[SPEC v4.0](https://docs.google.com/document/d/1pT0K3gbotZX9EasapG4wbJ5LamzTw2QgvxuJ7JDkk6g/edit) 是产品需求与 Canonical Schema 的来源。
接手任务时按 [多 Agent 分工与统一验收手册](docs/多Agent分工与统一验收手册.md) 查找任务编号、写入范围、验收用例与恢复步骤。

- 共享契约从 `packages/shared-schema` 导入。新增公开字段前核对规格中的冻结契约。
- `topo-core` 和 `scholar-agent` 只依赖共享契约，跨包通信走明确的 RPC 或 MCP 接口。
- `carto-studio-web` 和 `video-renderer` 通过共享契约与后端 API 工作。空间写入经过拓扑事务层。
- 提交工作前运行 `npm run check`。同次更新架构状态，注明真实通过的验收与仍待完成的工作。
