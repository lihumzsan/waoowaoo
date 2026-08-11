<!-- architecture-module: provider-gateway -->

# Provider Gateway

## 为什么是这样

Provider 差异只停留在 `ai-providers` 的实现、`ai-exec` 的统一执行边界和 `ai-registry` 的服务端
选择边界。业务 route、Task Activity、Operation 与 Agent 只声明产品需求，不猜测 provider/model、
不切换 provider、不重建第二条调用链、失败时不静默降级。

不做自动降级是产品决策，不只是工程洁癖：用户选定的模型就是实际扣费和实际出图的模型。历史上
一次账户额度耗尽触发的自动换路，会让 Provider 成为失败时的隐藏状态解释者。

外部异步任务的创建、external id、轮询、终态、错误分类和重试必须是完整协议；Provider 返回失败、
未知状态或不支持的能力时如实 surface，不伪造完成、不跳过、不换模型继续。

桌面 Codex assistant 不属于本 Provider Gateway：文本与原生搜索由当前用户登录的 Codex App Server 负责，
Wao 不为它建立 Responses proxy、OpenRouter provider 或第二套模型重试链。Provider Gateway 继续只拥有产品
媒体与其他显式 provider adapter 的执行边界。

## 不变量

- **PG-01 — 服务端显式选择。** provider 与 model 由统一 registry 解析；Agent-facing 媒体工具
  不接收 provider/model。禁止按模型名、媒体类型、错误文本或临时可用性猜测 provider。内部
  modelKey 与 provider identity 不进入公开 Schema。
- **PG-02 — 单一网关。** route、Task Activity 和业务 Operation 不得直连 provider SDK 或自建
  generator。LLM/Vision 与媒体调用必须经 `ai-exec` 与 provider adapter；SDK 执行完全封装在
  `ai-providers/<provider>/` 内。
- **PG-03 — Provider 隔离。** provider 专属常量、option 和条件分支只留在自身目录内；跨 provider
  分支属于 registry/engine 的职责。
- **PG-04 — 异步协议完整。** external id、轮询状态、成功结果、原生失败原因和明确的副作用终态
  分类必须由共享 discriminated union 与唯一 normalizer 归一。`failed` 缺完整 FailureRecord、未知
  provider 状态、失败被映射成完成，都必须原地失败。网络异常直接抛出并恢复同一 external id，
  不得伪装成 provider 终态。
- **PG-05 — 精确模型、零自动降级。** 不支持的模型、能力、输出、账户额度或 provider 故障必须在
  用户选择的精确模型上原地失败。typed pre-accept rejection 只证明本次未受理，不构成换路授权。
- **PG-06 — 提交与查询重试分离。** 每个逻辑 invocation 在同一 attempt 只能发送一次。不可能触达
  Provider 的本地 preflight 必须在 fence 之外完成；成功后先 claim fence，再执行唯一一次可能发出
  请求的调用。断连、超时、无法证明是否受理的响应进入 `outcome_unknown`，禁止自动重提；纯本地
  校验失败不得伪装成 Provider 拒绝。fence 只消费 adapter 明确声明的 submission disposition，
  禁止从 HTTP 状态、异常 retryable 或 message 猜测“未受理”；typed failure 必须原样穿过 handler。
- **PG-06C — request identity 排除临时传输凭据。** durable request hash 包含媒体对象的
  origin/path、顺序与全部非媒体 canonical option，但必须剥除签名 URL 的 query/hash——签名和过期
  时间只授权本次传输，不是业务输入。wire request 仍使用本次新签发的完整 URL。
- **PG-06A — 排队与生成分开计时。** 排队与生成消耗互不透支的独立预算。排队超预算是"pending 只能
  恢复"的唯一受控例外，且必须按固定顺序：先持久化"旧 external id 作废"，再尽力取消 provider 侧
  任务，最后抛可重试错误由下一 attempt 经 fence 取得新提交权。绝不允许先取消或先重提再作废——
  旧 id 未作废前不存在第二个可提交身份。
- **PG-06B — 用户取消先服从本地终态。** 已有 external id 时，cancel 仍先由 terminal owner 决定
  本地事实；只有本地确认 canceled、终态事务已提交、容量已释放、必需通知已完成后，独立可重试
  Activity 才从 ledger 读真实 external id 调用 cancel。补偿失败只记日志，不复活 Task、不改写
  计费、不阻止本地 cancellation receipt。
- **PG-07 — stream 与最终结果同源。** 同一次调用的 delta 与 final 必须归一为同一个项目结果。
  final 是已发内容的严格前缀扩展时补发确定 suffix；分叉时原地失败，禁止拼接、重发整份内容、
  改走非流式接口或发起第二次模型调用。
- **PG-09 — 结构化输出只有一个严格解释器。** 只可去除包裹整份响应的一个完整、匹配、无额外正文的
  fence；不得截取正文中的 JSON、修复内容、接受未知 fence 标签或从说明文字猜结果。
- **PG-11 — Provider 密钥只写不读。** 配置 View 只返回是否已配置，不解密回传。空 secret 字段表示
  "保持不变"；诊断在服务端按 owner 解密并立即交给 adapter。浏览器状态、日志和 API 错误不得保存
  或显示明文 key。
- **PG-12 — Provider 与模型所有权服从部署模式。** 平台托管模式下 Provider identity、密钥和默认
  模型只由服务器配置与平台 registry 拥有；用户配置的读写和诊断必须在任何数据库或外部请求前拒绝。
  自托管模式下个人设置是唯一 writer。Provider transport 只负责按已选配置发请求，不建立第二套
  可用性裁决。
- **PG-15 — 模型 option 只规范化一次。** 允许字段、必填/冲突、值域和 canonical normalize 由同一
  schema 拥有；adapter 只把 canonical option 映射为 provider wire 字段，不再维护同义 allowed-key、
  枚举、默认值或跨字段裁决。把重复解释移到 shared wrapper 但保留第二裁判不算收敛。
- **PG-17 — 媒体引用只有一条投影链。** 私有图片/音频/视频在进入 Gateway 前必须经 owner-aware
  出站入口，按模态校验后投影为有界时效的绝对 MinIO 签名 URL；Gateway 不再按 HTTP/HTTPS 建立第二
  套媒体引用裁决，但仍拒绝相对路径、Data URL 与内嵌凭据。Base64 不是跨 provider 的媒体协议，
  只允许在明确要求 inline bytes 的 adapter 内部有界转换。
- **PG-18 — 外部下载只有一个 SSRF-safe 出口。** scheme、凭据、私网/保留地址、DNS 全部结果与
  每一次 redirect 都 fail closed，实际 socket lookup 必须再次执行同一 policy（防 DNS rebinding）。
  禁止 hostname-only 内网例外、普通 fetch 旁路或只检查首跳。
- **PG-19 — Provider 边界保留原生失败并追加 typed interpretation。** adapter 在最了解协议的位置
  保存原生响应，再把鉴权、欠费/配额、限流、内容策略、超时与畸形结果映射为统一 registry code；
  code 只用于产品解释，不能授权提交重放。异步失败结果必须携带完整 FailureRecord。优先使用
  结构化字段；仅当某个 Provider 没有独立 code 且 adapter 能严格、有界地识别其稳定文案协议时，
  允许在该 adapter 私有解析，未知文案必须保留原生 identity。禁止共享 message classifier；原始响应
  进入脱敏 FailureRecord 与内部诊断。
- **PG-20 — 同一模态共享一次 preflight。** planner 与执行层调用同一 option normalizer；planner
  还要在 Plan 前验证所选 provider 的凭证与连接配置。已冻结 option 到 adapter 前不得再补默认或
  删除未知字段。敏感内容拒绝是 permanent 业务事实，不能坍缩成内部错误或被跨工具绕过。
- **PG-21 — 视频输入模式必须显式。** 所选模型在 registry 声明可用的文本、首帧、首尾帧与参考素材
  模式；Workspace 输入用 `first_frame`、`last_frame`、`reference_image`、`reference_audio`、
  `reference_video` 明确角色，Planner 在报价和副作用前验证唯一模式与各通道上限。普通参考图无论
  数量都不得被共享层或 adapter 推断成首帧；Provider adapter 只映射已冻结的显式角色。

## 权威入口

- Provider adapter 与媒体/LLM 实现：`src/lib/ai-providers/**`
- 执行引擎、结果归一、异步轮询与等待：`src/lib/ai-exec/**`
- 模型目录、价格、能力与运行时选择：`src/lib/ai-registry/**`、`src/lib/platform-models/**`
- 提交 fence 与结果重放：`src/lib/task/provider-invocation.ts`
- 出站媒体投影与下载：`src/lib/media/outbound-*.ts`

## 踩过的坑

- 账户额度耗尽时用生产 route 自动前进到另一 provider → 自动降级让 Provider 成为隐藏状态解释者，
  且违背"用户选定模型就是实际模型" → 删除全部生产 route 声明，typed 拒绝只结束本次调用。
- 视频 retry 每次重新签发私有媒体 URL，而 request hash 包含完整签名串，"可重试"的任务永远无法
  重新提交 → 把传输凭据当业务输入 → identity projector 剥除 query/hash（PG-06C）。
- 同步图片的 POST 断连已被 fence 判为 `outcome_unknown`，但上层 helper 捕获所有异常统一包装成
  通用错误，Task 因此被调度三次 → typed disposition 没有穿过 handler → 分类原样抛出（PG-06）。
- engine 已把 option normalize 移到 fence 前，Codex adapter 却仍在 `execute` 内下载私有参考图，
  且 catch-all 把本地 SSRF 拒绝改成 `success:false`，再次误记 `outcome_unknown` → 旧防线未覆盖
  adapter 内本地预处理 → adapter 用互斥 `prepare/execute` 契约，owner 校验后经 storage SDK 物化（PG-06/17/18）。
- 结构化输出的 fence 剥离曾与"JSON 内容修复、正文截取"写在一起，删除修复路径时把安全的外层
  envelope 归一也一并删了，完整合法 JSON 被 ``` 包裹后连续解析失败 → 一次删除跨越了两个语义 →
  只剥最外层完整 fence，继续拒绝一切内容修补（PG-09）。
- SSRF 首轮防线只做"DNS 预检 + 普通 fetch"，实际连接会再次解析；Provider 结果下载还完全绕过
  该 policy → 预检与连接之间存在 rebinding 窗口，且防线没有覆盖全部下载入口 → 所有主动下载
  收敛到同一出口，socket lookup 再执行一次同一 policy（PG-18）。
- Provider 错误长期由共享 normalizer 按四十余个中英文 message 子串分类，自部署账户欠费被误判成
  平台余额不足 → 用自然语言猜业务语义 → adapter 在协议边界产出 canonical code（PG-19）。
  该不变量随后换形式复发过一次：adapter 已抛 typed 错误，fence 却在用它判断 disposition 后重新
  包装成通用 code → 现在 typed code 与 disposition 写入同一 checkpoint，replay 重建同一错误。
- Toonflow 视频任务已被 Provider 接受后返回 `failed + failReason`，adapter 却丢弃原因并统一抛成
  `PROVIDER_SUBMISSION_REJECTED`，既谎报发生阶段又遮住版权限制等真实永久失败 → adapter 直接消费
  结构化 `failReason`，映射稳定 typed code；未知的已接受失败保持 `GENERATION_FAILED`，绝不伪装成
  提交拒绝或自动重提（PG-04/06/19）。
- Provider POST 的 5xx/429 曾被 fence 按 HTTP 状态猜成“明确未受理”，但这些状态不能证明供应商
  没创建任务，存在重复生成和扣费风险 → adapter 明确产出 disposition，普通异常一律
  `outcome_unknown`，fence 不再推断（PG-06）。
- Toonflow 真实欠费响应使用通用 `code=400`，欠费事实只在稳定 `message` 中；旧 adapter 不读取，
  Worker 又用默认文案覆盖 → Toonflow adapter 私有严格解析该协议，完整失败事实写穿 checkpoint，
  共享层不按自然语言分类（PG-19）。
- LLM adapter 曾把完整响应体、随后又把完整响应头写进例行 INFO 日志 → 把无界 Provider 元数据
  复制进日志，第一轮修复只覆盖 body → 只记录 URL、状态、session identity 与显式允许的诊断字段。
