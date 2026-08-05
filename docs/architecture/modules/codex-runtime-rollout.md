<!-- architecture-module: codex-runtime-rollout -->

# Codex Creative Runtime

## 为什么是这样

Codex app-server 是唯一 Agent Runtime；Wao 保留产品 View、WorkspaceResource、Capability Service、
计费、审批、Task 和执行平面。Runtime 可被替换，因此 UI 和业务服务不直接依赖它的进程细节，统一经
适配器与 AssistantRuntime。

容器是租户和资源边界，Codex 内层 sandbox 是纵深防御——两者职责不同，不能互相替代。产品 edition
不是运行环境 profile：把两者混为一谈会让本地开发无法启动，或让生产静默降级。

不使用 Git：创作历史由资源版本拥有，并发安全来自 ownership、单 Turn 与 baseline CAS。

## 不变量

- **CRR-01 — 唯一 Runtime。** 每个活跃 `(userId, projectId)` 最多一个 Runtime session；同一
  Project 同时最多一个活跃 Turn。
- **CRR-02 — 适配器隔离协议。** UI、route 和业务 service 只能通过 AssistantRuntime；协议方法、
  版本差异和进程生命周期收敛在适配器与 Session Manager。进程级能力必须在 app-server 启动时启用
  并验证，不能只在会话层声明后假定已存在。
- **CRR-03 — 双层隔离，且不静默降级。** 生产多租户 driver 必须是容器并限制 CPU、内存、PID、
  磁盘与网络；Codex 只能写临时 Project workspace。开发可显式选择本地进程，但 production 不得
  自动降级，产品 edition 也不得自动决定 driver。
- **CRR-04 — WorkspaceResource 才是持久事实。** 启动时从 Catalog/对象存储 materialize，Turn
  checkpoint 时以完整 baseline CAS 原子 capture。Runtime 文件夹、inode 和临时 home 都不是产品
  权威。
- **CRR-05 — 系统字段不可写。** Runtime 可自由组织用户工作区，但不能修改 Resource status、Task、
  Artifact、Billing、media identity 或系统投影。媒体文件是受保护引用。
- **CRR-06 — Runtime 状态与产品 View 分权。** 不透明会话状态只用于 resume；数据库 View 是聊天、
  审批、计费归因和刷新显示的产品事实。两者必须先持久化再绑定 runtime thread id。
- **CRR-06A — resume 必须匹配 Runtime revision。** 钉死版本、process host 或工具拓扑发生不兼容
  变化时只提升一个共享 revision；状态存储 key 与线程记录必须使用同一值。revision 不匹配时先完整
  停止旧 Runtime，再原子清空旧绑定，新线程由产品 View 的既有消息 seed。同 revision 的普通重启、
  空闲停止与崩溃仍 resume 原线程，禁止每 Turn 重建或保留新旧双轨。可 resume 时绝不重放产品消息；
  不可 resume 时恰好一次注入历史，且不伪造旧工具终态。
- **CRR-07 — MCP 是唯一系统能力桥。** 真实媒体、导入、批量生产、预算与破坏性操作只经带当前 Turn
  凭据的 MCP；Capability Service 仍是业务实现，MCP 不复制逻辑。Runtime bearer 只证明能力调用权，
  绝不证明用户同意——计费与破坏性 writer 必须验证浏览器侧已持久化的同 Turn 决定。每次调用由同一
  Session Manager 在执行前 flush、执行后 refresh；授权与 ownership 复验全部发生在副作用之前，
  提交成功后的 refresh 失败可以阻断/恢复 Runtime，但绝不能把已成功的副作用伪报为工具失败。
  业务能力命名空间必须标记为 direct-only，不进入嵌套执行器。
- **CRR-07A — 用户取消是正常终态。** 拒绝计费或破坏性审批时返回结构化 declined 且不标记协议错误；
  UI 显示"已停止"，模型不得解释为服务失败或建议重试。
- **CRR-07B — Runtime bearer 不是模型 API key。** bearer nonce 同时是当前 placement 的 ownership
  token；模型网关、搜索与 MCP 必须通过同一个 capability Turn resolver，先证明该 nonce 仍持有租约，
  再证明 Project 恰好一个活跃、未取消、未 clear 且归属本次执行的 Turn。执行中不得要求 durable
  thread id——它只在状态 checkpoint 后作为恢复身份绑定，新线程的首个活跃 Turn 合法地没有该字段。
  placement 停止或轮换后旧 token 即使未过期也不能重放。
- **CRR-08 — 空闲可停，但持久化是 sticky barrier。** 无活跃 Turn 时达到 idle timeout 才 capture、
  保存状态并停止。原生 completion 必须同步登记 capture/checkpoint；下一 Turn、进程退出、ownership
  丢失或 Manager 重启必须先排空持久化并确认产品 Turn 已结算，再允许新 writer 或 placement。
- **CRR-09 — 版本钉死，实验能力显式协商。** binary/协议版本与 smoke 一起升级；未知关键
  request/event 不得静默忽略。产品所需的实验方法必须在 initialize 显式声明并由真实 schema smoke
  校验存在；关闭该能力等同缺失必需能力。
- **CRR-09B — Provider 适配与重试只有一个 owner。** Runtime 是同一 Turn 内模型请求与流式连接重试
  的唯一 owner 且重试有界；网关不得再建第二套 retry。模型请求只能在唯一网关边界规范化：指令项
  提升到顶层 instructions，对话与工具历史保持原顺序，无法无损规范化时原地失败。中间错误只表示
  本次尝试，声明将重试时不得提前写产品 Turn 失败。
- **CRR-11 — 进程内 Manager 唯一。** 同一进程的所有 route bundle 必须复用一个进程级 Manager；
  开发热更新不能遗留仍在续租的模块级实例。跨进程唯一性由外部 ownership claim 裁决。
- **CRR-12 — 当前控制面单进程。** placement 与 MCP session 目前都是进程内对象，因此 Web 控制面
  只支持一个 Node 进程；媒体 Worker 可独立横向扩展。启用多 replica 前必须先增加按 owner 的请求
  路由与 session affinity，禁止把 ownership claim 误称为跨 replica 转发能力。
- **CRR-13 — Runtime 路径不能成为产品链接。** materialization root、临时 home、绝对路径和
  `file://` 只属于可销毁执行环境。对用户只输出规范化的项目相对路径，并交给 Canvas 的唯一定位
  入口；拒绝绝对路径、scheme、反斜线与编码后的 traversal。

## 权威入口

- Runtime 协议与适配：`src/lib/codex-runtime/runtime-adapter.ts`、`app-server-client.ts`
- placement / ownership / idle / 恢复：`src/lib/codex-runtime/runtime-session-manager.ts`
- 隔离与容器：`runtime-config.ts`、`Dockerfile.codex-runtime`
- materialize / capture：`src/lib/assistant-runtime/runtime-persistence.ts`、`src/lib/codex-workspace/**`
- 能力桥：`src/lib/wao-mcp/**`；模型网关：`src/lib/codex-model-gateway/**`

## 踩过的坑

- 容器 driver 首版把外层容器当成唯一沙箱，向 Turn 声明完全访问权限；同 UID 的 shell 因而能读取
  bearer 并直连内部模型网关 → 两层隔离被当成一层 → 本地与容器都启用受限写权限并关闭 shell 网络
  （CRR-03/CRR-07B）。
- 模型网关首版只验证"项目里恰好有一个活跃 Turn"，未证明请求来自当前 Runtime；旧容器 bearer 可在
  有效期内等待新 Turn 后重放 → 凭据没有绑定 placement 租约 → bearer nonce 与 ownership token
  完全相同（CRR-07B）。
- MCP 首版把只有 checkpoint 后才写入的 durable thread id 当成当前调用身份，全新线程的首个 Turn
  因此在计划/计费前统一失败；此前的真实验收复用了已有线程，只证明恢复路径 → 用恢复身份做执行
  围栏，且验收遗漏首轮路径 → 统一 capability Turn resolver 不再要求 durable thread id。
- MCP 曾在业务事务或执行提交成功后才做 ownership 复验；用户恰在提交后取消会让后置检查抛错，把
  真实成功返回成失败并诱导重复执行 → 授权复验发生在副作用之后 → 复验截止于副作用之前，后置刷新
  失败只触发恢复与告警（CRR-07）。
- 版本升级为通知信封新增可选字段，而 fail-closed parser 仍只允许旧结构，升级后在 initialize 之后
  立即杀死进程，所有 Turn 表现为 Runtime failed → 钉死版本与生产 parser 不同步 → 两者同步演进
  （CRR-09）。
- 产品 edition 被当成运行环境 profile：Cloud 无条件要求容器，而本地 Cloud 开发的 preflight 又要求
  本地进程，所有本地首条消息都在 materialize 前失败 → 只有生产强制容器（CRR-03）。
- 模块级 Runtime singleton 在开发热更新后失去引用但继续续租，新 bundle 又创建了第二个 Manager，
  表现为永久 ownership busy → 模块级单例不是进程级单例 → 进程级 global 只保存一个 service。
- 首次接通业务审批时只延长了两层 timeout，遗漏两个真实协议边界：调用被嵌套执行器包裹、以及内部
  发起的请求脱离父调用后路由到无人持有的独立流 → 服务端已在等待用户而 Runtime 收不到请求 →
  业务命名空间 direct-only，内部请求保持父请求关联，两层 timeout 只承担等待上限（CRR-07）。
- 中文项目的最终答复遵循 locale，但流式推理摘要仍短暂显示英文 → 只约束"response"不足以覆盖全部
  可见输出 → 每 Turn locale context 显式覆盖回复、进度、计划说明与推理摘要。
