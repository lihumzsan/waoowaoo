<!-- architecture-module: codex-runtime-rollout -->

# Codex Creative Runtime

## 设计理念

Codex app-server 是唯一 Agent Runtime；Wao 保留产品 View、WorkspaceResource、Capability Service、计费、审批、Task 和 Temporal。Runtime 可被替换，但 UI 和业务服务不直接依赖 Codex 进程细节，统一经 `RuntimeAdapter` 与 `AssistantRuntime`。

开发环境可用本地进程；云端多租户必须在项目级隔离容器中运行。容器是租户和资源边界，Codex 内层 sandbox 是纵深防御，两者职责不同。

## 不变量

- **CRR-01 — 唯一 Runtime。** 每个活跃 `(userId, projectId)` 最多一个 Runtime session；同一 Project 同时最多一个活跃 Turn。旧 Agents SDK、Primary 模型循环和 Temporal Agent coordinator 不得执行 Turn。
- **CRR-02 — 适配器隔离协议。** UI、route 和业务 service 只能通过 `AssistantRuntime`；Codex JSON-RPC 方法、版本差异和进程生命周期收敛在 `RuntimeAdapter` / Session Manager。
- **CRR-03 — 双层隔离。** 云端 driver 必须为 Docker，限制 CPU、内存、PID、磁盘/工作目录和网络；Codex 使用 `workspace-write`，只能写临时 Project workspace。开发 driver 可显式选择 local，不能在 cloud 静默降级。
- **CRR-04 — WorkspaceResource 才是持久事实。** 启动时从 Catalog/对象存储 materialize 普通目录，Turn checkpoint 时以完整基线 CAS 原子 capture；Runtime 文件夹、inode 和临时 Codex home 都不是产品权威。
- **CRR-05 — 系统字段不可写。** Runtime 可自由组织用户工作区文件和目录，但不能修改 Resource status、Task、Artifact、Billing、media identity 或系统投影。媒体文件是受保护引用；改写、伪造或删除 pending 媒体必须失败。
- **CRR-06 — Codex 状态与产品 View 分权。** 不透明 Codex session state 只用于 resume；MySQL Assistant View 是聊天、审批、计费归因和刷新显示的产品事实。两者必须先持久化再绑定 runtimeThreadId。
- **CRR-07 — MCP 是唯一系统能力桥。** Runtime 的真实媒体、导入、批量生产、预算与破坏性操作只经带当前 Turn token 的 Wao MCP；Capability Service 仍是业务实现，MCP 不复制逻辑。
- **CRR-08 — 空闲可停。** 无活跃 Turn 时达到 idle timeout 才 capture、保存 session state 并停止容器；下一条消息按持久绑定重建。进程退出、ownership 丢失或 Manager 重启必须先结算废弃 Turn，再允许新 placement。
- **CRR-09 — 版本钉死。** Codex binary/app-server 版本与协议 smoke 一起升级；未知关键 request/event 不得静默忽略。
- **CRR-09A — 原生实验事件显式协商。** 当前钉死版本把 `request_user_input`、Goal 等产品所需事件标为 experimental；Wao initialize 必须显式声明 `experimentalApi=true`，真实 schema smoke 同时校验这些方法仍存在。关闭该 capability 等同缺失必需能力，禁止静默降级。
- **CRR-10 — 不使用 Git。** 创作历史由 WorkspaceResourceVersion 拥有；Runtime 目录没有 Git、Commit Service、branch 或 CAS HEAD。并发安全来自 Project ownership、单 Turn 与 Catalog baseline CAS。

## 生命周期

1. Session Manager 获取 `(userId, projectId)` 独占 ownership。
2. 从 WorkspaceResource Catalog/对象存储 materialize 临时目录与持久 Codex state。
3. 启动 app-server，initialize，start/resume product thread。
4. 先持久化 Codex state，再写 product thread ↔ runtime thread binding。
5. Turn 期间按原生事件更新 MySQL View，MCP 调用进入 Capability Service。
6. Turn 结束原子 capture 工作区；成功后 checkpoint runtime state。
7. 空闲、关闭或可恢复故障时保存后销毁临时目录；不保存成功则不得宣称 Turn 已持久。

## 失败与恢复

| 事件 | 唯一语义 |
| --- | --- |
| app-server 启动/initialize 失败 | 不建立 durable binding；清理 materialization；Turn 显式失败 |
| Runtime 进程意外退出 | 记录 interrupted，capture 可证明的工作区，旧 Turn 不再写终态；重建后 resume/new Turn |
| Session Manager 崩溃 | 外部 ownership 过期后新 Manager reconcile 废弃 Turn；禁止双 Runtime |
| workspace baseline 漂移 | 整个 checkpoint 原地拒绝，不部分覆盖 Catalog |
| MCP flush/Task 提交结果不明 | 依赖 operation/request idempotency 查询同一执行，不再次扣费 |
| 空闲停止 | 仅无活跃 Turn 时执行；checkpoint 失败则 session 进入 blocked，不销毁权威证据 |

## 权威入口

- Runtime 协议：`src/lib/codex-runtime/runtime-adapter.ts`、`app-server-client.ts`。
- placement/ownership/idle/recovery：`runtime-session-manager.ts`。
- local/Docker 隔离：`runtime-config.ts`、`*-runtime-container.ts`、`Dockerfile.codex-runtime`。
- materialize/capture：`src/lib/assistant-runtime/runtime-persistence.ts`、`src/lib/codex-workspace/**`。
- 产品 View：`src/lib/assistant-runtime/**`。
- 能力桥：`src/lib/wao-mcp/**`。

## 验证

真实 app-server smoke 覆盖 initialize、thread start/resume/read、turn、steer、interrupt、skills/list 与关键 event。Session Manager 需验证同 scope 互斥、进程退出、Manager 重启、binding 顺序、idle stop/restart；Workspace 需以真实数据库和对象存储边界验证目录 rename、内容版本、baseline divergence 和系统字段保护。云端容器资源限制与网络只能在目标部署复验。

## 修改检查表

- 是否出现第二 Runtime、第二 workspace writer 或第二 thread binding writer？
- cloud 是否仍 fail-closed 要求 Docker，local 是否只用于显式开发？
- checkpoint 是否先 capture WorkspaceResource，再保存/bind Codex state？
- 未知协议、崩溃和提交结果不明是否都有幂等、可恢复且不重复计费的语义？
