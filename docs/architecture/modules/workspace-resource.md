<!-- architecture-module: workspace-resource -->

# WorkspaceResource 创作工作区

## 目标与边界

一个 Project 只有一棵创作资源树。`WorkspaceResource` 同时表示目录、用户可编辑文字文件以及由 Wao 生产的图片、音频和视频；不存在 Authoring File、CreativeResource、Episode Resource 或 Canvas Card Resource 等平行实体。

本模块拥有资源身份、路径、内容版本、删除与恢复语义、精确输入 Lineage 和运行时文件夹写回。Task、Artifact/MediaObject、计费、审批、Provider 执行和 Assistant Turn 各自保留其系统事实，不能被 Agent 通过文件内容改写。

## 不变量

- **WR-01 — Catalog 是路径与存在性的唯一持久权威。** `WorkspaceResource` 以稳定 `resourceId` 为身份，以 `(projectId, activePath)` 唯一约束当前路径。未删除资源有且只有一个 `workspacePath`；删除只清空 `activePath` 并保留最后路径用于恢复。对象存储拥有文件版本内容，Runtime 文件夹只是可销毁的工作副本，Canvas 只是 View。
- **WR-02 — Project 是唯一作用域。** Resource 只有 `userId + projectId` 所有权。Episode、Chapter、Scene、Shot、Canon 和连续性都是用户目录与文件内容，不是系统 scope、外键或第二状态机。
- **WR-03 — 文件夹也是 Resource。** `resourceKind=folder`、`mediaType=null`、`schemaId=system.folder`、`currentVersion=0`。虚拟根 `@root` 不持久化。每个非根父目录必须是同 Project 的未删除 Folder Resource；因此空目录可持久化和显示。
- **WR-04 — 文件内容按版本冻结。** 文本、结构化文档和媒体文件都由 `WorkspaceResourceVersion(resourceId, version)` 指向不可变 MediaObject。用户编辑只追加版本；生成结果由 Task terminal materializer 追加版本。`resourceId + contentVersion` 是执行输入身份，当前路径只用于显示和审计。
- **WR-05 — 字段所有权明确。** Agent 可在用户树内创建、编辑、移动、改名和软删除用户内容；不可写 `resourceId`、status、Task、媒体指针内容、Lineage、模型、成本或系统投影。`system/**` 完全只读，`.resource` 内容由系统拥有但文件可随目录移动或删除。越界、隐藏路径、Traversal、非法后缀和系统字段篡改必须原地失败。
- **WR-06 — Runtime checkpoint 是唯一文件写回入口。** Runtime materialize 时由 Catalog 和对象存储生成完整 Bundle；capture 时比较同一 baseline 并在一个事务内提交完整资源树。文件 identity 由文件内受保护的 Resource 标识维持；文件夹改名由本次 Runtime 的 inode identity 识别，该 identity 只存在于临时 baseline、绝不成为产品事实。并发路径、存在性、类型和 Agent 可写文本版本变化使整次 checkpoint 失败，不允许部分写回。媒体指针内容不可写且只编码稳定 Resource identity；Task terminal writer 在后台物化媒体版本不与未改动的 Runtime 指针竞争，不得仅因媒体 `currentVersion` 前进而拒绝 checkpoint。
- **WR-07 — 所有生产能力强制 Placement。** 每个 `producesResources` Operation 必须在穷尽 registry 声明输出 kind/media/schema，并要求 `outputPath`。Plan 阶段验证父目录、路径、schema 和冲突；缺 placement 不报价、不提交，也不静默落收件箱。
- **WR-08 — 执行前冻结精确输入。** Operation 以用户提供的 `workspacePath` 解析当前 Resource，再冻结 `resourceId + contentVersion + role + position` 到同一个 PlanSnapshot；计费审批消费该快照。执行、重试和 Lineage 都只消费冻结版本，不能在 Task 开始后重新按路径读取。
- **WR-09 — 一个异步终态 writer。** 生成 Operation 的 commit 事务预留 pending Resource 与 Task。Task terminal success 在同一事务物化版本、Lineage、Resource 状态、Task 终态和通知；失败/取消只结算未物化 Resource。replay 返回同一事实，不能生成第二 Resource 或重复计费。
- **WR-10 — 批量生产是数据，不是 N 个 Agent 调用。** `submit_production_manifest` 一次冻结最多 registry 允许的显式条目、一个总报价和一个 Approval Grant，再由 Temporal 扇出 Task。成员有稳定 `itemId/resourceId`；部分失败只由 `rerun_failed_production_items` 重跑失败成员，成功成员不重提。FollowUpBatch 在全部终态后至多一次唤醒 Assistant。
- **WR-11 — 移动、删除和恢复只有一套语义。** 文件移动只改自身路径；文件夹移动原子改写完整子树路径。活跃 Task 涉及的 Resource 不可移动或删除；pending Resource 不可删除。软删除文件夹原子删除子树。恢复默认回原路径，冲突时必须显式给新路径，禁止静默改名。永久删除是独立、需审批的系统能力。
- **WR-12 — Canvas 不拥有 Resource。** Canvas 按当前文件夹以 `scope=subtree` 加载子树并由自身预算 policy 决定展开/收起，使用稳定 `resourceId` 作为卡片身份，目录决定导航与分组，布局只保存视图位置。拖动卡片不移动文件；改路径必须调用 Resource move 或由 Runtime `mv` 后 checkpoint。
- **WR-13 — 大项目按目录读取。** Agent 通过普通 `rg/read/bash` 探索用户树；Canvas 和 API 用 cursor 分页与 bounded summary，不读取全部正文。Runtime Bundle 上限与 Canvas 5,000 项视图上限必须明确失败，不能恢复 200 条静默截断。
- **WR-14 — Agent/Subagent 写入边界显式。** 主 Agent 是全局一致性文件的唯一 writer；并行 Subagent 只能写被分配的互斥目录。两个 writer 争用同路径由 `(projectId, activePath)` 与 checkpoint baseline fail closed，不靠最后写入覆盖。
- **WR-15 — MCP 边界同步同一工作区。** Wao MCP Operation 开始前必须在 Session Manager 的唯一 persistence queue 中 capture Runtime，使本 Turn 新建目录和文本进入 Catalog；Operation 结束后只在 Runtime 自 preflight 后未变化时把最新 Catalog 投影（包括 pending `.resource` 和 Task 系统视图）刷新回 Runtime。任一同步失败都不得开始新的付费执行或伪装成功；Catalog、Task 与幂等执行身份仍是恢复权威。

## 权威所有权与入口

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| Resource 身份、当前路径、存在性 | WorkspaceResource persistence | Runtime projector、Canvas、Operation planner |
| Folder identity | WorkspaceResource persistence | Runtime、Canvas 导航 |
| 文字/结构化/媒体内容版本 | WorkspaceResourceVersion + MediaObject | Agent、Provider、预览 |
| pending/ready/failed/canceled | Operation reserve / Task terminal writer | Canvas、retry、Task View |
| 精确输入与 Lineage | PlanSnapshot freeze / terminal materializer | Provider、审计、后续生成 |
| Runtime 工作副本 | Runtime Session Persistence | Codex app-server |
| Canvas 卡片与布局 | WorkspaceResource projector / Canvas layout service | Wao UI |
| Task、成本、审批 | Task / Billing / Approval 模块 | UI、Temporal、MCP |

唯一业务入口：

1. WorkspaceResource persistence：folder、user file、move、soft delete、restore、batch checkpoint、reserve、materialize。
2. Resource-producing Operation registry：create image/audio/video/voice、upload/import、merge、Production Manifest。
3. Task terminal materializer：异步成功、失败和取消。
4. Runtime projector/capture：Catalog ↔ 临时普通目录。

Route、UI、MCP 和未来 CLI 都只能调用这些入口，不能直接写 WorkspaceResource、Version 或 Lineage。

## 正常、失败与恢复

1. Runtime 启动从 Catalog 读取完整 active tree，从对象存储读取当前版本，生成显式 `directories + files` Bundle；`system/**` 同时投影只读项目说明与 Skills。
2. Codex 在容器内自由使用 read/write/rg/bash，Wao MCP 负责付费和系统能力。
3. Turn checkpoint 捕获全部文件与空目录，验证系统投影未变、Resource identity 未伪造、父目录完整，再以 baseline CAS 原子写回。Turn 内调用 Wao MCP 时复用同一个 capture writer 做 preflight，并在调用后以 quiescent baseline refresh，不另建 Catalog writer。
4. checkpoint 冲突时不提交任何 Resource 变化；Runtime 保留工作副本并向 Turn 显示明确错误。下次启动永远从 Catalog 重新 materialize。
5. 容器退出前先 capture Workspace、再保存 opaque Codex state；任一步失败都不得宣称 durable。容器被杀后由 Session Manager 从最后成功 checkpoint 恢复。
6. Task 与 Temporal 独立于 Runtime 生命周期。媒体任务在 Runtime 停止后仍可完成；FollowUpBatch 终态交接通过持久 identity 去重。

## Clean cutover

新系统不读取或回写旧 Episode、Chapter、Story Canon、CreativeResource、Binding、authoring bundle、project asset 或 Git workspace。旧表、route、Operation、Query key、UI 分支、文档和测试必须与新 schema 一次删除；禁止兼容层、双写或从旧消息猜路径。

## 验证

- Prisma 唯一约束、真实数据库事务：路径冲突、父目录、移动子树、删除/恢复、版本 CAS。
- Runtime Bundle：显式空目录、非法父目录、symlink、系统投影篡改、文件/目录冲突、两轮 canonical round-trip。
- Runtime checkpoint：文件编辑、文件移动、空文件夹改名、并发 baseline 冲突、失败无部分提交。
- Registry conformance：每个 Resource-producing Operation 都有 placement/schema/freeze；Task definition 与 handler 穷尽。
- Canvas：children/subtree scope、预算展开/收起、返回与搜索定位、folder-scoped layout、1,000–5,000 条 cursor/virtualization、原卡片动作不回归。
- Production Manifest：同一快照报价、成员稳定 identity、成功不重跑、失败成员续跑、FollowUp 至多一次。

## 历史回归

- WorkspaceResource clean cutover 首版为生成 Task 配置了 reference 生命周期策略，却遗漏图片、
  视频、音乐与 Voice payload 的 `lifecycleProjection`，获批生产清单因而无法原子创建 Task 与
  pending Resource。当前生成 payload 的严格共享 schema 拥有该字段，所有模态共用同一
  Resource identity/schema/name 投影；视频合并不再是唯一正确实例。

- 旧系统把 Resource、专业领域表、Canvas node、authoring file 和消息附件分别解释为创作事实，导致名称匹配、最近记录和多条 current 关系竞争。当前以一个 WorkspaceResource identity、精确版本和唯一路径取代全部桥接解释。
- 旧 Canvas 以 Episode 查询并有 200 条截断；大项目资源会静默消失。当前按文件夹 direct children cursor 读取，并明确支持 5,000 条投影。
- 仅按路径识别目录无法区分空目录改名与删除后重建。当前使用 Runtime-local inode identity完成单次 checkpoint 的稳定匹配，但不把 inode 持久化为产品事实。
- 先创建 Resource、再异步提交 Task 会产生僵尸 pending；Task 完成后再另写 Resource 会产生双终态。当前 reserve/Task 在 commit 事务交接，terminal materialization 与 Task 终态同事务。
- Codex clean cutover 首版只在 Turn 终态 capture，Operation planner 同 Turn 读取的仍是旧 Catalog；Agent 已 `mkdir` 的输出目录因此被误报不存在。当前 MCP preflight/post-refresh 与 Turn checkpoint 共用 Session Manager persistence queue 和同一 baseline，不允许 planner 与 Runtime 各自解释一棵树。
- 媒体 Task 可在 Agent Turn 结束后异步物化版本。首版 baseline 把所有 Resource 的 `currentVersion` 都视为 Agent 写冲突，因此不可编辑的 `.resource` 指针完全未变时，Task terminal writer 仍会让后续 checkpoint 报漂移。当前文本内容继续以版本 CAS 防并发覆盖；媒体指针只以 identity、路径、存在性和类型参与 Runtime CAS，后台媒体版本由 Task terminal writer 独占。
- Production Manifest 首版虽冻结 `durationSeconds`，计费和视频执行却仍读取旧 `generationOptions.duration`，造成审批前错误失败并可能在执行时丢时长。当前 Manifest、Task payload、billing quote 与 handler 共用 canonical `durationSeconds`，只在价格和 Provider 边界映射为 `duration`。
- 通用 Plan policy 冻结的 `projectVideoRatio` 曾未被 Production Manifest 的严格 metadata schema 接纳，导致获批 OperationExecution 在创建任何 Resource/Task 前失败。当前共享 ratio policy 同时拥有 key 与 snapshot schema，Manifest commit 显式组合该契约，不以 `.passthrough()` 放宽领域 metadata。
- WorkspaceResource clean cutover 首版把 16 位 compact idempotency hash 写入要求完整 SHA-256 的
  `inputHash`，图片、视频、音乐与 Voice Task 因而在 Provider 调用前确定性失败；失败终态又先
  解析同一畸形领域 payload，导致 Task、Resource 和冻结额度永久停在处理中。当前所有 Resource
  producer 只用 64 位 fingerprint 表示输入内容，compact hash 只用于请求 identity；失败与取消
  终态以 Task 的 canonical `targetId` 结算，只有成功物化才严格解析完整领域 payload。畸形输入
  可以失败关闭，但不得阻塞 terminal writer 收口。
- 文本版本最初只用 `resourceId + version` 作为对象 key，却在数据库事务提交前上传；事务后续回滚时，同版本不同内容的重试会覆盖对象，而既有 MediaObject 仍保留旧 SHA/大小，破坏不可变版本。当前文本对象 key 同时包含内容 SHA-256；回滚可留下待回收的未引用对象，但绝不能覆盖另一份内容或让数据库 metadata 与对象字节分叉。
