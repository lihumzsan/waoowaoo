<!-- architecture-module: provider-gateway -->

# Provider Gateway

## 设计理念

Provider 差异只能停留在 `ai-providers` 的 provider 实现、`ai-exec` 的统一执行/轮询边界和 `ai-registry` 的服务端选择边界。业务 route、worker、operation 与 Agent 只声明产品需求，不能猜测或指定 provider/model、切换 provider、重建另一条调用链或在失败时静默降级。少数被 registry 明确声明为等价能力与等价价格的内部 route set，由 Gateway 在严格的 pre-accept 边界内裁决，不构成业务 fallback。

外部异步任务的创建、external id、轮询、终态、错误分类和重试必须是完整协议。Provider 返回失败、未知状态或不支持的能力时必须如实 surface，不能伪造完成、跳过或换模型继续执行。

## 不变量

- **PG-01 — 服务端显式选择。** provider 与 model 必须由统一 registry/selection 或 registry 声明的等价 route set 解析；Agent-facing 媒体工具不得接收 provider/model。禁止按模型名、媒体类型、错误文本或临时可用性猜测 provider。
- **PG-01A — 公共生成参数服从所选模型能力。** Agent/业务 Operation 只接收稳定产品字段和精确 `provider::modelId`；允许字段、枚举、范围与默认值只从该模型的生产 capability registry 解析。动态默认/覆盖通过显式 `modelKey + field + value` command 进入同一 validator。`durationSeconds` 等公共字段到 provider `duration`/wire option 的转换只发生在统一内部 mapper/adapter，报价、Task payload 与 provenance 冻结映射后的执行快照；不得把 provider 原始 object 暴露给模型、猜 provider、静默丢字段或用另一模型的允许值通过校验。
- **PG-02 — 单一网关。** route、worker 和业务 operation 不得直连 provider SDK、旧入口或 generator factory；调用必须经由 `ai-exec` 与 provider adapter。
- **PG-03 — Provider 隔离。** provider 专属模型常量、option 和条件分支只能留在自身 `ai-providers/<provider>/` 实现内；跨 provider 分支属于 registry/engine 的职责。
- **PG-04 — 异步协议完整。** external id、轮询状态、成功结果、失败原因和 `retryable | permanent` 终态分类必须由共享 discriminated union 与唯一 normalizer 明确归一化；`failed` 缺少 disposition、非失败状态携带 disposition、未知 provider 状态或失败状态被映射为完成都必须原地失败。网络/查询异常直接抛出并恢复同一 external id，不得伪装成 provider 终态。
- **PG-05 — 零未声明降级。** 不支持的模型、能力、输出或 provider 故障必须显式失败。唯一允许的跨 provider 路由切换必须来自生产 registry 的穷尽等价 route set，并同时满足：同一产品能力、同一 canonical options、同一冻结报价、同一 Task/Resource/logical invocation，上一条路由返回 typed pre-accept rejection，且没有 external id、媒体结果或受理不确定性。accepted、`outcome_unknown`、超时/断连、异步 external id、poll/result 失败、permanent 内容拒绝和普通 retryable 失败均不得前进路由。业务层、Agent、provider adapter 不得自行 fallback。
- **PG-05A — 路由进度是 durable invocation 事实。** route set identity、当前 route index、每次 typed rejection 与最终实际 modelKey 必须写入同一 provider invocation checkpoint；Task retry/replay 从该 checkpoint 恢复，不能重新从第一路由开始。成功 Revision 只从 checkpoint 读取实际 modelKey。route set 不创建第二 Task、第二报价、第二 Resource 或第二 invocation，且 route 成员价格不等价时 registry 必须拒绝声明。
- **PG-06 — 提交与查询重试分离。** 媒体、LLM 与 vision POST 每个逻辑 invocation 在同一 DB Task attempt 只能发送一次，调用必须先经过 durable provider fence。明确未受理、结构化结果不可用或 external job 明确终态失败时，fence 才允许更高 attempt 原子重取该 invocation 的一次新提交权；成功的兄弟 invocation 继续重放。断连、超时、无类型 `success:false` 或无法证明是否受理的响应必须进入 `outcome_unknown`，禁止自动重提。获得 external id 后的 poll、结果下载和存储读取可以按各自策略重试，但 pending job 只能恢复；只有明确终态失败才能重建 provider job。本地持久化失败重放 provider 结果与稳定 artifact key，不重新生成。
- **PG-07 — LLM stream 与最终结果同源。** 唯一 AI SDK runner 必须把同一次 `streamText` 的 delta 与 SDK final promise 归一为同一个项目结果。若 final text/reasoning 是已发内容的严格前缀扩展，runner 必须在 `onComplete` 前补发确定 suffix；若此前没有对应 delta，则补发完整 final 内容。final 与已发内容分叉时必须原地失败，禁止拼接、猜测、重发整份内容、改走 `generateText`、跨 provider fallback 或发起第二次模型调用。
- **PG-08 — LLM 推理强度精确归一。** 推理强度 identity 由 `ai-registry/reasoning-effort.ts` 唯一定义，具体模型支持集合由生产 capability registry 穷尽声明，运行时只经 `ai-exec/reasoning-effort.ts` 合并显式调用参数、用户/项目 capability 配置或平台角色环境变量。Primary Agent 使用 `assistant` 角色，Creative Worker 与其他后台专业文本 Task 使用 `analysis` 角色；调用方必须显式传递角色，禁止从模型名、Task 名或默认值猜测。最终值必须在持久化 invocation 前冻结，并由 provider adapter 原样写入外部请求；未知值、不受模型支持的值或 SDK 无法精确表达的值必须原地失败，禁止就近映射、静默默认或由不同调用链自行解释。
- **PG-09 — 结构化输出只有一个严格解释器。** 所有声明 JSON object/array 的 LLM 与 vision 结果必须经 `ai-exec/structured-json.ts` 解析，再进入 schema 与业务校验。解释器只可去除包裹整份响应的一个完整、匹配、无额外正文的 Markdown `json` 或无标签 fence；不得截取正文中的 JSON、修复内容、接受未知 fence 标签或从说明文字中猜测结果。外层包装以外的任何协议偏差必须显式失败。
- **PG-10 — 音乐时长能力由 registry 唯一声明。** FAL Lyria 只声明连续 `120–180` 秒能力；业务调用方必须从生产 registry 解析 provider 请求时长，不得维护固定时长枚举或复制范围。目标短于 120 秒时生成 120 秒后在本地精确贴合，目标位于范围内时按目标生成，超过 180 秒必须原地失败；`negative_prompt` 必须经 provider adapter 原样进入外部协议。
- **PG-11 — Provider 密钥只写不读。** 用户配置 View 只能返回 `hasApiKey`，不得解密或回传已有密钥；编辑界面以空 secret 字段表达“保持不变”，连接诊断缺省 key 时只在服务端按 provider owner 解密并立即交给 adapter。浏览器状态、日志和 API 错误不得保存或显示明文 key。
- **PG-12 — Provider 连接所有权服从部署模式。** `platform-key` 下 Provider identity、base URL 与密钥只由服务器环境配置拥有；用户 API 配置的读取、写入和连接诊断必须在任何数据库或外部请求前拒绝，相关 Operation 只允许 API channel，不能进入主 Agent 工具集。`user-key` 下个人设置继续是自定义 Provider 的唯一 writer。Provider transport 只负责按已选配置发请求与可选代理转发，不得再按 DNS 结果、私网/保留 IP、metadata、HTTPS、重定向或本地 allowlist 建立第二套可用性裁决；本地部署者对自定义网络目标负责。图片、音频、视频、multipart 与 base64 仍必须经共享字节上限读取，禁止无界 `arrayBuffer/formData/Buffer.from(base64)`。
- **PG-13 — 普通 LLM/Vision 只有一套 SDK 执行与结果协议。** 每个 LLM 模型必须在生产 capability registry 穷尽声明 `openai-responses | openai-compatible-chat | openrouter-chat | google-generative-ai` 传输协议；`ai-exec` 只通过一个 AI SDK `LanguageModel` runner 执行 `generateText/streamText`，并只通过一个 versioned、可序列化的项目 result projector 生成 durable result。Provider adapter 只拥有模型 factory、消息准备、专属 option/header、proxy、metadata/error 校验，禁止返回私有 completion shape、直用原生 Chat Completions、手写 Responses HTTP/SSE parser 或另建 LLM/Vision 执行链。Video 的 submit/status/result durable lifecycle 不属于该同步结果协议；会在进程内自动 poll/download 的高层 Video SDK 不得替换现有 durable handoff。
- **PG-14 — Provider 先按生命周期分类，再选择传输实现。** Runtime 只有 `sync final result` 与 `async durable job` 两种执行语义，图片、视频或 provider 名称不得代替该分类。同步接口优先由能保留参数 policy、proxy、安全上限、错误语义且可关闭提交重试的高层 SDK 执行；异步接口必须让项目分别调用 `submit/status/result`、在 submit 后立即持久化 canonical external id，并由 worker/reconciler 拥有恢复和终态。任何 SDK 若隐藏进程内 polling/download、自动 fallback，或无法关闭不确定 POST 的重试，均不得接管该边界；保留项目低层 transport 不构成第二生命周期。OpenRouter Image 使用 AI SDK `generateImage`；OpenRouter Video 使用官方低层 SDK 的独立 `generate/getGeneration`；FAL Queue 因官方客户端当前固定重试 submit，继续使用零自动重提的项目 transport。
- **PG-15 — 模型 option 只规范化一次。** `AiOptionSchema` 同时拥有允许字段、必填/冲突、值域和 canonical normalize；`ai-exec` 必须把其结果交给 provider adapter。adapter 只能把 canonical option 映射为 provider SDK/wire 字段，不得再次维护同义 allowed-key、枚举、默认值或跨字段裁决。跨 provider 的同模型族规则必须由共享 policy builder 生成，各 provider 只声明自身 capability/policy 差异；把重复解释移动到 shared wrapper 但保留第二裁判不算收敛。

## 权威入口

- Provider adapter、媒体/LLM 实现与异步注册：`src/lib/ai-providers/`。
- 同步 OpenRouter Image 的唯一外部协议入口：`src/lib/ai-providers/openrouter/image.ts` 的 AI SDK `generateImage`；OpenRouter Video 的唯一 submit/status 入口：`src/lib/ai-providers/openrouter/video.ts` 的官方低层 SDK。两者继续由同一 OpenRouter adapter 暴露，不允许业务调用方直连 SDK。
- 执行引擎、结果归一化与异步轮询：`src/lib/ai-exec/engine.ts`、`src/lib/ai-exec/async-poll.ts`、`src/lib/ai-exec/async-wait.ts`；FAL image/video/music 共用标准 external id 与这一等待入口，provider adapter 不在提交函数内隐藏第二套轮询循环。
- 普通 LLM/Vision 的唯一外部执行与结果投影：`src/lib/ai-exec/llm/sdk-runner.ts`、`src/lib/ai-exec/llm/result-projector.ts`；模型传输协议的唯一声明与解析：各 provider `models.ts` 的 capability catalog、`src/lib/ai-registry/llm-protocol.ts`。
- Task 媒体/LLM/vision 提交围栏与结果重放：`src/lib/task/provider-invocation.ts`；稳定产物身份：`src/lib/task/artifact-storage.ts`。
- 模型目录、价格、能力和运行时选择：`src/lib/ai-registry/`。
- 等价 Provider route set 的唯一声明与解析：`src/lib/ai-registry/provider-route-set.ts`；路由推进只由 `src/lib/ai-exec/engine.ts` 调用 `src/lib/task/provider-invocation.ts` 的 durable fence 完成。
- 模型 option 的唯一校验与 canonical normalize：各 adapter descriptor 暴露的生产 `AiOptionSchema`、`src/lib/ai-exec/normalize.ts`；GPT Image 2 跨 provider 的共享 schema/pixel policy 为 `src/lib/ai-providers/shared/gpt-image-2.ts`。
- LLM 推理强度的唯一运行时解析：`src/lib/ai-exec/reasoning-effort.ts`；平台 assistant/analysis 模型 identity 与角色环境配置入口：`src/lib/platform-models/` 和 `.env*.example`。
- 结构化 LLM/vision 输出的唯一 envelope 解析、shape 校验与 schema 执行入口：`src/lib/ai-exec/structured-json.ts`、`src/lib/ai-exec/structured-step.ts`。
- 用户 provider 配置的严格解析与写入：`src/lib/user-api/**`；运行时选择入口为 `src/lib/user-api/runtime-config.ts`。
- Provider 可选出站代理：`src/lib/http/outbound-proxy.ts`；请求/响应体积入口：`src/lib/http/body-limits.ts`。部署模式与用户 Provider 配置可用性的唯一裁决分别是 `src/lib/deployment/config.ts` 与 `src/lib/user-api/availability.ts`。
- `standards/capabilities/**` 与 `standards/pricing/**` 当前分别由 catalog 检查脚本读取，不是生产 runtime registry 的 writer；运行时仍从 `src/lib/ai-providers/*/models.ts` 经 builtin catalog 注册。修改 standards 必须审计相应 runtime catalog，不能把校验通过解释为生产能力或价格已切换。

## 验证

- `tests/integration/provider/fal-*.contract.test.ts` 使用本地协议服务器验证真实 FAL adapter 的提交、轮询、FAILED/unknown/malformed/无媒体结果、422/500 和零隐式 retry。
- `tests/integration/provider/openrouter-{image,video}.contract.test.ts` 观察真实 SDK wire contract，并反证同步图片和异步视频提交在 5xx/不确定结果下自动重发 POST；`tests/golden-journey/self-tests/media-provider.test.ts` 通过生产 OpenRouter Video adapter 验证 submit 与 status 仍为两个独立调用。
- `tests/integration/provider/openrouter-image.contract.test.ts` 还从生产 schema 取得 canonical GPT Image 2 option，反证默认值、alias conflict、压缩格式和禁用字段重新落入 adapter 私有解释；`tests/integration/provider/provider-gateway-capabilities.contract.test.ts` 验证 FAL 与 OpenRouter 共享模型族 normalizer、但继续遵守各自 capability。
- 上述两组 contract 还从生产 route registry 验证 OpenRouter/FAL GPT Image 2 的等价 route set；`tests/integration/task/provider-invocation-at-most-once.integration.test.ts` 使用真实 DB 反证 pre-accept 之外的跨路由重提、并发 route advance、重放回到首路由和实际 provenance 丢失。数据库不可用时该项只能报告未验证。
- `tests/integration/provider/fal-music-capability.contract.test.ts` 从生产 registry 验证 Lyria 连续 `120–180` 秒能力、范围外请求在 HTTP 前失败，以及 `duration_seconds` 与 `negative_prompt` 的真实 FAL wire contract。
- `tests/integration/provider/provider-gateway-{capabilities,connections}.contract.test.ts` 与 `message-content.contract.test.ts` 验证生产 registry capability、connection 和消息协议。
- `tests/integration/provider/source-script-scene-stream.contract.test.ts` 验证 scene-level streaming 协议；`tests/integration/task/provider-invocation-at-most-once.integration.test.ts` 使用真实 MySQL 验证并发首次提交唯一、成功兄弟重放、失败 invocation/external job 仅由更高 attempt 重取，以及 `outcome_unknown` 与永久拒绝零重提。
- `tests/unit/task/async-poll-external-id.test.ts` 只验证纯 external identity 解析。
- `tests/unit/ai-exec/structured-json.test.ts` 验证结构化输出只接受纯 JSON 或单一完整外层 fence，并拒绝说明文字、未知/不完整/多重 fence 与 JSON 内容修复。
- `tests/unit/ai-exec/llm-result-projector.test.ts` 验证 AI SDK usage/cache/cost/reasoning/safety 到 versioned 项目结果的唯一投影及旧 ChatCompletion shape 拒绝；`tests/unit/provider/llm-stream-finalization.test.ts` 反证 delta/final 分叉、漏发 suffix 与二次 completion 猜测。
- `tests/integration/provider/provider-gateway-{capabilities,connections}.contract.test.ts` 穷尽验证 runtime LLM protocol，并观察 Ark Responses thinking/SSE、Ark/Google Vision 图片编码、OpenRouter reasoning/cache/session/cost 与 provider 连接请求的真实 wire contract。
- provider guards 只阻止 API/媒体绕过、跨 provider 猜测和 fallback 等结构旁路，不替代协议或用户旅程证据。
- `npm run check:capability-catalog` 与 `npm run check:pricing-catalog` 验证 standards 文件自身及 tier/capability 字段关系；它们不证明 standards 与运行时代码 catalog 值一致。
- `tests/contracts/project-agent-toolset-conformance.test.ts` 反证用户 API 配置重新进入主 Agent；`tests/unit/deployment/config.test.ts` 验证 `platform-key/user-key` 的唯一部署能力投影；`tests/unit/http/body-limits.test.ts` 继续反证超限 chunk 与 base64。
## 历史回归

- `ccdd10be6` 修复 FAL 异步失败未被 surface 的问题：provider 的失败终态必须进入统一任务失败边界，不能留在 polling 中静默消失。
- `9207d119` 修复视频生成的项目模型 fallback：模型不可用应显式失败，不得改用另一个模型或 provider。
- `95254ae71` 收敛 AI 与 Task 重试，说明 provider 的错误分类不能由多个调用层各自猜测。
- 真实 worker retry Journey 曾发现所有 `FetchStatusError` 被 durable fence 统一解释为永久拒绝，导致 Task retry 形同虚设；提交结果分类必须由 fence 一次性写入，BullMQ 只调度其允许的下一 attempt。
- 结构化 LLM 输出校验曾发生在 provider checkpoint 已写 `submitted` 之后；队列虽进入更高 attempt，网关仍永久重放旧结果。逻辑 invocation 必须由结果消费者显式写回“该结果不可用”，但重新提交资格仍只由 provider fence 的 attempt CAS 裁决，不能由业务调用方另开请求入口。
- `95254ae71` 曾把 fence 剥离与 JSON 内容修复、正文截取放在同一 `safeParseJson`；`d8a1685dc` 为恢复严格输出契约删除整条 repair 路径时，也一并删除了安全的外层 envelope 规范化。真实 `edit_style_preview_options_generate` 随后因完整合法 JSON 被 ` ```json ` 包裹而连续三次进入 `PARSE_ERROR`。当前只在唯一结构化解释器中剥离完整匹配的最外层 fence，继续拒绝所有内容修补与正文猜测。
- OpenRouter SDK 可在 stream final promise 才暴露此前 delta 未完整携带的正文；旧 adapter 用该正文完成正式持久化，却没有补给同一次 stream callback，造成 Task 成功而 Canvas 没有 structured preview。现由共享 runner 同时归一 text/reasoning：只补发 final 相对已发内容的确定 suffix，分叉内容直接失败，也不发起第二次调用。
- 普通 LLM/Vision 曾同时存在 AI SDK 结果、原生 OpenAI `ChatCompletion` 和 Google SDK 私有结果，Ark 还维护手写 Responses HTTP/SSE parser；各 provider 的局部 adapter/test 只证明自身 shape，未能反证跨 provider 的第二结果协议、重复 usage/finish 解释和 durable result 伪装成 ChatCompletion。现在所有 runtime LLM capability 显式声明传输协议，Ark 使用 `@ai-sdk/openai` Responses、兼容 Chat 使用 `@ai-sdk/openai-compatible`、OpenRouter 使用其 AI SDK provider、Google 使用 `@ai-sdk/google`，并统一进入一个 runner/projector；Ark thinking、OpenRouter cache/session/cost、Google cached tokens 仍由 provider 边界精确保留。部署此不兼容切换前必须排空旧版本进行中的 LLM/Vision invocation；`schemaVersion: 1` 结果解析器明确拒绝旧 ChatCompletion 持久结果，不保留双读兼容层。Video 因高层 SDK 会隐藏 submit→poll→download，继续使用现有 durable submit/status/result，不以进程内轮询换取代码缩短。
- OpenRouter GPT Image 2 新实例最初继续手写 `/images` DTO、Authorization、JSON 与 base64 response parser，虽然没有产生第二业务入口，却绕过了已安装 AI SDK 的同步图片协议；当前 adapter 保留 option policy、引用图规范化、proxy、字节上限与 `maxRetries: 0`，其余 wire protocol 统一交给 `imageModel + generateImage`。OpenRouter Video 不复用会自动 poll/download 的 AI SDK `videoModel`，而由 `@openrouter/sdk` 的独立 `generate/getGeneration` 保持 durable external id。评估 FAL 官方客户端时发现 `queue.submit()` 固定最多重试三次且调用方不能关闭；在超时但 provider 已受理时会产生不可恢复的兄弟 job，因此该迁移被拒绝，现有 FAL transport 继续作为唯一安全入口，待 SDK 能显式关闭 submit retry 后才能重审。
- OpenRouter Video 曾在 `202` 通道返回结构化 `error` 对象，而 SDK 只接受字符串 `error` 或完整 `id/polling_url/status`，四个并行视频因此全部退化为无信息的 `Response validation failed`；旧防线只识别 HTTP `status/statusCode`，既丢失 Provider 原因，也会把任何 `202` schema 漂移误当作明确未受理。当前唯一 Video adapter 从 SDK `ResponseValidationError.rawValue` 只提取有界的 `code/message/error_type`：存在 canonical `id` 时继续持久化该 external identity，无 id 的显式 error 才进入 typed rejection，既无 id 也无 error 的畸形响应进入 `outcome_unknown`，禁止重提。真实 Provider 的下一次具体拒绝原因仍需新的收费提交才能验证；contract 仅以本地协议服务器反证三种边界与 POST 至多一次。
- 官方 OpenAI Image provider 在 `e12f7ecdc` 删除 legacy provider surface 时已失去全部执行入口，但共享的 348 行 SDK transport 因 FAL 继续引用两个枚举而残留，根依赖也未移除；之后 FAL 与 OpenRouter GPT Image 2 又分别在 adapter 复制 registry 已声明的尺寸、质量与格式规则。旧防线只证明各自请求可工作，无法反证死 transport 或两套 option 裁判。现在中立格式常量与 GPT Image 2 schema/pixel policy 合并为一个共享 builder，`AiOptionSchema.normalize` 是唯一 canonical 解释，adapter 只做 provider 映射；死 transport 和根 `openai` 直接依赖已删除。Agents SDK 自身的传递 `openai` 依赖不属于 Provider Gateway 执行入口。
- 音乐模型能力曾以少数固定秒数枚举表达，业务层因此无法为任意时间线声明明确请求。现在 FAL Lyria 在生产 registry 唯一声明连续 `120–180` 秒；短时间线统一请求 120 秒并由本地确定性 conform，范围内精确请求，超长请求拒绝。provider contract 直接观察真实 HTTP payload，防止调用方重新写死枚举、丢失负向提示词或绕过范围校验。
- 用户 Provider 配置 GET 曾直接解密并把 API key 回传浏览器，连接测试也依赖客户端重新提交明文；设置页鉴权只能防跨用户，不能防浏览器扩展、XSS、前端日志或缓存泄露。当前 View 永远只返回 `hasApiKey`，保存成功后立即清空客户端 secret，诊断按 providerId 在服务端解析既有 key。浏览器端明文回归由响应契约与真实 Profile Journey 复验，恶意浏览器扩展不在应用可控制边界内。
- `98e1c725e` 为用户可配置 Provider 增加统一 SSRF/DNS 防线，却把平台环境变量、Self-hosted 配置和 Provider 动态地址都解释成同一种不可信 URL；Cloud 同时只隐藏 API 配置页面，仍把配置 Operation 暴露给主 Agent并保留连接诊断 API。Clash Fake-IP 将合法 `openrouter.ai` 解析到 `198.18.0.0/15` 后，真实 Assistant 模型请求在交给显式代理前被误拒绝，既有安全测试因为依赖测试 allowlist 而没有覆盖该组合。当前以部署模式重新划定所有权：Cloud 用户配置和诊断在统一 availability 入口原地拒绝，配置 Operation 改为 API-only；Self-hosted 部署者继续拥有自定义连接。旧 URL policy、DNS/IP/metadata/redirect 裁决、私网 allowlist 和对应测试环境分支整体删除，代理只负责路由。Self-hosted 多个互不信任用户共享同一网络时的出站风险由部署者承担，不再由运行时阻断。
- OpenRouter GPT Image 2 在真实调用中返回账户 billing hard limit；这不是平台 credits 不足，也不能由 Agent 看错误文案后重建一次 FAL 调用。旧 PG-05 绝对禁止跨 provider，因此系统即使拥有同 capability 的 FAL provider 也只能终止。当前把例外收窄为 registry 声明的等价 route set：OpenRouter adapter 将“请求明确未被受理且无外部身份”的响应规范化为 typed pre-accept rejection，Gateway 在同一 durable invocation 内前进到 FAL；任何受理不确定性都保持失败，不以可用性为理由切换。真实外部双 Provider 调用仍未执行，当前证据只覆盖协议与 DB fence（DB 可用时）。
- OpenRouter LLM adapter 曾为每次成功响应克隆并读完整 response body，再把全部 SSE token、推理正文与 usage 写入 INFO 日志；一次普通问候即可产生数 MB 控制台和项目日志，同时让日志成为模型输出的第二份非必要副本。当前 Provider 日志只记录 URL、HTTP 状态、已脱敏响应头、session identity 与收到响应头的耗时；正文只由唯一 AI SDK runner 消费和投影，日志层不再读取、保存或输出 stream body。
- 外部异步任务受理后，共享 poll 入口曾在每次查询都写一条 Provider 解析 INFO；Worker 又对同一次 pending 写进度 INFO，四个并行视频因而每数秒产生交错日志。这些日志不是提交、计费或终态事实。当前 poll 仍由 durable external id 唯一恢复，但例行 pending 查询不再输出 INFO；受理、完成、明确失败、查询异常与终态仍保留可观测性。

## 修改检查表

1. provider/model 是否来自统一服务端 selection 或声明式等价 route set，而非 Agent、名称、类型或错误文案推断？
2. 调用是否经过 ai-exec 与 provider adapter，而非 route/worker 直连？
3. 新 provider 专属代码是否只放在自己的 provider 目录？
4. 异步任务的 external id、poll、成功、失败与 retryable 错误是否完整覆盖？
5. 非 typed pre-accept rejection 是否明确报错；合法 route advance 是否保持同一 Task、报价、Resource、invocation 与 durable checkpoint？
