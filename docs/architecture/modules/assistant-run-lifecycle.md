<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Thread、Turn 与交互生命周期

## 为什么是这样

Codex app-server 拥有单个 Agent 进程内的 Thread/Turn 与原生交互；Wao 拥有产品身份、准入、持久
View、刷新恢复、计费审批和跨进程唤醒。Session Manager 只做 placement、互斥、恢复和空闲停止，
不解释模型思考或工具选择。

产品 View 独立持久是刻意的：刷新不读 Codex 本地文件格式，UI 不解析流内容。Runtime 可以被替换，
聊天历史不能跟着一起丢。

## 不变量

- **ARL-01 — Project scope。** Product Thread 只属于 `(userId, projectId)`；不从消息推断 scope。
- **ARL-02 — 一个活跃 Turn、一个消息命令裁判。** 聊天发送是唯一准入入口，且"按稳定 sourceId
  回放裁决 → 读当前 Turn → 选择 start/steer → 完成 handoff"必须在同一个 Project transition 内
  完成，不得在锁外预判目标。每条用户消息先以 project-scoped 命令 identity 持久化，原始客户端命令
  的 hash 在附件解析前冻结。steer 在调用 runtime 前为 pending，只有 runtime 明确接受、返回的
  Turn identity 一致且原子确认后才成为 accepted；pending/uncertain 永不自动重发。该命令事实不挂
  Thread/Turn 外键——clear 只能删除对话 View，不能删除延迟重试的去重 tombstone。
- **ARL-03 — 产品 View 独立持久。** 所有对话与交互事实由 projector 写入数据库；刷新不读 Runtime
  本地格式。一个 Turn 在每次已接受 steer 处冻结当前 assistant segment，后续输出进入递增 segment，
  因此顺序始终是"已发生内容 → 用户追加 → 后续内容"。
- **ARL-04 — 原生请求原生响应。** server request 以 `(turnId, runtimeRequestId)` 唯一；审批卡与
  选择卡只响应该 request。创建、决定、取消与回写共享 Project/Thread/Turn 锁。重复响应幂等；
  clear/cancel 后晚到的响应不得重新产生 waiting 状态或文件副作用。
- **ARL-05 — 两类审批同一 UI、不同权威。** shell/patch/sandbox 权限响应 Runtime request；付费媒体
  响应 Wao 的 Snapshot/预算授权。UI 可统一展示，但不能互相授权。两层 timeout 都必须显式覆盖有界
  用户决策窗口，内层短于能力凭据寿命——不能让任一默认值与审批竞争。
- **ARL-06 — Runtime 终态不是 Task 终态。** Turn 可以在媒体 Task 仍运行时结束；Task 继续完成，
  按持久批次 identity 至多一次注入新 Turn。
- **ARL-06A — FollowUp 是当前运行投影，不是第二份 Task 历史。** 当前 Task 只由 Resource 的
  `taskId` 关联裁决；重试后旧成员保留在审计与聊天中，但不再进入当前运行投影、focus 或失败汇总。
  只有被同一 Resource 的新 Task 明确替代的成员才可移除，缺失目标不能静默隐藏。
- **ARL-07 — 崩溃可恢复且终态 writer 唯一。** 有 live projector 的退出只由 projector 等待全部
  消息快照后结算；Manager 只停止 placement 与保存不透明 Runtime state，不抢写第二终态。释放 ownership 或创建下一
  writer 前必须先观察终态已提交；结算失败保持失败并阻断 placement，不能被 catch 后当成功。
  只有已持久化 Runtime 状态与绑定才允许 resume；未形成 durable binding 时，新 Thread 在首个新
  Turn 前从产品 View 恰好一次注入历史。
- **ARL-11 — 刷新可续接中途增量。** 每个可见 chunk 取得单调 seq；持久快照同时保存完整前缀与该
  watermark。SSE bootstrap 必须缓冲订阅建立后的事件，客户端跳过已含 seq、只接受严格下一个 seq。
  无 watermark 的猜测、丢弃 bootstrap 事件或遇缺口后展示截断尾段都禁止。
- **ARL-12 — 主动停止也有 projector 终态。** 预期内的进程退出只表示 Manager 主动停止，不表示
  Turn 已完成；仍活跃的 projector 必须等待其持久队列、结算 interrupted 并释放订阅。
- **ARL-13 — cancel 是持久副作用 fence。** queued Turn 可在绑定前原子取消，后续绑定必须拒绝；
  running/waiting 的取消与所有 pending 交互在同一 Project 锁下关闭。晚到审批、Grant、Task、
  同步写或子 Agent 不能越过取消标记开始新副作用。
- **ARL-14 — clear 先 claim 再停 placement。** clear 标记是清空进行中的唯一 fence；claim 后新
  准入、模型网关、MCP binding、审批证明与所有 effect 事务立即失败关闭。已归档请求的重放直接返回，
  绝不停止后来创建的新 Thread/Turn。
- **ARL-15 — secret input fail closed。** 当前没有独立 secret authority；标记为 secret 的原生输入
  请求在写普通消息前拒绝。
- **ARL-16 — 重连替换旧连接而不扩容。** 每个标签页对每个 Project 持有稳定的 session identity；
  服务端另发本次连接的 owner token。相同 identity 重连原子接管现有租约，不增加 cardinality；
  旧 owner 之后不能续租或释放新连接。恢复不得依赖等待 TTL。
- **ARL-17 — 错误与继续动作都由持久事实裁决。** projector 只按钉死协议读取错误事件，将最终失败
  一次性写为稳定 code；UI 不解析流内容、日志或 Provider 文案猜原因。仍可重试的 attempt 不是产品
  Turn 终态。已进入 Runtime 且非用户取消的失败只能以新 source identity 创建新 Turn；只有从未
  进入 Runtime 的消息才允许忠实重发。
- **ARL-18 — 工具输出与长期 Task 展示分权。** projector 只把结构化结果作为业务输出；transport
  外壳与工具完成不能把异步提交解释成媒体成功。聊天保留本 Turn 的调用与错误，但不永久渲染项目
  Task 批次状态；资源与 Task 状态只由正式 View 展示。已删除的中间提交工具即使仍存在于历史消息，
  也不得继续渲染其局部成功/失败计数来冒充当前媒体结果。
- **ARL-19 — 聊天附件只物化一次，不旁路专业生产。** 注册后唯一变成 ready Resource。主 Agent
  把 canonical id/version 与用途交给固定专业子 Agent，由后者在 generation items 中声明精确引用；
  父 Agent 验证后调用对应媒体 Operation，不能按消息内容、路径或最近附件猜输入。

## 权威入口

- 产品 Turn/View/projector：`src/lib/assistant-runtime/**`
- placement / ownership / 恢复：`src/lib/codex-runtime/runtime-session-manager.ts`
- Task 接力：`src/lib/agent-turn/**`
- 准入与命令：`/api/projects/[projectId]/assistant/**`

## 踩过的坑

- steer 首版先调 runtime 再写数据库：HTTP 重试、runtime 接受后持久化失败或 Turn 先结算，都会让
  模型收到两次而产品 View 只显示一次 → 没有先于 runtime 调用的 identity 裁判 → project-scoped
  命令表在 runtime 调用前裁决 payload hash，无法证明是否交付的永久标 uncertain 且拒绝自动重发。
- 第一版 durable steer 把 claim identity 限定在 `(threadId, sourceId)`，而普通发送另有一套 replay
  解释：已完成旧请求的延迟重试可在另一个 Turn 活跃时被误选为 steer；clear 的级联删除又会抹掉
  tombstone → 同一事实两套 identity 解释 → 统一为不随 clear 删除的 project-scoped 命令表。
- 发送首版在 Project transition 外读 active Turn 再分别调用带锁的 submit/steer；并发消息或 clear
  可在选路与 handoff 之间改变事实 → 读与写不在同一临界区 → 三步合并为同一 transition（ARL-02）。
- 取消首版只写取消标记，queued Turn 仍会被绑定，等待审批的晚到 accept 仍可签发 Grant 或写资源 →
  取消不是副作用 fence → 所有 effect 事务共享同一 Turn fence（ARL-13）。
- clear 首版只用于准入，未进入模型/MCP/effect guard，已 claim 的清空仍可能继续产生模型调用、
  付费任务或目录写入 → fence 覆盖面不完整 → clear 覆盖全部能力边界并按同一锁序检查（ARL-14）。
- 工具 `item/started` 曾只存在于易失 SSE，只有完成才进入产品 View；进程退出或用户停止发生在工具
  执行中时，该工具刷新后完全消失 → 未完成事实没有持久表示 → started 立即持久化，非正常终止时
  一次性结算为 output-error，并区分"已停止"与"执行失败"。
- 刷新续流首版只补缺失的 text-start 而没有持久 watermark，bootstrap 还主动丢弃订阅期间的增量，
  刷新可长期显示截断尾段 → 用重建猜测代替持久前缀 → durable prefix 与 seq 同存，严格续号
  （ARL-11）。
- 旧链路已建立稳定错误码与本地化边界，但 Runtime 切换后的终态持久化又固定写一个通用失败码并丢弃
  详情，socket 中断、配额、鉴权重新坍缩成同一个"服务器错误" → 同一可见性不变量换 writer 复发 →
  projector 是终态错误的唯一解释者，映射到共享 error registry。
