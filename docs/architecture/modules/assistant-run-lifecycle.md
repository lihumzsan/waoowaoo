<!-- architecture-module: assistant-run-lifecycle -->

# Assistant Thread、Turn 与交互生命周期

## 为什么是这样

Codex app-server 拥有单个 Agent 进程内的 Thread/Turn 与原生交互；Wao 拥有产品身份、准入、持久
View、刷新恢复、破坏性确认和跨进程唤醒。Session Manager 只做 placement、互斥、恢复和空闲停止，
不解释模型思考或工具选择。

产品 View 独立持久是刻意的：刷新不读 Codex 本地文件格式，UI 不解析流内容；它服务展示与业务归因，
不充当模型上下文备份。模型 history 只由 Codex 原生 Thread 持久化。

## 不变量

- **ARL-01 — Project scope。** Product Thread 只属于 `(userId, projectId)`；不从消息推断 scope。
- **ARL-02 — 一个活跃 Turn、一个消息命令裁判。** 用户聊天发送是唯一用户消息准入入口，且"按稳定 sourceId
  回放裁决 → 读当前 Turn → 选择 start/steer → 完成 handoff"必须在同一个 Project transition 内
  完成，不得在锁外预判目标。每条用户消息先以 project-scoped 命令 identity 持久化，原始客户端命令
  的 hash 在附件解析前冻结。steer 在调用 runtime 前为 pending，只有 runtime 明确接受、返回的
  Turn identity 一致且原子确认后才成为 accepted；pending/uncertain 永不自动重发。该命令事实不挂
  Thread/Turn 外键——clear 只能删除对话 View，不能删除延迟重试的去重 tombstone。持久 Task follow-up
  是独立 source identity，但与用户 start 共用同一 native Thread 准备、绑定与 Turn 启动入口。
- **ARL-03 — 产品 View 独立持久。** 所有对话与交互事实由 projector 写入数据库；刷新不读 Runtime
  本地格式。一个 Turn 在每次已接受 steer 处冻结当前 assistant segment，后续输出进入递增 segment，
  因此顺序始终是"已发生内容 → 用户追加 → 后续内容"。原生 Plan 是产生它的 Turn 投影，只能写入
  匹配的 Turn 并在该 Turn 活跃时进入当前 View；不得提升为 Thread 当前状态或跨 Turn 继承。
- **ARL-04 — 原生请求原生响应。** server request 以 `(turnId, runtimeRequestId)` 唯一；审批卡与
  选择卡只响应该 request。创建、决定、取消与回写共享 Project/Thread/Turn 锁。重复响应幂等；
  clear/cancel 后晚到的响应不得重新产生 waiting 状态或文件副作用。普通业务选择只有 Wao MCP
  decision tool 一个入口，并经 app-server 的 MCP elicitation 请求承载；原生 request-user-input 不得
  成为第二条产品 Choice 协议。
- **ARL-05 — 破坏性确认独立于 Runtime 权限。** shell/patch/sandbox 权限响应 Runtime request；
  破坏性操作响应 Wao 的认证浏览器决定。UI 可统一展示，但不能互相授权。两层 timeout 都必须显式
  覆盖有界用户决策窗口，不能让任一默认值与确认竞争。
- **ARL-06 — Runtime 终态不是 Task 终态。** Turn 可以在媒体 Task 仍运行时结束；Task 继续完成，
  按持久批次 identity 至多一次注入新 Turn。
- **ARL-06A — FollowUp 是当前运行投影，不是第二份 Task 历史。** 当前 Task 只由 Resource 的
  `taskId` 关联裁决；重试后旧成员保留在审计与聊天中，但不再进入当前运行投影、focus 或失败汇总。
  只有被同一 Resource 的新 Task 明确替代的成员才可移除，缺失目标不能静默隐藏。
- **ARL-07 — 崩溃可恢复且终态 writer 唯一。** 有 live projector 的退出只由 projector 等待全部
  消息快照后结算；Manager 只停止 placement，不抢写第二终态。释放 ownership 或创建下一 writer 前
  必须先观察终态已提交；结算失败保持失败并阻断 placement，不能被 catch 后当成功。Product Thread
  在首个 native Turn 前绑定 Codex Thread；普通停止、失败、崩溃与重新 placement 都从同一持久 home
  resume，禁止从产品 View 回灌历史或创建恢复分支。
- **ARL-11 — 刷新可续接中途增量。** 每个可见 chunk 取得单调 seq；持久快照同时保存完整前缀与该
  watermark。SSE bootstrap 必须缓冲订阅建立后的事件，客户端跳过已含 seq、只接受严格下一个 seq。
  无 watermark 的猜测、丢弃 bootstrap 事件或遇缺口后展示截断尾段都禁止。
- **ARL-12 — 主动停止也有 projector 终态。** 预期内的进程退出只表示 Manager 主动停止，不表示
  Turn 已完成；仍活跃的 projector 必须等待其持久队列、结算 interrupted 并释放订阅。
- **ARL-13 — cancel 是持久副作用 fence。** queued Turn 可在绑定前原子取消，后续绑定必须拒绝；
  running/waiting 的取消与所有 pending 交互在同一 Project 锁下关闭。晚到审批、Grant、Task、
  同步写或模型晚到输出不能越过取消标记开始新副作用。
- **ARL-14 — clear 先 claim 再停 placement。** clear 标记是清空进行中的唯一 fence；claim 后新
  准入、原生 Thread binding、MCP binding、审批证明与所有 effect 事务立即失败关闭。已归档请求的重放直接返回，
  绝不停止后来创建的新 Thread/Turn。首次 clear 必须在独占 scope ownership 下停稳 placement，销毁 Wao 的临时 workspace
  后再完成产品归档；当前用户的标准 Codex Home 不属于 Wao clear 的写入范围。
- **ARL-15 — secret input fail closed。** 当前没有独立 secret authority；标记为 secret 的原生输入
  请求在写普通消息前拒绝。
- **ARL-16 — 重连替换旧连接而不扩容。** 每个标签页对每个 Project 持有稳定的 session identity；
  服务端另发本次连接的 owner token。相同 identity 重连原子接管现有租约，不增加 cardinality；
  旧 owner 之后不能续租或释放新连接。恢复不得依赖等待 TTL。
- **ARL-17 — 错误与继续动作都由持久事实裁决。** projector 只按钉死协议读取错误事件，将最终失败
  一次性写为稳定 code；UI 不解析流内容、日志或 Provider 文案猜原因。仍可重试的 attempt 不是产品
  Turn 终态。Provider adapter 与原生 Runtime 必须保留一手 FailureRecord，最终 projector 只消费
  与 Turn 终态对应的失败事实，不得从包装文案反造原因。已进入 Runtime 且非用户
  取消的失败只能以新 source identity 创建新 Turn；只有从未进入 Runtime 的消息才允许忠实重发。
- **ARL-18 — 工具输出与长期 Task 展示分权。** projector 只把结构化结果作为业务输出；transport
  外壳与工具完成不能把异步提交解释成媒体成功。聊天保留本 Turn 的调用与错误，但不永久渲染项目
  Task 批次状态；资源与 Task 状态只由正式 View 展示。已删除的中间提交工具即使仍存在于历史消息，
  也不得继续渲染其局部成功/失败计数来冒充当前媒体结果。
- **ARL-19 — 聊天附件只物化一次，不旁路专业生产。** 注册后唯一变成 ready Resource。主 Agent
  把 canonical id/version 与用途写进匹配 Wao Skill 的唯一 generation result，再把同一 items 交给
  对应媒体 Operation；不能按消息内容、路径或最近附件猜输入，也不能另写第二版 Prompt。

## 权威入口

- 产品 Turn/View/projector：`src/lib/assistant-runtime/**`
- placement / ownership / 恢复：`src/lib/codex-runtime/runtime-session-manager.ts`
- Task 接力：`src/lib/agent-turn/**`
- 准入与命令：`/api/projects/[projectId]/assistant/**`

## 踩过的坑

- 浏览器命令回执首版直接依赖 Secure Context 的 UUID 与摘要 API；局域网 HTTP 首次修复只替换 UUID，
  同一发送链路的摘要仍在 POST 前失败 → 没有枚举 identity 构造依赖的全部运行能力 → 随机身份与
  确定性摘要分别复用统一浏览器兼容入口，安全上下文原生路径与 HTTP 路径必须产生相同 wire identity。
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
  Task 或目录写入 → fence 覆盖面不完整 → clear 覆盖全部能力边界并按同一锁序检查（ARL-14）。
- 工具 `item/started` 曾只存在于易失 SSE，只有完成才进入产品 View；进程退出或用户停止发生在工具
  执行中时，该工具刷新后完全消失 → 未完成事实没有持久表示 → started 立即持久化，非正常终止时
  一次性结算为 output-error，并区分"已停止"与"执行失败"。
- 刷新续流首版只补缺失的 text-start 而没有持久 watermark，bootstrap 还主动丢弃订阅期间的增量，
  刷新可长期显示截断尾段 → 用重建猜测代替持久前缀 → durable prefix 与 seq 同存，严格续号
  （ARL-11）。
- durable prefix 首版又把每个模型增量都排成一次完整消息历史事务；长对话中旧前缀排队耗尽易失流
  缓冲并阻塞 Turn 终态，刷新后长期显示输出中 → 已持久前缀与最新未发布前缀没有区分 → 同一消息只
  保留最新未落库快照，并合并尚未被快照封口的相邻文字增量；分段边界仍按队列顺序持久化，终态只
  等待当前写入和最终快照（ARL-07/11）。
- 旧链路已建立稳定错误码与本地化边界，但 Runtime 切换后的终态持久化又固定写一个通用失败码并丢弃
  详情；第一次补救只枚举 Codex error enum，没有用真实 Provider 402 验证协议边界，`UnexpectedStatus`
  仍被官方 Runtime 降成 `other` → 同一可见性不变量换 writer 后又漏掉真实入口 → 模型网关把 Provider
  非成功响应投影到官方 Codex 已支持的结构化错误类别，projector 再作为终态错误的唯一解释者映射到共享
  error registry，禁止维护 Runtime fork 或从错误文案反推状态。
- 网关错误投影随后仍只用自造的嵌套 `error.type/code` 信封验收；OpenRouter Responses 把稳定原因放在
  顶层 `error_type`，导致真实 400 再次丢失原生诊断并被兜底伪装成 `slow_down` → 协议 smoke 没覆盖实际
  Provider skin，且兜底改变了错误语义 → 网关必须读取各受支持 skin 的稳定 typed 字段、携带有界脱敏
  原生 message，并把未知请求拒绝投影为非可用性错误。该修复仍只覆盖投影，Gateway transport/stream
  的一手失败没有 attempt owner，projector 只能从二手 Runtime 错误重造原因 → 每次请求先 claim
  一手 FailureRecord，终态沿同一事实交给 Runtime（ARL-17/FG-01/04）。
- Runtime 中断可留下只有摘要、没有加密载荷的 reasoning item；首版网关把所有历史 item 原样重放，
  下一个完整 reasoning 的加密载荷因此被 Provider 判定为绑定了错误 identity，旧诊断防线又只看到网关
  的泛化外层错误 → Provider 请求边界只重放具有可验证加密载荷的 reasoning，并从有界原生错误信封读取
  上游诊断；产品消息和持久 Rollout 均不另建修复 writer（ARL-07/ARL-17）。
- Runtime 恢复曾把数据库消息重新注入新 Thread；失败 Turn 的最新用户消息尚未投影时，恢复上下文会
  回到更早约束 → 产品 View 被误作模型 history writer → Product Thread 在首个 Turn 前绑定，后续只
  resume 持久 Codex Thread，View 永不参与模型历史恢复（ARL-07）。
- 原生交互首版先持久化用户决定再写 Runtime 管道，却没有在原生 request 随超时、重启或部署消失时
  关闭持久交互；第一次修复只在提交请求内验证 live request，进程恰好在持久化与交付间退出后没有
  入口再次触发该裁决 → 持久 response 保持唯一事实并允许幂等重投；request 已消失时仍由既有恢复
  writer 终结 Turn 与交互，不重做用户决定（ARL-04/07）。
- Codex 切换曾把 `turn/plan/updated` 写回旧版 Thread 级计划本，停止后的 Plan 因而残留并可能被下一
  Turn 误认；旧实现只替换了事件来源，没有重新核对事实 scope → Plan 改由精确 Turn identity 写入，
  终态不再进入当前 View（ARL-03）。
