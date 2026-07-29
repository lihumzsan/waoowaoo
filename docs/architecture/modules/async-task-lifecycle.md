<!-- architecture-module: async-task-lifecycle -->

# 异步 Task 生命周期

## 设计理念

Task 是长运行执行的唯一运行事实。Operation 负责校验与提交，Task registry 声明能力，worker 只执行一次 attempt，Terminal Service 统一提交终态并物化 Creative Resource。Agent、Canvas、SSE 和 Query 都消费这些正式事实，不从文案、历史消息、timer 或 provider 轮询次数推断状态。

## 不变量

- **TL-01 — 单一提交入口。** Task、billing freeze、Created Event 与 `task.enqueue` Outbox 只能由共享 submitter/事务 primitive 创建。route、Operation 和 worker 不得直接写队列或复制提交协议。
- **TL-02 — Task registry 穷尽。** 每个 TaskType 必须在 `src/lib/task/definition.ts` 声明 queue、handler、retry、billing、scope、execution deadline、terminal resource impact 与 result projection。当前专业创作只有 `creative_work`；媒体执行只有通用 Creative Resource image/audio/voice/video/video-merge Task，以及把外部网页图片导入自有存储的 `creative_resource_web_reference` Task。终态是否要求 handler 回传 modelKey 也是 registry 声明（`terminalModelKeyRequirement`），不运行模型的 Task 声明 `none`；materializer 和 worker handler 不得按 Task 类型内联另一份 deadline 或终态规则。
- **TL-03 — attempt 唯一执行者。** worker 以 DB CAS 领取 `queued → processing`，携带 `taskId + taskAttempt` 写 heartbeat、progress、provider checkpoint 与终态。只有这个 attempt owner 可以按 TaskDefinition 创建 execution deadline AbortSignal 并传给 handler；重复、晚到或旧 attempt 无写权。
- **TL-04 — 提交失败原子回滚，提交与终态对称即时运输。** Task、freeze、Wait member、Event 或 Outbox 任一步失败必须整体回滚。Redis 只负责运输；创建 Outbox 命令的事务 owner（Terminal transaction、`invokeProjectAgentOperation` 自有事务、`invokeApprovedOperationPlan`）在 commit 成功后必须立即把本次事务创建的精确 Outbox IDs 交给 `dispatchCommittedOutboxCommands`。事务内命令 id 由唯一写入入口 `createOutboxCommandInTransaction` 记录进 owner 显式绑定的 per-transaction collector（`createOutboxCommitCollector`），不得用全局可变状态或事后启发式查询重建。运输失败不回滚已提交业务事实，并由持久 Outbox dispatcher 恢复；周期扫描只承担崩溃恢复，不承担正常路径延迟，也不得以调小扫描间隔冒充快投递。
- **TL-05 — provider 调用有幂等 fence。** 同 attempt 不重复提交；明确临时拒绝只能由更高 Task attempt 重试；结果未知、鉴权、余额、内容安全与配置错误不得自动重提。
- **TL-06 — 终态 writer 唯一。** worker 不能自行把 Task 或 Resource 写成最终失败。Terminal Service 负责最终 completed/failed/canceled、billing settlement、Task Event、Resource materialization、workspace impact 与 Assistant continuation。
- **TL-07 — Creative Work 结果只物化一次。** `creative_work` 的严格 outputKind 由统一 materializer 转成 Resource/Lineage；worker Task.result 是交接输入，不是第二领域数据库。相同 Task/结果重放必须幂等。
- **TL-08 — Resource 是媒体目标。** 通用媒体 Task 的 target 是 CreativeResource，输入冻结全局唯一 Resource ID，并在提交前回库校验真实内容与 scope。旧 edit script、style preview、video segment、BGM design、final output 等专用 target/writer 不得恢复。
- **TL-09 — Wait 只聚合，不编排业务。** OperationBatch/Wait 可等待多个独立 Task，并在 seal 后处理早到、重复、失败和取消终态；它不表达固定阶段、WorkerGroup 或下一个 Operation。
- **TL-10 — UI 不解释生命周期。** SSE 只传递持久事件；断线后按 watermark replay。Canvas 收到终态影响后重新读取正式 Resource/Task View，不能依赖轮询、TTL、历史卡片或本地 overlay 完成业务交接。
- **TL-11 — 本地媒体进程有界。** 视频合并只经 `video-compose/ffmpeg-command.ts`、`video-merge-ffmpeg.ts` 与 `video-merge-audio.ts`。FFmpeg 禁止交互 stdin，deadline 从明确媒体时长派生，音轨按 canonical duration pad/trim/reset PTS，不能用多路 EOF 或 `-shortest` 裁决正确性。
- **TL-12 — 进度文案不是协议。** Task progress 只能使用当前 registry 的通用 Task/阶段 label；删除 TaskType 时必须同时删除旧文案，禁止让 UI 暗示已不存在的流程。
- **TL-13 — 进度持久化只有一个投影。** `reportTaskProgress` 可向 SSE 发送 provider/stream 细节，但 `Task.payload` 只能由 Task-owned runtime envelope 投影后写入；Creative Work 与 Creative Resource 的严格 payload parser 必须复用同一 envelope，禁止 worker 或领域 parser 各自维护字段白名单。

## 状态所有权

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| Task identity、status、attempt | Task service / Terminal Service | worker、Agent、UI |
| Task 持久进度 envelope | Task service + `progress-payload.ts` | 严格 payload parser、Task View |
| provider invocation/checkpoint | provider invocation fence | 当前 attempt worker |
| Task result | 当前 attempt worker，终态后不可变 | Terminal Service/materializer |
| Resource/Lineage | Creative Resource materializer 或同步 Resource Operation | Primary、Canvas、后续 Operation |
| billing freeze/settlement | billing owner + Terminal Service | profile、审批 UI |
| Wait 聚合与 continuation | OperationBatch/Wait + Terminal Service | Primary Agent |
| SSE watermark/event | Task/Outbox/SSE owner | Query sync、UI |

## 权威入口

- Task 定义：`src/lib/task/definition.ts`。
- Task 持久进度投影：`src/lib/task/progress-payload.ts`、`src/lib/task/service.ts`。
- 提交与原子创建：`src/lib/task/submitter.ts`、`transactional-create.ts`、`approved-plan-submitter.ts`、`src/lib/operations/submit-operation-task.ts`。
- attempt 与恢复：`src/lib/task/claim.ts`、`retry-policy.ts`、`reconcile.ts`、`src/lib/workers/shared.ts`。
- provider fence：`src/lib/task/provider-invocation.ts`、`src/lib/ai-exec/engine.ts`。
- 终态：`src/lib/task/terminal/**`。
- 持久 Outbox 与提交后即时运输：`src/lib/outbox/repository.ts`（唯一写入入口 + per-transaction commit collector）、`dispatcher.ts`（`dispatchCommittedOutboxCommands` 快路径 + 周期崩溃恢复）、`src/lib/workers/outbox.worker.ts`；dispatcher 只从同一持久命令恢复，不创建第二业务事实。快投递只依赖 prisma 与惰性 `queueRedis`，web 与 worker 进程均可调用；周期 dispatcher 仍只在 worker 进程启动。
- 结果物化：`src/lib/creative-resource/task-materializer.ts`、`creative-work-materialization.ts`。
- Agent 聚合：`src/lib/project-agent/operation-batch.ts`、`waits.ts`。
- 资源变化：`src/lib/workspace-resource/resource-impact.ts`、`resource-change-events.ts`、`src/lib/query/workspace-sse-event-sync.ts`。
- 视频合并：`src/lib/video-compose/video-merge-ffmpeg.ts`、`video-merge-audio.ts`。

## 验证

- `tests/contracts/task-definition-conformance.test.ts` 从生产 registry 穷尽所有 Task 定义。
- `tests/integration/task/create-task-dedupe.integration.test.ts`、`approved-operation-plan-batch*.integration.test.ts`、`outbox-delivery-lifecycle.integration.test.ts` 验证真实 MySQL/Redis 的原子提交、去重与恢复。
- `tests/integration/task/task-attempt-claim.integration.test.ts`、`task-reconcile-queue.integration.test.ts`、`provider-invocation-at-most-once.integration.test.ts` 验证 attempt、late/replay 和 provider fence。
- `tests/integration/task/project-agent-task-terminal-wait-concurrency.integration.test.ts` 验证多 Task Wait seal 与单 continuation。
- `tests/integration/task/outbox-delivery-lifecycle.integration.test.ts` 验证提交后精确即时入队（含事务 operation commit 后无需任何 dispatcher 周期即完成投递）、stale 恢复、毒消息与预期 contention 不消耗 delivery failure budget。

LLM 创作组合、媒体呈现和 FFmpeg 产物质量没有保留脚本 Journey 或 fixture 测试；它们属于真实输入下的人工/发布复验边界。

## 发布边界

本次删除固定创作表和旧 TaskType 的 migration 必须与新应用、worker 一次性切换；部署前排空旧版本 queued/processing Task 与非终态 Assistant Run/Wait。仓库只创建 migration 文件；未经数据迁移授权不得执行、回填或清理共享数据库。系统没有旧 payload 双读、旧表 fallback 或按 TaskType 猜测兼容逻辑。

## 历史回归

- 最初分镜页面把“用户关闭失败提示”实现为 Task `failed → dismissed` 持久状态写入；页面移除后，route、React mutation、Operation 与 service writer 仍保留，并在 Agent 工具面全开后让模型能够改写真实失败终态。该动作不删除或修复 Task，只让 resolver 把失败投影成取消，因此形成了第二种失败解释。当前 `dismiss_failed_tasks` 的 Tool/API/前端入口和唯一 writer 已删除，失败 Task 保持 `failed` 并由 Agent 如实解释或在输入修正后精确重试。数据库枚举与 reader 暂时只为读取既有 `dismissed` 历史行而保留；本次未获数据迁移授权，未回填或删除这些行，彻底移除该状态仍需单独迁移与排空。
- 旧 edit-first 为每个剧本、风格预览、镜头、BGM、视频段和最终渲染各建 TaskType、target 状态与 terminal projector，形成多套 writer。只删除 UI 卡片无法阻止 worker、投影与 guard 继续解释旧状态。当前整条专用链、表、writer、测试和治理入口一次删除，创作结果统一为 Resource，执行统一为六类通用 Task。
- 旧 `generationTaskId/renderTaskId` owner fence 把 Task 生命周期复制到每个领域表，随后 target projector 与 reconciler 同时解释失败。当前 Task 是运行事实，Resource status/materialization 是领域事实，终态只由 Terminal Service 交接；不再存在专用 target ownership registry。
- Creative Worker 初版在同步 Tool call 内返回完整结果，刷新后无法恢复且长片上下文膨胀。当前一个创作请求对应一个 `creative_work` Task，完整结果留在 Task.result，终态只向 continuation 投影引用并物化正式 Resource。
- 旧前台 suspension 把一个 Task 绑定为当前 Run 的固定下一步，导致用户无法在后台执行时继续创作。当前 OperationBatch/Wait 只聚合独立 Task，用户新 turn 与后台 continuation 互不伪造状态。
- 旧媒体完成依赖轮询、refetch、target overlay 与 timer 接力。当前 Terminal Event 携带 registry 声明的 resource impact，SSE 可 replay，Query 只重读正式事实。
- 旧最终混音把编码 EOF 与 `-shortest` 当作终止裁判，真实任务会在 99% 停滞。当前通用视频合并使用 canonical duration、PCM 临时原声、显式 `-t` 与 FFmpeg deadline。
- 旧 style parent Task 及其 migration preflight 在旧表删除后仍作为治理入口存在，反而要求恢复已删除身份。当前这些专用 guard/preflight 一并删除；新 migration 的排空条件由发布流程读取通用 active Task/Run/Wait 事实，不在应用仓保留旧类型统计器。
- MutationBatch 最初为旧 panel、voice line 和专用媒体 writer 提供整批撤销；这些 writer 删除后，生产代码已经没有创建调用，但两个撤销 Operation、独立 route、SSE event/replay/checkpoint、结果 `canUndo` 投影和 v3 游标水位仍继续声明这项能力。当前这些零 writer 运行时入口和第二状态协议已一起删除，SSE 一次切换为只包含 Task/Assistant/Resource 水位的 v4；数据库模型只为未获迁移授权的历史行暂留，不再有应用 writer、reader 或恢复入口，后续 schema/data 删除需单独迁移和排空授权。
- 长模型 Task 曾在具体 handler 内各自读取全局 timeout，attempt owner 只无条件写 heartbeat；这使 registry 不知道执行是否有界，也把“worker 进程还活着”误当成“供应商仍有进展”。第一版 registry deadline 为 `creative_work` 固定 5 分钟，真实长方向结果在首次校验拒绝后的纠正轮被 299.96 秒安全阀截断，证明该值会裁掉合法 attempt。当前 execution deadline 仍是 TaskDefinition 的唯一穷尽事实，但校准为 20 分钟 safety bound；通用 attempt owner 创建 AbortSignal 并以 canonical `GENERATION_TIMEOUT` 进入既有 registry retry policy，heartbeat 与 UI 阶段事件都只证明活动，不承担 stall 或完成裁决。
- Task terminal 曾只写 durable continuation Outbox，正常路径也等待周期 dispatcher；Outbox 与 continuation claim 又使用十分钟级 lease，worker 被重启后虽有完整持久事实却长期无人可领取。预期的前台 Run/Choice contention 还会增加 deliveryCount，最终把可恢复占用误判成 dead delivery。当前 terminal commit 后立即 enqueue 精确 Outbox IDs，失败仍由同一持久 dispatcher 恢复；运输与 continuation claim 使用 30 秒 lease/heartbeat，typed defer 原子撤销本次 deliveryCount。没有新增轮询、第二队列协议或客户端续跑入口。
- Task terminal 获得 commit 后即时投递后，提交路径（Operation 事务、批准计划 commit）仍把 Outbox 命令 id 丢弃在事务内：`createWorkspaceResourceBroadcastsInTransaction` 返回 void，`transactional-create` 的 lifecycle/enqueue 命令无人接收，两个事务 owner commit 后不做任何投递；而周期 dispatcher 只在 worker 进程启动，web 进程 instrumentation 只启动 reconciler。后果是 worker 在跑时新画布节点与任务入队固定晚约 5 秒，worker 不在时提交路径的 SSE 永远不发、用户必须刷新——终态防线（上一条）没有覆盖对称的提交路径。当前 `createOutboxCommandInTransaction` 作为唯一写入入口把 id 记录进 owner 显式绑定的 per-transaction collector，`invokeProjectAgentOperation` 与 `invokeApprovedOperationPlan` 两个事务 owner commit 后立即调用同一个 `dispatchCommittedOutboxCommands`，workspace broadcast writer 与 `transactional-create` 同时返回精确 id；快投递失败只记结构化日志，周期 dispatcher 角色收敛为纯崩溃恢复。`submitOperationTask`/`submitter` 自有事务与 choice-commit 外层事务的 owner 尚未接入快投递（其中 web reference/video merge 的 broadcast 已由调用方 commit 后补投），仍依赖周期扫描，属已声明慢路径而非第二状态解释源。
- `get_task` 首次公开严格字段 Schema 时仍用 `includeEvents` 与独立可选 `eventsLimit` 表达事件读取；关闭或省略 events 时携带 limit 在 Schema 中合法，却被 executor 静默忽略。当前输入改为 `events.kind=none|include`，只有 include 分支拥有可选 limit，Task route 也拒绝 limit 与关闭事件的矛盾查询后再构造同一 canonical 分支。Task 生命周期和事件 writer 均未改变；本次只收敛读取命令语义。

## 修改检查表

1. 新执行是否登记在唯一 Task registry，还是增加了第二提交/worker/终态入口？
2. Task 与 Resource 的 writer 是否各自唯一，失败、取消、重试、晚到和 replay 是否明确？
3. 输入是否只冻结精确 Resource ID，并由服务端回库校验 scope？
4. 是否删除被替代的 TaskType、target、文案、测试、guard 与查询，而非增加兼容分支？
5. 是否按风险运行了适用的保留验证，并明确 DB/Redis/provider 与真实产品盲区？
