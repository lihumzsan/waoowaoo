<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Thread、Turn 与交互生命周期

## 设计理念

Codex app-server 拥有单个 Agent 进程内的 Thread/Turn 与原生交互；Wao 拥有产品身份、准入、持久 View、刷新恢复、计费审批和跨进程唤醒。Session Manager 只做 placement、互斥、恢复和空闲停止，不再解释模型思考或工具选择。

## 不变量

- **ARL-01 — Project scope。** Product Thread 只属于 `(userId, projectId)`；不存在 Episode thread 或从消息推断 scope。
- **ARL-02 — 一个活跃 Turn、一个消息命令裁判。** 同一 Project Runtime 同时最多一个 Turn。聊天发送是唯一准入入口，且“按稳定 `sourceId` 回放裁决 → 读取当前 Turn → 选择 start/steer → 完成对应 handoff”必须处于同一个 Project transition：无活跃 Turn 时 start，已绑定且 running 时使用同一 Turn 的 Codex `turn/steer`；queued 或等待原生交互时普通文本明确返回 busy。每条用户消息先以 `(projectId, userId, assistantId, sourceId)` 写入唯一 `ProjectAssistantMessageCommand`；原始客户端命令的 hash 在附件解析前冻结，`kind` 只可为 `turn` 或 `steer`。steer 在调用 runtime 前为 pending，只有 runtime 明确接受、返回的 runtime Turn identity 一致且 MySQL 原子确认后才成为 accepted；pending/uncertain 永不自动重发。该命令事实不挂 Thread/Turn 外键，clear 只能删除对话 View，不能删除延迟 HTTP retry 的去重 tombstone。明确取消用 `turn/interrupt`。不得在锁外预判目标，也不得另建第二套 steer 或 submit replay 状态机。
- **ARL-03 — 产品 View 独立持久。** 用户消息、assistant item、Plan、Goal、request_user_input、Web Search、命令、Diff、MCP、Skill、Subagent、审批与 compaction 由事件 projector 写入 MySQL View；刷新不读取 Codex 本地文件格式。同一 Turn 的 assistant item 使用一个稳定消息 identity，runtime 接受的 steer 用户消息必须按 identity 幂等地插在该 Turn 的 assistant 汇总之前，不能因 assistant 快照较早创建而出现在回答之后。原生 Subagent 的 child Thread 生命周期不占用或结算 Project 的 parent Turn slot，只由 parent collab/subAgent item 投影。
- **ARL-04 — 原生请求原生响应。** Codex server request 以 `(turnId, runtimeRequestId)` 唯一；Wao 审批卡/选择卡只响应该 request。interaction 的创建、决定、取消与 resolved 回写共享 Project、Thread、Turn 锁；把决定交回 app-server 与 cancel/clear 使用同一 Project transition。重复响应幂等，clear/cancel 后晚到响应不得重新产生 waiting 状态或文件副作用。
- **ARL-05 — 两类审批同一 UI、不同权威。** Shell/patch/sandbox 权限响应 Codex request；付费媒体响应 Wao PlanSnapshot/预算授权。Wao MCP server 在 Codex 层固定为无需通用 tool approval，只能由 Wao elicitation 请求一次业务授权；UI 可统一展示，但不能互相授权。Codex 的外层 Wao tool timeout 与 MCP SDK 的内层 elicitation timeout 都必须显式覆盖有界用户决策窗口，不能让任一 60 秒默认值与审批竞争；内层窗口须短于 capability token 与外层 tool timeout。
- **ARL-06 — Runtime 终态不是 Task 终态。** Turn 可以在媒体 Task 仍运行时结束/停止；Temporal 继续完成 Task。FollowUpBatch 按持久 batch identity 至多一次向 Product Thread 注入新 Turn。
- **ARL-06A — FollowUp 是当前运行投影，不是第二份 Task 历史。** WorkspaceResource 的当前 Task 只由其 `taskId` 关联裁决；重试后，旧 FollowUp member 仍保留在持久审计与聊天中，但不得继续进入当前项目操作、Canvas focus 或失败汇总。只有明确被同一 Resource 的新 `taskId` 替代的 member 才可从运行投影移除；缺失目标不能静默隐藏。
- **ARL-07 — 崩溃可恢复且终态 writer 唯一。** 有 live projector 的 Runtime 退出只由 projector 等待全部消息快照后结算 Turn；Manager 只停止 placement、capture 工作区，不抢写第二终态。Manager 释放 ownership、销毁 materialization 或创建下一 writer 前，必须先观察 Product Turn 终态已提交；终态写入失败的 settlement barrier 保持失败并阻断 placement，不能被 catch 后当作成功。进程整体崩溃后，尚为 `queued` 的 Turn 从未跨过 app-server handoff，`reconcileBeforeStart` 必须保留并由同 identity 重放继续启动；已 claim 为 running 但尚无 `runtimeTurnId` 的 start 结果不确定，user command 永久标为 uncertain、原 Turn 终结，task follow-up 则原子退回 ready 后重新准入；已绑定的废弃 Turn 才按 known runtime identity 结算 interrupted。只有持久化过 Codex state 和 thread binding 才允许 resume；未形成 durable binding 时，新 Runtime Thread 在首个新 Turn 前从产品 View 恰好一次注入历史。
- **ARL-08 — i18n。** UI 状态与错误来自当前 locale；Codex 原始协议方法名不得直接作为用户文案。
- **ARL-09 — Collaboration mode 在 Turn 内冻结。** Agent/Plan 模式写入 Turn context。活跃 Turn 期间 UI 锁定模式选择；追加消息只有模式与当前 Turn 一致才可 steer，不允许静默丢弃用户选择或中途改写执行语义。
- **ARL-10 — Parent 终态关闭 child writer。** Session Manager 以 `(childThreadId, childTurnId)` 追踪原生 Subagent；interrupt RPC 只表示请求已接收，只有匹配的 `turn/completed` 才删除 child，interrupt/completion 超时必须 force-stop。使用过 Subagent 的 Parent 任意终态先循环排空全部 child，再 graceful stop 整个 app-server generation，随后才允许 capture/checkpoint；下一条 admission 必须等待 placement 自动 recover/resume，不能把内部重启窗口暴露成用户失败。Projector 同时把仍活跃 child 投影为 interrupted，父终态后不得留下共享工作区 writer。
- **ARL-11 — 刷新可续接中途增量。** 每个可见 chunk 取得单调 stream seq；MySQL message snapshot 同时持久化完整前缀与该 watermark。SSE bootstrap 必须缓冲订阅建立后的 stream 事件，客户端跳过 `seq <= watermark`、只接受严格下一个 seq，并为未完成 text/reasoning 重建 start。无 watermark 的猜测、丢弃 bootstrap stream 或遇到缺口后展示截断尾段都禁止。
- **ARL-12 — 主动停止也有 projector 终态。** expected 进程退出只表示 Session Manager 主动停止，不表示 live Turn 已完成；仍活跃的 projector 必须等待其消息持久队列、结算 interrupted 并释放订阅。Manager 不写并发终态；无 live projector 的孤儿只由下一次 admission reconcile。
- **ARL-13 — Cancel 是持久副作用 fence。** queued Turn 可在绑定 Runtime 前原子取消，后续 bind 必须拒绝；running/waiting Turn 的 cancel 与所有 pending/decided interaction 在同一 Project 锁下关闭。晚到审批、Grant、Task、同步写或子 Agent 不能越过 `cancelRequestId` 开始新副作用。
- **ARL-14 — Clear 先 claim 再停 placement。** Thread 的 `clearRequestId` 是清空进行中的唯一 fence；claim 后新 admission/follow-up、模型网关、MCP binding、审批证明与所有 effect transaction 立即失败关闭，active placement 在等待 capture/settlement 前先 force-stop，随后才归档。已归档请求的重放直接返回，绝不再停止后来创建的新 Thread/Turn。
- **ARL-15 — Secret input fail closed。** 当前没有独立 secret authority；`isSecret=true` 的原生输入请求在写普通消息/interaction JSON 前拒绝。普通 interaction 的 decided response 可持久化并在 runtime handoff 失败后只重放同一 response，UI 不允许改答。
- **ARL-16 — SSE 重连替换旧连接而不扩容。** 浏览器标签页为每个 Project 持有稳定的 session connection identity；服务端另发本次连接的唯一 owner token。相同 identity 重连原子接管现有 user/project/global 租约，不增加 cardinality；旧 owner 之后不能 renew 或 release 新连接。不同标签页仍受既有三层上限约束，进程重启、页面刷新和 EventSource 重建不得依赖等待 TTL 才恢复。

## 状态所有权

| 事实 | Owner / writer |
| --- | --- |
| Codex Thread/Turn 内部状态 | app-server；Wao 保存不透明 resume state |
| Product Thread/Turn/View | AssistantRuntime persistence/projector |
| 活跃 Runtime placement | Runtime Session Manager + ownership claim |
| 原生 request 等待/结算 | AgentTurnInteraction + runtimeRequestId |
| 付费授权 | OperationPlanSnapshot / ApprovalGrant / Billing ledger |
| 长期媒体终态 | Task Terminal Service / Temporal |
| Task 完成后的唤醒 | FollowUpBatch 唯一 writer |

## 正常与异常时序

用户消息由一个发送入口决定 start 或 steer；先按 project-scoped 消息 identity 查询持久命令，再做附件准备和 active Turn 选路。新 Turn 的用户消息与 `turn/accepted` 命令原子持久化；steer 先写同表 `steer/pending`，runtime 接受后在同一事务中确认并把用户消息插入稳定 assistant 汇总之前。同 identity 的 accepted 请求只回放 receipt，未确认请求 fail-closed 且不重发；即使 clear 后重建 Thread，旧命令也不能进入新一代 Turn。start/resume 成功后开始 Turn，事件逐个投影，结束时 capture Workspace 与 Codex state。断线只影响 SSE 传输，刷新从 MySQL View 恢复。Manager 重启通过 ownership 与持久 binding reconcile；晚到旧 Runtime 事件因 Turn/runtime identity 不匹配而拒绝覆盖。

## 权威入口

- `src/lib/assistant-runtime/**`
- `src/lib/codex-runtime/runtime-session-manager.ts`
- `src/lib/agent-turn/**`
- `/api/projects/[projectId]/assistant/**`
- `src/features/project-workspace/components/workspace-assistant/**`

## 验证

真实协议 smoke 与持久层场景覆盖 start/resume、steer、interrupt、request response、进程退出、Manager 重启、断线刷新、重复消息、晚到事件、Task late completion 和 FollowUpBatch 至多一次。关键 UI renderer 由共享 View union 穷尽，未知关键 item 明确显示错误。

## 修改检查表

- 是否把 Codex 内部状态误当成产品聊天事实，或反过来？
- 是否出现第二个 active-turn/steer/interrupt 判定器？
- 原生审批和计费审批是否只统一外观、没有混用 authority？
- Runtime 退出后 Task 是否仍可完成且只唤醒一次？

## 历史回归

- Agents SDK 时代曾允许运行中追加，但 Codex clean cutover 只保留了底层 `turn/steer`，聊天 route 仍无条件 start，导致追加被 Project busy 映射成通用“资源状态冲突”。当前唯一发送入口显式选择 start/steer，并把真正无法接收的窄窗口投影为 `AGENT_THREAD_BUSY`。
- Codex 通用 MCP approval 与 Wao 不可变计划审批曾串联出现两次确认。当前只对 Wao MCP server 关闭通用工具确认，Shell/patch/sandbox 的 Codex authority 保持不变。
- Wao 生产工具首次真实执行时，规划耗时与用户审批共同占用两个互不相同的 60 秒默认值：Codex 的 MCP tool timeout，以及 MCP SDK `server.elicitInput` 的 server-to-client request timeout。只延长外层后，内层仍会先中止，审批卡继续成为“可见但无法继续”的假交互。当前外层 tool timeout 与 capability token 生命周期一致，内层 elicitation 留出五分钟失效余量；计划、授权、取消和幂等仍由 Wao 权威链路裁决，不用无限 timeout 或 UI timer 承担正确性。
- Session Manager 曾把原生 Subagent 的 child `turn/started` 当成未知 Product Thread 并触发 Runtime recovery，表现为 Subagent 卡刚成功、父 Turn 随即“服务器停止”。当前只让已映射 Product Thread 改写 active slot；合法 child Thread 由原生协作 item 投影并忽略其独立 Turn 终态。
- 未完成首个 durable checkpoint 的 Thread 被中断后，产品聊天仍有完整历史，但新 Codex Thread 只收到“继续”这一条消息，因而错误声称不知道原目标。当前新 Runtime Thread 在第一个 Turn 前从 MySQL Product View 一次性 seed 历史；已 resume 的 Codex Thread 和同一新 Thread 的后续 Turn绝不重复注入。
- “未送达”曾把所有 failed/interrupted Turn 都当成消息未进入模型；用户主动停止一个已执行并产生文件的 Turn 后，UI 因而错误提示“服务器停止”并提供可重复副作用的整条重发。当前 `cancelReason=user_cancelled` 单独投影为用户停止；只有 `startedAt` 为空、从未到达 Runtime 的 Turn 才标记未送达并允许忠实重发。
- Manager/进程退出后旧 Redis ownership 最多保留一个租约窗口；新进程在此期间收到消息时曾把 `ASSISTANT_RUNTIME_OWNERSHIP_BUSY` 泛化为可重试的外部故障，UI 因而显示“助手未能完成”而不是准确的运行中语义。当前唯一命令错误映射将租约竞争归入 `AGENT_THREAD_BUSY`；租约仍是跨进程唯一裁判，不能由新进程抢占或用第二 writer 绕过。
- FollowUp Session View 曾无条件显示最近所有批次。失败媒体以同一 WorkspaceResource identity 成功重试后，旧失败 Task 已失去 Resource 的当前 `taskId` 绑定，UI 却仍显示“失败 4”，把审计历史伪装成当前项目状态。当前运行投影以现有 WorkspaceResource 的 `taskId` 为唯一 current-attempt 关联；被新 Task 明确替代的旧 member 不再参与当前批次、Canvas focus 或错误汇总，真实未替代失败仍保持可见。
- 重复工具行聚合曾从 assistant-ui 的组件局部 `useMessage` 状态反查同组调用；Codex clean cutover 后该局部状态不再暴露原始 `parts`，两个已完成 shell 因查不到 call identity 被默认计为 running，并在 Turn 结束后永久旋转。当前聚合状态只由 Provider 已持有的权威 `UIMessage[]` 与每个原始 `toolCallId/state/output` 一次派生；组件不再维护第二份调用集合或把缺失当运行中。
- Codex 原生 Plan 在两个并行 Subagent 工作时会合法地产生多个 `inProgress` 步骤，首版 Wao 投影却沿用了旧自研 Plan“最多一个进行中”的校验，导致一次展示数据持久化失败中断整个创作 Turn。当前 Plan View 完整接受 Codex 原生步骤集合，只校验条目形状、状态枚举和大小边界；并行事实不得为迎合旧 UI 被伪装成串行。
- 媒体 Task 已全部完成且当前 Turn 已明确交付时，早期失败 Turn 留下的最后一个 Plan 步骤仍停在 pending，UI 因而同时显示“成功 4/4”和“计划 3/4”。Task 终态不能反向猜测或改写模型计划，否则会产生第二个 Plan writer；当前 Codex 仍是唯一 Plan writer，Runtime 边界要求其在每个 Turn 结束前按当前授权范围完成或移除过时步骤，持久层在全部完成时清空 Plan View。
- 开发热更新曾在 Provider 与调用方短暂处于不同模块版本时把缺失的 `messages` 直接交给工具聚合器，整条聊天因 `flatMap` 抛错白屏。正式 View 类型仍要求完整消息与 Turn，但渲染边界对热更新/旧缓存缺参使用空集合，只表示“当前没有可聚合条目”，不伪造任何工具生命周期。
- 流式 overlay 曾在首个 durable message snapshot 出现时立即关闭；同一 Turn 的下一条 SSE 又从 seq 0 重建，真实 seq 大于 1 后被当成缺口再次关闭，导致刷新或工具快照后的后续内容消失。当前 durable message 是 overlay 的已确认前缀，活动 Turn 的 overlay 继续替换同 identity 的 View 条目；刷新后首个新事件从持久前缀续接，不再让“已经持久化”错误地等同于“Turn 已终止”。
- Subagent UI 曾把父 Turn 的终态套给全部 child，运行中 message 又因数据库 `assistantMessageId` 只在结算时写入而默认显示完成。当前活动 Turn 的 message identity 由稳定 Turn/attempt 派生；Projector 直接消费原生 child `turn/started|completed`，把每个 child thread 的独立 active/completed/interrupted 事实持久化为消息 data part，UI 不再用父线程或 spawn 工具完成状态猜测 child 生命周期。
- 工具 `item/started` 曾只存在于易失 SSE overlay，只有 `item/completed` 才进入 Product View；进程退出、协议失败或用户停止发生在工具执行中时，该工具刷新后会完全消失。当前 started tool 立即以 input-available 持久化；Turn 非正常终止时 Projector 将所有尚未完成的工具一次性结算为 output-error，历史永远保留其输入与被中断事实。`ASSISTANT_RUNTIME_TOOL_INTERRUPTED:*` 只表示用户或 Runtime 停止，View 必须显示“已停止”，不得误报“执行失败、请重试”；真正的协议、provider 与业务错误仍显示失败。
- 统一消息入口首次按“是否存在活动 Turn”选择 submit 或 steer，却没有先比较稳定的用户消息 `sourceId`；同一 HTTP 请求在原 Turn 活动期间重试时会被当作追加消息再次注入。当前相同 `sourceId` 必须回到 admission 的幂等 replay，只有不同 identity 的新消息才能 steer，活动但尚不可 steer 的 Turn 明确返回 busy。
- 刷新后的 overlay 首版只把 `lastSeq` 移到首个新事件前，并把持久消息作为前缀，却没有恢复 AI SDK 对 active text/reasoning part ID 的协议状态；首个 delta 会因缺少 start 抛错并关闭流。当前客户端按 item ID 补发 start，仅把后续增量追加为临时 part，终态 View 仍是最终权威。
- 运行中模式按钮首版仍可切换，而服务端把带新模式的发送转换为 steer 后静默丢掉模式；当前模式持久化到 Turn context，UI 在 active Turn 锁定，服务端对不一致模式返回 typed conflict。
- Parent Turn 结束首版会立即退订 projector，却不结算已显示 active 的 Subagent，child 甚至可在父 checkpoint 后继续写共享目录。当前 parent 终态同时中断 child runtime Turn，并将所有 active child data part 结算为 interrupted。
- 主动 stop/recover 首版把 app-server 退出标记 expected，projector 因而忽略终态并永久占有 live Turn/订阅。当前任何进程退出都由 live projector 等待持久消息队列并结算 Turn；Manager 不再并发写终态，没有 projector 的 orphan 只由下一次 admission reconcile。
- Subagent 首版把 child `runtimeThreadId` 同时当作 thread/turn identity，并 fire-and-forget interrupt 后立即 checkpoint；UI 虽显示中断，后台 child 仍可能晚到写文件。当前保存真实 child Turn ID，Parent 终态等待 interrupt handoff 后才 checkpoint/接纳下一 Turn。
- 刷新续流首版只补了缺失的 text-start，却没有持久 stream watermark，SSE bootstrap 还主动丢弃订阅期间的增量；刷新可长期显示截断尾段。当前 durable prefix 与 seq 同存、bootstrap 缓冲、客户端严格续号，真实浏览器刷新 220 段输出仍保持完整。
- Clear 首版在检查 archive replay 前按 Project 停止 Runtime；旧 DELETE 重试会误杀清空后新建的 Turn。当前先用 Thread `clearRequestId` claim，新 admission 被同一锁拒绝，archive replay 不触碰当前 placement。
- Cancel 首版只写 `cancelRequestId`，queued Turn 仍会被 bind，waiting approval 的晚到 accept 仍可签发 Grant 或写资源。当前取消原子关闭 interaction，所有同步/Temporal effect transaction 与 Project 锁共享 Turn fence。
- Send 首版在 Project transition 外读取 active Turn，再分别调用带锁的 submit/steer；并发消息或 clear 可在选路与 handoff 之间改变事实，造成错误 busy 或 stale steer。当前读目标、选路和 handoff 是同一个 Project transition，server request response 也与 cancel/clear 串行。
- Steer 首版在 runtime 接受后把用户消息追加到 Thread 尾部；若该 Turn 的 assistant 稳定消息已经由早期 reasoning/tool 快照创建，后续快照只原位 upsert，导致最终 View 把追加要求显示在回答之后。当前 steer 用户消息以自身 identity 幂等写入，并固定插在同一 Turn 的 assistant 汇总之前；消息持久化仍以 runtime 已接受 handoff 为前提，失败不会伪造已送达。
- Steer 排序修复后仍直接先调用 runtime、再写 MySQL；HTTP 重试、同 identity 不同 payload、runtime 接受后持久化失败或 Turn 先结算时，可能让 Codex 收到两次而产品 View 只显示一次。当前 project-scoped `ProjectAssistantMessageCommand` 是所有用户消息在 runtime 调用前的唯一 identity/payload 裁判，accepted 才可幂等回放；任何无法证明是否交付的 steer 永久标为 uncertain 并拒绝自动重发，同时校验 app-server 返回的 Turn identity。
- 第一版 durable steer 仍把 claim identity 限定在 `(threadId, sourceId)`，而普通 submit 由另一套 Turn replay 解释：已完成旧 submit 的延迟重试可在另一个 Turn 活跃时被误选为 steer；clear 的级联删除又会抹掉 accepted/uncertain tombstone；且附件准备先于 replay，已接受命令会因附件后来不可用而无法回放。当前所有用户消息统一使用不随 clear 删除的 project-scoped 命令表，原始 payload hash 在任何附件读取前裁决，旧请求不会跨 Thread 代际执行。
- 统一消息命令首版仍把 `queued` 和已跨 runtime handoff 的 active Turn 一起在 placement reconcile 时终结；相邻的 `running + runtimeTurnId=null` 又被普通 replay 谎报为 accepted，进程崩溃后会永久 busy。当前 queued 是唯一可安全恢复状态；未绑定 start 必须先取得新 placement ownership 再 reconcile 为 uncertain，不能自动重发。task follow-up 的同一窗口不丢通知，而是删除未绑定 Turn 并把原 batch 原子退回 ready。
- Parent completion 首版在异步 continuation 中才登记 workspace checkpoint，下一 Turn 可在 persistence queue 尚未包含前一轮捕获时启动；终态写失败还会被 settlement 的 rejection handler 当成已结算。当前原生 completion 同步把 capture/checkpoint 接入 sticky persistence queue，新 Turn 必须等待；只有成功终态删除 barrier，失败会 force-stop 并保持 placement blocked。
- Clear 首版只把 `clearRequestId` 用于 admission，却没有进入模型/MCP/effect guard，且 stop 在等待 persistence/child drain 后才终止 active app-server；已 claim 的清空仍可能继续产生模型调用、付费任务或目录写入。当前 clear fence 覆盖全部能力边界，数据库副作用统一按 Project→Thread→Turn 锁序检查，active Runtime 先停止 writer 再等待持久交接。
- Child drain 曾在 interrupt 空回执后立即删除 writer，即使改成等待 completion，已排队的 grandchild start 仍可能落在已完成 Promise 之后。当前 child identity 只由匹配 completion 关闭并有有界超时；任何使用过 Subagent 的 Parent 终态都会关闭整个 app-server generation，再从 durable state 恢复，因此协议延迟不能跨 generation 写入下一 Turn。
- SSE 连接上限首版用每次 HTTP 请求的随机 UUID 作为 Redis ZSET member；开发服务重启、页面刷新或 EventSource 显式重建后，旧 lease 在 TTL 内仍占位，新请求被当成额外连接并错误限流。仅复用 member 又会让旧 handler 的 renew/release 覆盖新连接。当前标签页 session identity 决定稳定 member，每次 HTTP 连接的 owner token 作为 fencing；重连原子接管，旧连接随后失去续租和释放权。
