<!-- architecture-module: provider-gateway -->

# Provider Gateway

## 设计理念

Provider 差异只能停留在 `ai-providers` 的 provider 实现、`ai-exec` 的统一执行/轮询边界和 `ai-registry` 的服务端选择边界。业务 route、Temporal Task Activity、operation 与 Agent 只声明产品需求，不能猜测或指定 provider/model、切换 provider、重建另一条调用链或在失败时静默降级。少数被 registry 明确声明为等价能力与等价价格的内部 route set，由 Gateway 在严格的 pre-accept 边界内裁决，不构成业务 fallback。

外部异步任务的创建、external id、轮询、终态、错误分类和重试必须是完整协议。Provider 返回失败、未知状态或不支持的能力时必须如实 surface，不能伪造完成、跳过或换模型继续执行。

## 不变量

- **PG-01 — 服务端显式选择。** provider 与 model 必须由统一 registry/selection 或 registry 声明的等价 route set 解析；Agent-facing 媒体工具不得接收 provider/model。禁止按模型名、媒体类型、错误文本或临时可用性猜测 provider。
- **PG-01B — OpenRouter LLM 一次声明。** OpenRouter 普通 LLM 共用同一 adapter 和 `openrouter-chat` 协议，但每个具体 model identity 的名称、价格、公开 reasoning 模式、推理强度集合与平台可见性必须在 provider-owned definition registry 声明一次，再自动派生 capability、pricing、API config 与 platform catalog。未知 model id 必须显式失败；不得把任意字符串直通 provider，也不得为同一 LLM 手工维护四份平行数组。图片、视频等媒体能力继续按具体模型显式声明。
- **PG-01A — 公共生成参数服从所选模型能力。** Agent-facing Operation 只接收稳定产品字段，不接收或显示 `provider::modelId`；它的 canonical Schema 不随项目、模型或 execution segment 改变。服务端 planner 从正式配置 owner 解析内部 modelKey 与项目配置，再以该模型的生产 capability registry 校验枚举、范围、引用上限与默认值；同一次 plan 把 modelKey、配置快照、映射后的 options、报价、Task payload 与 provenance 一并冻结。内部 modelKey 和 provider identity 不得进入公开 Schema 或 gateway envelope，配置变化也不得创建第二份动态 Tool Schema。动态默认/覆盖通过内部显式 `modelKey + field + value` command 进入同一 validator。`durationSeconds` 等公共字段到 provider `duration`/wire option 的转换只发生在统一内部 mapper/adapter；不得把 provider 原始 object 暴露给模型、猜 provider、静默丢字段或用另一模型的允许值通过校验。统一视频生成产品契约不暴露 `fps`，输出帧率由所选 provider/model 决定；能力、配置、Task payload、执行 option 和 adapter 均不得重新声明或透传该字段。
- **PG-02 — 单一网关。** route、Task Activity 和业务 operation 不得直连 provider SDK、旧入口或 generator factory。普通 LLM/Vision 与媒体调用必须经由 `ai-exec` 与 provider adapter；专用托管能力必须由自己的业务 service 作为唯一入口，并把 SDK 执行完全封装在 `ai-providers/<provider>/` adapter 内，不得让调用方创建 provider client 或 tool。
- **PG-02A — Codex Web Search 不属于媒体 Provider Gateway。** Agent 联网搜索由 Codex app-server 原生能力拥有；本模块不注册 hosted-search adapter、搜索 Operation 或研究模型。搜索结果只有显式写入 WorkspaceResource 后才成为项目输入。
- **PG-03 — Provider 隔离。** provider 专属模型常量、option 和条件分支只能留在自身 `ai-providers/<provider>/` 实现内；跨 provider 分支属于 registry/engine 的职责。
- **PG-04 — 异步协议完整。** external id、轮询状态、成功结果、失败原因和 `retryable | permanent` 终态分类必须由共享 discriminated union 与唯一 normalizer 明确归一化；`failed` 缺少 disposition、非失败状态携带 disposition、未知 provider 状态或失败状态被映射为完成都必须原地失败。网络/查询异常直接抛出并恢复同一 external id，不得伪装成 provider 终态。
- **PG-05 — 零未声明降级。** 不支持的模型、能力、输出或 provider 故障必须显式失败。唯一允许的跨 provider 路由切换必须来自生产 registry 的穷尽等价 route set，并同时满足：同一产品能力、同一 canonical options、同一冻结报价、同一 Task/Resource/logical invocation，上一条路由返回 typed pre-accept rejection，且没有 external id、媒体结果或受理不确定性。accepted、`outcome_unknown`、超时/断连、异步 external id、poll/result 失败、permanent 内容拒绝和普通 retryable 失败均不得前进路由。业务层、Agent、provider adapter 不得自行 fallback。
- **PG-05A — 路由进度是 durable invocation 事实。** route set identity、当前 route index、每次 typed rejection 与最终实际 modelKey 必须写入同一 provider invocation checkpoint；Task retry/replay 从该 checkpoint 恢复，不能重新从第一路由开始。成功 Resource 只从 checkpoint 读取实际 modelKey。route set 不创建第二 Task、第二报价、第二 Resource 或第二 invocation，且 route 成员价格不等价时 registry 必须拒绝声明。
- **PG-06 — 提交与查询重试分离。** 媒体、LLM 与 vision POST 每个逻辑 invocation 在同一 DB Task attempt 只能发送一次。descriptor 解析、option canonical normalize、媒体引用 scheme 检查等不可能触达 Provider 的本地 preflight 必须在 durable provider fence 之外完成；成功后调用才先 claim fence，再且仅再执行一次可能发出请求的 adapter。明确未受理、结构化结果不可用或 external job 明确终态失败时，fence 才允许更高 attempt 原子重取该 invocation 的一次新提交权；成功的兄弟 invocation 继续重放。断连、超时、无类型 `success:false` 或无法证明是否受理的响应必须进入 `outcome_unknown`，禁止自动重提；纯本地校验失败不得写 `submitting/outcome_unknown` 或伪装成 Provider 拒绝。获得 external id 后的 poll、结果下载和存储读取可以按各自策略重试，但 pending job 只能恢复；只有明确终态失败才能重建 provider job。本地持久化失败重放 provider 结果与稳定 artifact key，不重新生成。Gateway 已分类的 typed `AppError` 必须原样穿过 Task handler；调用层不得再包装成通用可重试错误或据此重写 durable disposition。
- **PG-06C — Provider request identity 排除临时传输凭据。** durable request hash 必须包含媒体对象的 origin/path、顺序和全部非媒体 canonical option，但必须从签名图片、音频与视频 URL 中移除 query/hash；S3 签名、过期时间和临时 token 只授权本次传输，不是业务输入。adapter wire request 仍使用本次新签发的完整 URL，identity projector 不得修改它。相同对象在下一 Task attempt 取得新签名必须命中同一 checkpoint；对象路径、引用顺序或真实 option 改变仍必须 hash 分歧并失败关闭。
- **PG-06A — 排队与生成分开计时，排队超限走显式取消补偿。** pending 由 provider poll 协议归一为 `queued | running` 两个子阶段（无法区分的 provider 视为 `running`）：`queued` 只消耗独立排队预算（`PROVIDER_QUEUE_TIMEOUT_MS`，默认 30 分钟），`running` 才消耗生成预算（`PROVIDER_GENERATION_TIMEOUT_MS`），两者互不透支。排队超预算是 PG-06「pending job 只能恢复」的唯一受控例外，必须按固定顺序执行：① 先持久化“旧 external id 作废”（invocation checkpoint `submitted → retryable_rejected` 并记录被取代的 external id）；② 再尽力取消 provider 侧任务（registry 声明的 `cancel` 能力，幂等、容忍 4xx，失败只记日志）；③ 抛 retryable `GENERATION_QUEUE_TIMEOUT`，新提交只能由下一 Task attempt 经 durable fence 原子重取。崩溃恢复语义：任何一步之间崩溃，最坏结果都是一个已被持久作废、无人消费的孤儿 provider job（等价于 cancel 失败，可容忍）；绝不允许先取消或先重提再作废——旧 id 未作废前不存在第二个可提交身份，防止双活。上报 `queued` 阶段的 provider 必须同时在 async-task registry 声明 `cancel`。
- **PG-06B — 用户取消先服从本地终态，再尽力补偿Provider。** Task已获得durable external id
  时，用户cancel仍先由Task terminal owner决定本地canceled/completed事实；只有本地确认为
  canceled且terminal事务commit、Scheduler capacity已经释放、全部required FollowUpBatch
  已可靠通知后，独立可重试Activity才从provider invocation ledger穷尽读取真实
  external id并调用registry声明的cancel。poll/wait catch与handler不得提前cancel；queued
  `attempt=0`取消没有Provider补偿，handler checkpoint已提交而由completed赢得竞态时也绝不
  cancel。补偿失败只记录安全日志，不能复活Task、改写计费、重新提交或阻止本地cancellation
  receipt；Worker恰在补偿前丢失时可能留下Provider孤儿任务，这是显式运维盲区而非第二
  正确性owner。
- **PG-07 — LLM stream 与最终结果同源。** 唯一 AI SDK runner 必须把同一次 `streamText` 的 delta 与 SDK final promise 归一为同一个项目结果。若 final text/reasoning 是已发内容的严格前缀扩展，runner 必须在 `onComplete` 前补发确定 suffix；若此前没有对应 delta，则补发完整 final 内容。final 与已发内容分叉时必须原地失败，禁止拼接、猜测、重发整份内容、改走 `generateText`、跨 provider fallback 或发起第二次模型调用。
- **PG-08 — LLM 推理强度精确归一。** 推理强度 identity 由 `ai-registry/reasoning-effort.ts` 唯一定义，具体模型支持集合由生产 capability registry 穷尽声明，后台 LLM 调用只经 `ai-exec/reasoning-effort.ts` 合并显式参数、用户/项目 capability 配置或平台角色环境变量。调用方必须显式传递 `analysis | assistant | utility` 用途，禁止从模型名或 Task 名猜测。Codex Agent 自身的 effort 由 Runtime 配置冻结，不经过本 Gateway 伪装成后台 LLM 调用。
- **PG-08A — 可公开推理能力由 registry 声明。** 每个支持推理的后台 LLM 只能由生产 capability registry 声明 `none | native | summary_auto`；共享调用方不得从 model id、provider 名称或输出文本猜测。OpenRouter OpenAI 推理模型由 adapter 在同一请求中发送 `summary:auto`，Claude/Gemini 使用原生公开 reasoning；加密 CoT、signature 与 provider metadata 永不进入公开事件。公开 reasoning/text delta 只由统一 AI SDK runner/projector 解释；不得恢复 Agents SDK 专用 normalizer。
- **PG-09 — 结构化输出只有一个严格解释器。** 所有声明 JSON object/array 的 LLM 与 vision 结果必须经 `ai-exec/structured-json.ts` 解析，再进入 schema 与业务校验。解释器只可去除包裹整份响应的一个完整、匹配、无额外正文的 Markdown `json` 或无标签 fence；不得截取正文中的 JSON、修复内容、接受未知 fence 标签或从说明文字中猜测结果。外层包装以外的任何协议偏差必须显式失败。
- **PG-10 — 音乐时长能力由 registry 唯一声明。** FAL Lyria 只声明连续 `120–180` 秒能力；业务调用方必须从生产 registry 解析 provider 请求时长，不得维护固定时长枚举或复制范围。目标短于 120 秒时生成 120 秒后在本地精确贴合，目标位于范围内时按目标生成，超过 180 秒必须原地失败；`negative_prompt` 必须经 provider adapter 原样进入外部协议。
- **PG-11 — Provider 密钥只写不读。** 用户配置 View 只能返回 `hasApiKey`，不得解密或回传已有密钥；编辑界面以空 secret 字段表达“保持不变”，连接诊断缺省 key 时只在服务端按 provider owner 解密并立即交给 adapter。浏览器状态、日志和 API 错误不得保存或显示明文 key。
- **PG-12 — Provider 连接所有权服从部署模式。** `platform-key` 下 Provider identity、base URL 与密钥只由服务器环境配置拥有；用户 API 配置的读取、写入和连接诊断必须在任何数据库或外部请求前拒绝，相关 Operation 只允许 API channel，不能进入主 Agent 工具集。`user-key` 下个人设置继续是自定义 Provider 的唯一 writer。Provider transport 只负责按已选配置发请求与可选代理转发，不得再按 DNS 结果、私网/保留 IP、metadata、HTTPS、重定向或本地 allowlist 建立第二套可用性裁决；本地部署者对自定义网络目标负责。图片、音频、视频、multipart 与 base64 仍必须经共享字节上限读取，禁止无界 `arrayBuffer/formData/Buffer.from(base64)`。
- **PG-13 — 普通 LLM/Vision 只有一套 SDK 执行与结果协议。** 每个 LLM 模型必须在生产 capability registry 穷尽声明 `openai-responses | openai-compatible-chat | openrouter-chat | google-generative-ai` 传输协议；`ai-exec` 只通过一个 AI SDK `LanguageModel` runner 执行 `generateText/streamText`，并只通过一个 versioned、可序列化的项目 result projector 生成 durable result。Provider adapter 只拥有模型 factory、消息准备、专属 option/header、proxy、metadata/error 校验，禁止返回私有 completion shape、直用原生 Chat Completions、手写 Responses HTTP/SSE parser 或另建 LLM/Vision 执行链。Video 的 submit/status/result durable lifecycle 不属于该同步结果协议；会在进程内自动 poll/download 的高层 Video SDK 不得替换现有 durable handoff。
- **PG-13A — Codex Runtime wire 能力独立声明。** `LLMCapabilities.codexRuntimeWireApi` 是模型能否通过 Codex custom provider 调用的唯一裁判，不改变普通 AI SDK 的 `protocol`；当前只有经验证支持 OpenAI-compatible Responses API 的 OpenRouter LLM 显式声明 `responses`，其他 provider 缺失即拒绝且不得 fallback。
- **PG-14 — Provider 先按生命周期分类，再选择传输实现。** Runtime 只有 `sync final result` 与 `async durable job` 两种执行语义，图片、视频或 provider 名称不得代替该分类。同步接口优先由能保留参数 policy、proxy、安全上限、错误语义且可关闭提交重试的高层 SDK 执行；异步接口必须让项目分别调用 `submit/status/result`、在 submit 后立即持久化 canonical external id，并由 Temporal TaskWorkflow 调度同一 Task Activity 从 provider invocation checkpoint 恢复。任何 SDK 若隐藏进程内 polling/download、自动 fallback，或无法关闭不确定 POST 的重试，均不得接管该边界；保留项目低层 transport 不构成第二生命周期。OpenRouter Image 使用官方 SDK 的单次 `images.generate(stream=true)`：partial event 只维持同一同步传输，不写持久事实，唯一 completed event 才归一为最终图片；OpenRouter Video 使用官方 SDK 的独立 `generate/getGeneration`；FAL Queue 因官方客户端当前固定重试 submit，继续使用零自动重提的项目 transport。
- **PG-15 — 模型 option 只规范化一次。** `AiOptionSchema` 同时拥有允许字段、必填/冲突、值域和 canonical normalize；`ai-exec` 必须把其结果交给 provider adapter。adapter 只能把 canonical option 映射为 provider SDK/wire 字段，不得再次维护同义 allowed-key、枚举、默认值或跨字段裁决。跨 provider 的同模型族规则必须由共享 policy builder 生成，各 provider 只声明自身 capability/policy 差异；把重复解释移动到 shared wrapper 但保留第二裁判不算收敛。
- **PG-16 — Voice Design 是独立固定模态。** `voice` 不能伪装成 music 或 video audio。Qwen Voice Design 1.7B 的模型 identity、多语言枚举和按字符价格由 FAL production catalog 唯一声明；Agent-facing `generate_voice` 不接受 provider/model/temperature/seed 等参数。adapter 只映射 canonical `description + text + language` 为 FAL `prompt + text + language`，通过共享 FAL external id/poll 协议恢复，完成后仍进入共享音频字节上限和稳定 Task artifact 持久化。
- **PG-17 — 视频参考声音能力由 registry 穷尽声明。** `VideoCapabilities.maxReferenceAudios` 是是否允许参考声音及其上限的唯一裁判；缺失即不支持，提交计费 Task 前失败。当前 Seedance 2.0 provider variants 声明最多 3 个声音参考且至少需要 1 个图片参考。统一执行输入是 `referenceImages + referenceAudios`：OpenRouter adapter 映射为一个多模态 `input_references`，FAL 映射为 reference-to-video 的 `image_urls + audio_urls`，Ark 映射为带 `role=reference_audio` 的 content；adapter 必须拒绝超限、不支持的模型和声音无图片组合，禁止静默截断或降级。私有图片、音频和视频引用在进入 Gateway 前必须共同经过 owner-aware outbound media 入口，按模态校验对象 metadata 后投影为有界时效的绝对签名 URL；Gateway 不再按 HTTP/HTTPS 或公网可达性建立第二套媒体引用裁决。FAL、Ark、OpenRouter Video 直接消费 URL；只有外部 SDK wire 明确要求 inline bytes 的 adapter（当前 Google Image/Video 与 OpenRouter Image）可在自身内部有界下载并编码，Base64 不能成为 Task、Task Activity、Gateway 或跨 provider 的媒体协议。
- **PG-18 — Provider result 下载只有一个 SSRF-safe 出口。** 应用主动下载外部图片、音频或视频结果时只能调用 `src/lib/media/outbound-fetch.ts`：URL scheme、凭据、私网/保留地址、DNS 全结果与每次 redirect 都必须 fail closed，实际 socket lookup 必须再次执行同一地址 policy，避免 DNS precheck 与连接解析之间的 rebinding。透明代理把公网 DNS 映射到 `198.18.0.0/15` 时，只能由固定 TLS 认证的公共 DNS JSON 入口重解并继续校验其公网结果，失败仍原地拒绝；禁止把该保留网段直接加入 allowlist。禁止 hostname-only 内网例外、普通 `fetch` 旁路或只检查首跳；owner-aware 自有媒体仍先由 ASO policy 投影为外部 HTTPS URL，再进入同一下载边界。
- **PG-19 — Provider 边界产出 typed failure。** adapter必须在最了解协议的位置把鉴权、
  Provider账户欠费/配额、限流、内容策略、超时与畸形结果映射为统一 registry code；异步
  `failed` poll结果必须携带 code。共享 normalize只接受 typed code/status作为兜底，不得以
  Provider英文/中文 message子串猜业务语义。原始响应只进入受限内部诊断，用户和模型投影
  不得读取。连接诊断也只返回有限 `messageKey`，不得把 Provider detail交给浏览器。
- **PG-20 — 同一模态共享一次 preflight 与错误分类。** Operation planner 与 `ai-exec` 必须调用同一个 option normalizer；planner 还要在 Plan 前验证所选 provider 凭证/连接配置，并让确切的冻结 Worker option 通过全部 registry 声明的 pre-accept route。Provider 缺省 base URL 只来自 API config registry，不能由 adapter 私自补另一份。已冻结 option 到 adapter 前不得再补默认或删除未知字段。音乐产品字段由共享编译器组成最终 wire prompt，长度约束必须检查该最终文本，而非只检查尚未追加 genre/mood/时长的原文。使用同一 SDK 的 provider 模态共用一个 typed HTTP/stream classifier，至少保留鉴权、账户额度、限流、内容/隐私策略、请求拒绝、外部故障与网络超时；adapter 只补充该模态确实独有的响应结构校验。敏感内容拒绝是 permanent 业务事实，不能坍缩成内部错误或被 Agent 跨工具绕过。

## 权威入口

- Provider adapter、媒体/LLM 实现与异步注册：`src/lib/ai-providers/`。
- Agent Web Search 由 Codex Runtime 与 Web Search 模块拥有，不进入 `ai-exec` 或 provider adapter。
- 同步 OpenRouter Image 的唯一外部协议入口：`src/lib/ai-providers/openrouter/image.ts` 的官方 SDK `images.generate(stream=true)`；OpenRouter Video 的唯一 submit/status 入口：`src/lib/ai-providers/openrouter/video.ts` 的官方低层 SDK。两者继续由同一 OpenRouter adapter 暴露，不允许业务调用方直连 SDK。
- 执行引擎、结果归一化与异步轮询：`src/lib/ai-exec/engine.ts`、`src/lib/ai-exec/async-poll.ts`、`src/lib/ai-exec/async-wait.ts`；FAL image/video/music/voice 共用标准 external id 与这一等待入口，provider adapter 不在提交函数内隐藏第二套轮询循环。排队/生成双计时与 `queued | running` pending 阶段的唯一解释者是 `async-wait.ts`；provider 侧取消按 async-task registry 的 `cancel` 能力经 `async-poll.ts` 的 `cancelAsyncTask` 分发，共享调用方不得按 provider 名称猜测取消能力。voice/music 与 image/video 共用同一等待回调协议（取消检查 + 排队/生成阶段进度上报），由 Task Activity 传入，engine 不自带第二套上报。
- 普通 LLM/Vision 的唯一外部执行与结果投影：`src/lib/ai-exec/llm/sdk-runner.ts`、`src/lib/ai-exec/llm/result-projector.ts`；模型传输协议的唯一声明与解析：各 provider `models.ts` 的 capability catalog、`src/lib/ai-registry/llm-protocol.ts`。
- Task 媒体/LLM/vision 提交围栏与结果重放：`src/lib/task/provider-invocation.ts`；稳定产物身份：`src/lib/task/artifact-storage.ts`。
- 模型目录、价格、能力和运行时选择：`src/lib/ai-registry/`。
- 等价 Provider route set 的唯一声明与解析：`src/lib/ai-registry/provider-route-set.ts`；路由推进只由 `src/lib/ai-exec/engine.ts` 调用 `src/lib/task/provider-invocation.ts` 的 durable fence 完成。
- 模型 option 的唯一校验与 canonical normalize：各 adapter descriptor 暴露的生产 `AiOptionSchema`、`src/lib/ai-exec/normalize.ts`；GPT Image 2 跨 provider 的共享 schema/pixel policy 为 `src/lib/ai-providers/shared/gpt-image-2.ts`。
- LLM 推理强度的唯一运行时解析：`src/lib/ai-exec/reasoning-effort.ts`；平台 assistant/analysis 模型 identity 与角色环境配置入口：`src/lib/platform-models/` 和 `.env*.example`。
- 结构化 LLM/vision 输出的唯一 envelope 解析、shape 校验与 schema 执行入口：`src/lib/ai-exec/structured-json.ts`、`src/lib/ai-exec/structured-step.ts`。
- 用户可配置 provider identity 的唯一目录为 `src/lib/ai-registry/api-config-catalog.ts` 的 `API_CONFIG_CATALOG_PROVIDERS`；保存校验和运行时读取必须复用其 `isApiConfigCatalogProviderId`，不得维护私有白名单。严格解析与写入仍由 `src/lib/user-api/**` 负责，运行时选择入口为 `src/lib/user-api/runtime-config.ts`。
- Provider 可选出站代理：`src/lib/http/outbound-proxy.ts`；请求/响应体积入口：`src/lib/http/body-limits.ts`。部署模式与用户 Provider 配置可用性的唯一裁决分别是 `src/lib/deployment/config.ts` 与 `src/lib/user-api/availability.ts`。
- Provider-bound 私有媒体投影的唯一共享入口：`src/lib/media/outbound-owned-media.ts`；图片、音频和视频只在 `src/lib/media/outbound-{image,audio,video}.ts` 追加各自 MIME 与大小 policy，再输出签名 URL。durable request identity projector 在 `src/lib/ai-exec/media-references.ts`；projector 只从 hash 输入剥离 URL query/hash，adapter wire request 仍消费完整新签名。adapter 内部 inline 转换不改变该协议。
- Provider result 与外部媒体 body 的唯一下载入口：`src/lib/media/outbound-fetch.ts`；`outbound-image`、storage image/video import 与 audio result processing 只消费该安全 Response，再进入共享 body limit。
- `standards/capabilities/**` 由 capability 检查脚本读取，不是生产 runtime registry 的 writer；运行时从 `src/lib/ai-providers/*/models.ts` 经 builtin catalog 注册。修改 standards 必须审计相应 runtime catalog，不能把校验通过解释为生产能力已切换。价格已不存在 standards 表示：`scripts/check-pricing-catalog.ts` 直接读取运行时 catalog。
- 模型 identity 分布在 capability、pricing、API config 与 platform preset 四张数组，靠 `(type, provider, modelId)` 三元组联接。`src/lib/ai-registry/pricing-coverage.ts` 在注册末尾穷尽校验「可被用户选择的模型必须有价格」，缺价必须在注册期失败，不得留到用户选中后才在计费时报 `BILLING_UNKNOWN_MODEL`。

## 发布边界

视频生成 `fps` 字段从 Tool Schema、capability、Task payload、执行 option 与 provider adapter 一次性删除，不提供旧字段双读或静默忽略。Seedance 2 token 报价公式中的固定帧率常量与本地视频合并转码的固定帧率归一化属于内部算法/编码事实，不是生成输入。部署前必须排空旧版本仍可能携带该字段的 pending Approval、queued/processing Creative Resource video Task 与对应 Wait；历史终态 Resource/plan 保持不可变，不执行数据回填。

## 验证

- `npm run test:critical:provider` 保留真实 adapter/wire 边界：FAL 与 OpenRouter 的提交/轮询/终态、零隐式 POST retry、模型能力、连接和 hosted web search 的结构化证据协议。
- `tests/integration/task/provider-invocation-at-most-once.integration.test.ts` 使用真实 MySQL 验证并发首次提交唯一、route advance、重放和 `outcome_unknown` 零重提。私有声音 owner + S3 读取属于部署对象存储复验盲区。
- `tests/contracts/provider-api-config-conformance.test.ts` 从生产目录穷尽检查 provider identity、runtime adapter 与严格 parser；`tests/unit/provider/media-reference-identity.test.ts` 反证 signed URL query/hash 漂移不会改变 durable identity、对象路径或真实 option 改变仍会改变；其他 unit 只保留独立协议/算法 oracle。
- `npm run check:capability-catalog` 与 `npm run check:pricing-catalog` 只验证 standards 文件自身结构，不证明运行时值或真实外部 Provider 已验证。

脚本模型、脚本媒体 Provider 和创作 Journey 已删除；真实模型质量、付费 Provider 接受度与长上传时延只能通过发布前真实调用和生产观测验证。
## 历史回归

- OpenRouter Image 与 Video 已迁到同一官方 SDK，但两者分别维护错误判断：真实视频返回 `InputImageSensitiveContentDetected.PrivacyInformation` 时被包装为通用外部错误，Agent 随后改走直接视频与批量清单重复尝试；图片 SDK 的 HTTP 和 mid-stream 机器错误也没有一致语义。Mureka 同期把 HTTP 200 的任意 `message` 当错误，又让非 2xx、缺 task id 与错误的 sync execution mode 混在一起。当前 OpenRouter 两个模态共用唯一 SDK HTTP/stream classifier，隐私/内容拒绝映射为 permanent typed failure；Mureka 只按官方协议从非 2xx `error` 读取拒绝，200 读取 task id，并按真实异步 external-id 生命周期注册。无法证明是否受理的无结构响应仍保持 outcome-unknown，不自动重提。

- 媒体 Operation 曾只解析“模型存在”，没有在 Plan 前读取实际 Provider 配置；用户配置省略 OpenRouter base URL 时，API config 表单明明声明官方默认地址，Worker 却在 Resource/Task 已建立后才报 `PROVIDER_BASE_URL_MISSING`。同一根因还让 Ark 连接测试使用私有默认地址而真实 LLM runtime 得不到地址，图片、视频和轮询又各自硬编码官方地址。当前 runtime config 的缺省 base URL 唯一来自 API config registry；Ark 的连接测试、同步提交、异步轮询与 LLM 共用这份配置并允许同一显式 override。planner 在报价与任何持久副作用前验证所选 Provider 凭证/连接；route 等价但 option schema 不兼容也在同一 preflight 原地失败。

- 视频 retry 已能从 failed Resource 恢复冻结输入，但每个 attempt 都重新签发私有图片/声音 URL；Gateway 又把完整签名 URL 计入 durable request hash。真实 Provider 明确 retryable 拒绝后，下一 attempt 因 `X-Amz-*` 与过期时间变化在发请求前触发 checkpoint request mismatch，用户看到“可重试”却永远无法重新提交。旧 retry 修复只证明原 Task/payload 与 Resource identity 稳定，没有区分业务对象身份和传输凭据。当前所有媒体 route 在 claim fence 前用同一个 identity projector 移除媒体 URL query/hash，wire 输入不变；对象 origin/path、顺序和 canonical option 继续参与 hash。
- OpenRouter GPT Image 2 的同步 AI SDK `generateImage` 只能等待 `/images` 返回整包 JSON；真实 4:3 1K high 请求中，七张图在 118–195 秒内完成，两个同场景请求都在约 200.47 秒被传输对端关闭，应用的 5 分钟总超时尚未触发。旧本地 provider contract 只返回即时 JSON，没有反证同步长连接的固定空闲边界；继续 Task retry 只会重放同一传输风险。当前唯一 Image adapter 改用已安装的官方 OpenRouter SDK，并在 production endpoint 明确声明支持 native streaming 时发送一次 `stream=true` POST；partial image 只作为同一 invocation 的传输事件并逐项执行图片字节上限，只有唯一 completed event 形成 GenerateResult。pre-stream HTTP、mid-stream error、未知事件、缺失/重复 completed、断连和超时全部显式失败，SDK retry 关闭，durable provider fence 仍禁止重提不确定 invocation。本地 SSE wire contract 反证 `stream=true`、partial→completed 投影和 POST 至多一次；真实收费长图是否稳定跨过原 200 秒边界仍需发布复验。
- `3f871a490` 删除 ElevenLabs ambient-sound provider 时移除了 adapter、model、执行和运行时白名单，却遗留 API 配置目录项与 Cloud env 样例。Profile GET 因而把不可执行的 ElevenLabs 合并进表单，而前端每次 PUT 都回传全部 provider；严格 writer 在任何字段保存时均以 `PROVIDER_NOT_SUPPORTED` 拒绝整笔事务，刷新后用户配置全部回退。旧 provider contract 只验证执行与连接协议，`check:model-config-contract` 只扫描已落盘 model shape，都没有从生产配置目录穷尽穿过 writer/runtime。当前删除幽灵目录与 env 入口，保存 parser 和 runtime reader 复用目录 identity，并由 registry conformance 同时对齐 builtin model、adapter、platform env 与严格 parser；真实浏览器保存/刷新仍需可用 MySQL 环境复验。

- OpenRouter LLM 曾要求同一 model id 分别手工加入 pricing、capability、API config 与 platform preset 四张数组；GPT-5.6 Sol 已接齐四处，而环境切换到真实存在的 Claude Fable 5 时只有配置值、没有 catalog 声明，启动因此报 `PLATFORM_DEFAULT_MODEL_NOT_FOUND`。直接允许任意 OpenRouter 字符串虽然能通过统一 HTTP transport，却会丢失价格、reasoning 与类型裁决。当前 provider-owned LLM definition registry 是唯一声明源，四个 catalog 全部派生；未知模型仍 fail closed。

- `ccdd10be6` 修复 FAL 异步失败未被 surface 的问题：provider 的失败终态必须进入统一任务失败边界，不能留在 polling 中静默消失。
- `9207d119` 修复视频生成的项目模型 fallback：模型不可用应显式失败，不得改用另一个模型或 provider。
- `95254ae71` 收敛 AI 与 Task 重试，说明 provider 的错误分类不能由多个调用层各自猜测。
- 旧 worker retry Journey 曾发现所有 `FetchStatusError` 被 durable fence 统一解释为永久拒绝，导致 Task retry 形同虚设。提交结果分类仍必须由 fence 一次性写入；当前只有 TaskWorkflow 可根据该分类创建下一 business attempt，Activity retry 不得另行增加 attempt。
- 结构化 LLM 输出校验曾发生在 provider checkpoint 已写 `submitted` 之后；队列虽进入更高 attempt，网关仍永久重放旧结果。逻辑 invocation 必须由结果消费者显式写回“该结果不可用”，但重新提交资格仍只由 provider fence 的 attempt CAS 裁决，不能由业务调用方另开请求入口。
- `95254ae71` 曾把 fence 剥离与 JSON 内容修复、正文截取放在同一 `safeParseJson`；`d8a1685dc` 为恢复严格输出契约删除整条 repair 路径时，也一并删除了安全的外层 envelope 规范化。真实 `edit_style_preview_options_generate` 随后因完整合法 JSON 被 ` ```json ` 包裹而连续三次进入 `PARSE_ERROR`。当前只在唯一结构化解释器中剥离完整匹配的最外层 fence，继续拒绝所有内容修补与正文猜测。
- OpenRouter SDK 可在 stream final promise 才暴露此前 delta 未完整携带的正文；旧 adapter 用该正文完成正式持久化，却没有补给同一次 stream callback，造成 Task 成功而 Canvas 没有 structured preview。现由共享 runner 同时归一 text/reasoning：只补发 final 相对已发内容的确定 suffix，分叉内容直接失败，也不发起第二次调用。
- 普通 LLM/Vision 曾同时存在 AI SDK 结果、原生 OpenAI `ChatCompletion` 和 Google SDK 私有结果，Ark 还维护手写 Responses HTTP/SSE parser；各 provider 的局部 adapter/test 只证明自身 shape，未能反证跨 provider 的第二结果协议、重复 usage/finish 解释和 durable result 伪装成 ChatCompletion。现在所有 runtime LLM capability 显式声明传输协议，Ark 使用 `@ai-sdk/openai` Responses、兼容 Chat 使用 `@ai-sdk/openai-compatible`、OpenRouter 使用其 AI SDK provider、Google 使用 `@ai-sdk/google`，并统一进入一个 runner/projector；Ark thinking、OpenRouter cache/session/cost、Google cached tokens 仍由 provider 边界精确保留。部署此不兼容切换前必须排空旧版本进行中的 LLM/Vision invocation；`schemaVersion: 1` 结果解析器明确拒绝旧 ChatCompletion 持久结果，不保留双读兼容层。Video 因高层 SDK 会隐藏 submit→poll→download，继续使用现有 durable submit/status/result，不以进程内轮询换取代码缩短。
- 2026-07-19 统一 AI SDK 协议时，OpenRouter request shaper 曾用模型创建时的 `input.messages` 快照覆盖本次 wire body，动态增长对话因而丢失 Claude 顶层 `cache_control` 并按全量输入计费。当前唯一 OpenRouter fetch 出口以本次 wire body 为事实：Claude 在没有显式断点时自动加入 5 分钟顶层缓存，显式 Claude/Gemini block 只能在与 wire role/text 完全一致后附加，禁止旧快照覆盖。真实付费 Provider 的路由与命中率仍需发布前监控 `cached_tokens/cache_write_tokens`，不由 contract 伪造命中。
- OpenRouter GPT Image 2 新实例最初继续手写 `/images` DTO、Authorization、JSON 与 base64 response parser，虽然没有产生第二业务入口，却绕过了当时已安装 AI SDK 的同步图片协议；该路径曾收敛到 `imageModel + generateImage`。真实长图随后证明整包等待无法承载 Provider 已正式支持的 native SSE，当前在同一个 adapter 内以官方 OpenRouter SDK 的 typed `images.generate(stream=true)` 替换旧 AI SDK 路径，仍保留 option policy、引用图规范化、proxy、字节上限、5 分钟总预算和零 SDK retry，不恢复手写 DTO/parser 或第二入口。OpenRouter Video 不复用会自动 poll/download 的 AI SDK `videoModel`，而由 `@openrouter/sdk` 的独立 `generate/getGeneration` 保持 durable external id。评估 FAL 官方客户端时发现 `queue.submit()` 固定最多重试三次且调用方不能关闭；在超时但 provider 已受理时会产生不可恢复的兄弟 job，因此该迁移被拒绝，现有 FAL transport 继续作为唯一安全入口，待 SDK 能显式关闭 submit retry 后才能重审。
- OpenRouter Video 曾在 `202` 通道返回结构化 `error` 对象，而 SDK 只接受字符串 `error` 或完整 `id/polling_url/status`，四个并行视频因此全部退化为无信息的 `Response validation failed`；旧防线只识别 HTTP `status/statusCode`，既丢失 Provider 原因，也会把任何 `202` schema 漂移误当作明确未受理。当前唯一 Video adapter 从 SDK `ResponseValidationError.rawValue` 只提取有界的 `code/message/error_type`：存在 canonical `id` 时继续持久化该 external identity，无 id 的显式 error 才进入 typed rejection，既无 id 也无 error 的畸形响应进入 `outcome_unknown`，禁止重提。真实 Provider 的下一次具体拒绝原因仍需新的收费提交才能验证；contract 仅以本地协议服务器反证三种边界与 POST 至多一次。
- OpenRouter Video 提交曾与短响应 status 查询共用固定 60 秒超时；多个携带内嵌参考图的请求经代理并行发送时，客户端在 Provider 记录调用或返回 external id 前同时中止，八个任务全部进入 `outcome_unknown`。旧 contract 只经过本地快速协议服务器和小请求体，SDK 切换时也明确未执行收费真实调用，因而没有反证真实上传时延；旧日志只记录任务起止，无法区分请求体准备、代理传输与 Provider 响应。当前唯一 Video adapter 将 submit 超时独立提高到 5 分钟，status 查询仍为 60 秒，并记录请求体字节数、准备耗时、代理启用状态、传输阶段、HTTP 状态、总耗时与 abort reason；日志不记录 prompt、引用 URL、Base64 或凭证，`outcome_unknown` 的零重提防线保持不变。真实代理的已上传字节数和 Provider 接入层耗时仍不可由应用直接观测，后续需结合新增日志与 Provider 账户记录判断。
- Seedance 参考声音首次接入时，图片已通过 owner-aware storage normalizer 输出 Base64，声音却单独调用浏览器签名 route，并把 MinIO 返回的相对 `/api/storage/sign?...` 原样交给 Provider；真实 OpenRouter 请求因 `audio_url.url Invalid URL format` 在受理前返回 400，而无声音的同批任务正常得到 202。第一轮修复把两者都改成 Data URL，虽然删除了 session 旁路，却仍假设图片与音频拥有相同 wire 能力；OpenRouter 的声音字段要求 HTTPS，且并行大请求继续承担完整媒体上传时延。本版本改为私有图片/声音/视频共用 owner→HeadObject→MIME/size→presign 投影，但不再由 Gateway 强制 URL 协议或公网可达性；FAL/Ark/OpenRouter Video 不再上传 Base64。Docker MinIO 与 HTTP 签名 URL 是当前开发契约；任何外部 Provider 的实际接受度不由本地 gate 推断。
- 官方 OpenAI Image provider 在 `e12f7ecdc` 删除 legacy provider surface 时已失去全部执行入口，但共享 transport 与根依赖一度残留；之后 FAL 与 OpenRouter GPT Image 2 又分别复制 registry 已声明的尺寸、质量与格式规则。当前中立格式常量与 GPT Image 2 schema/pixel policy 合并为共享 builder，`AiOptionSchema.normalize` 是唯一 canonical 解释，adapter 只做 provider 映射；旧 transport、直接依赖与 Agents SDK 已删除。
- 音乐模型能力曾以少数固定秒数枚举表达，业务层因此无法为任意时间线声明明确请求。现在 FAL Lyria 在生产 registry 唯一声明连续 `120–180` 秒；短时间线统一请求 120 秒并由本地确定性 conform，范围内精确请求，超长请求拒绝。provider contract 直接观察真实 HTTP payload，防止调用方重新写死枚举、丢失负向提示词或绕过范围校验。
- 用户 Provider 配置 GET 曾直接解密并把 API key 回传浏览器，连接测试也依赖客户端重新提交明文；设置页鉴权只能防跨用户，不能防浏览器扩展、XSS、前端日志或缓存泄露。当前 View 永远只返回 `hasApiKey`，保存成功后立即清空客户端 secret，诊断按 providerId 在服务端解析既有 key。浏览器端明文回归由响应契约与真实 Profile Journey 复验，恶意浏览器扩展不在应用可控制边界内。
- `98e1c725e` 为用户可配置 Provider 增加统一 SSRF/DNS 防线，却把平台环境变量、Self-hosted 配置和 Provider 动态地址都解释成同一种不可信 URL；Cloud 同时只隐藏 API 配置页面，仍把配置 Operation 暴露给主 Agent并保留连接诊断 API。Clash Fake-IP 将合法 `openrouter.ai` 解析到 `198.18.0.0/15` 后，真实 Assistant 模型请求在交给显式代理前被误拒绝，既有安全测试因为依赖测试 allowlist 而没有覆盖该组合。当前以部署模式重新划定所有权：Cloud 用户配置和诊断在统一 availability 入口原地拒绝，配置 Operation 改为 API-only；Self-hosted 部署者继续拥有自定义连接。旧 URL policy、DNS/IP/metadata/redirect 裁决、私网 allowlist 和对应测试环境分支整体删除，代理只负责路由。Self-hosted 多个互不信任用户共享同一网络时的出站风险由部署者承担，不再由运行时阻断。
- OpenRouter GPT Image 2 在真实调用中返回账户 billing hard limit；这不是平台 credits 不足，也不能由 Agent 看错误文案后重建一次 FAL 调用。旧 PG-05 绝对禁止跨 provider，因此系统即使拥有同 capability 的 FAL provider 也只能终止。当前把例外收窄为 registry 声明的等价 route set：OpenRouter adapter 将“请求明确未被受理且无外部身份”的响应规范化为 typed pre-accept rejection，Gateway 在同一 durable invocation 内前进到 FAL；任何受理不确定性都保持失败，不以可用性为理由切换。真实外部双 Provider 调用仍未执行，当前证据只覆盖协议与 DB fence（DB 可用时）。
- GPT Image 2 的共享 pixel policy 曾只在缩放触及像素/边长上下限时对齐 16，常用 1K 尺寸因未触发缩放而直接产生 `1080` 短边；真实 4:3 资产图以 `1440x1080` 被 Provider 拒绝，既有 contract 反而把未对齐尺寸写成期望值。当前 canonical normalizer 在任何约束前统一向上对齐宽高，OpenRouter wire contract 直接反证非 16 倍数重新出现。
- Qwen Voice Design 首次接入只登记了 capability、pricing、adapter 和固定模型选择，却遗漏 platform/API runtime catalog，并让 user-key runtime 保留第二份不含 `voice` 的媒体类型判定；provider contract mock 了 runtime-config，因此真实 `generate_voice` 在 HTTP 前以 `MODEL_NOT_FOUND ... not enabled for voice` 全部失败。当前 FAL provider identity 同时进入 platform 与 API catalog，runtime-config 删除私有类型裁判并复用共享穷尽 parser；voice 模态的运行时模型固定由平台目录解析（任何凭证模式），provider 凭证仍按部署模式解析。真实 user-key 组合是发布复验边界，不再以复制 runtime 选择实现的 Unit 测试冒充独立证据。
- OpenRouter LLM adapter 曾为每次成功响应克隆并读完整 response body，再把全部 SSE token、推理正文与 usage 写入 INFO 日志；第一轮修复停止读取正文，却继续复制完整响应头，使 OpenRouter 的浏览器 `permissions-policy`、Cloudflare 元数据等无关内容在每次调用重复出现。两者根因都是把无界 Provider 响应元数据复制进例行 INFO 日志，而旧防线只覆盖 body。当前 Provider 日志只记录 URL、HTTP 状态、session identity、收到响应头的耗时，以及显式允许的 generation/provider/edge 诊断 identity；不记录完整响应头或正文，正文仍只由唯一 AI SDK runner 消费和投影。
- 外部异步任务受理后，共享 poll 入口曾在每次查询都写一条 Provider 解析 INFO；Worker 又对同一次 pending 写进度 INFO，四个并行视频因而每数秒产生交错日志。这些日志不是提交、计费或终态事实。当前 poll 仍由 durable external id 唯一恢复，但例行 pending 查询不再输出 INFO；受理、完成、明确失败、查询异常与终态仍保留可观测性。该契约后来在 FAL status 查询处以每次 poll 一条 INFO 换形式复发（单音色任务 269 行），现连同 pending 子阶段一并收敛：例行 pending 查询只记 DEBUG，`queued↔running` 阶段变化才 INFO。
- 2026-07 一次真实音色任务同时暴露三个根因。其一，dev `tsx watch` 重启旧 worker 进程杀死轮询协程，BullMQ stalled 重投、DB attempt 与 reconciler 同时解释执行所有权，产生假失败和延迟恢复；其二，FAL 请求可在官方队列 `IN_QUEUE + queue_position=0` 卡住十几小时，而排队与生成共用超时会反复恢复同一个永不开始的 external id；其三，voice/music 没有接入与 image/video 相同的取消和阶段回调。当前防线删除 Bull、DB heartbeat claim 与 reconciler：TaskWorkflow 是唯一 business-attempt owner，Activity heartbeat 只向 Temporal 报告存活，Worker 丢失后同一 attempt 从 provider checkpoint 恢复；排队/生成按 PG-06A 分账并在排队超限时按“先作废旧 id → 尽力 cancel → 下一 business attempt 取得新提交 identity”执行；四类媒体共用同一等待回调。真实 Worker kill/heartbeat恢复由 Temporal+MySQL 故障场景验证，真实 FAL cancel 响应仍属发布观测盲区。
- B+ Task handler移植曾只让image在成功后读取durable accepted route；video、music与voice仍
  返回请求payload中的primary model/provider。已有PG-05A只能约束ledger与Resource原则，
  没有让所有同类handler共用实际交接入口，属于新增实例漏接契约。当前四类媒体都经
  `requireTaskProviderRouteSelection`读取submitted checkpoint，terminal result和Resource
  provenance只写实际accepted route；缺失route原地失败。现有跨Provider route set仅用于
  image，因此真实video/music/voice failover仍是未来新增route声明时的发布复验边界。
- 用户取消补偿第一次接入时，image/video在poll catch、music/voice在handler catch直接调用
  Provider cancel；此时Task terminal事务尚未裁决并发的completed checkpoint，可能取消已经
  赢得本地终态的外部工作。当前所有早期cancel入口删除，只有terminal Activity取得正式
  canceled receipt后才从ledger穷尽补偿。第二版虽修正终态顺序，却把Provider网络等待留在
  `commitTaskTerminal` Activity内，使已经终态的Task继续占Scheduler容量。第二次拆成独立
  Activity后又把补偿串行放在required follow-up之前，ledger长期故障会让Batch永远无法通知。
  当前Workflow先release capacity、再可靠通知全部ready Batch，最后才调独立可重试补偿
  Activity；ledger查询失败由Temporal重试，单个Provider cancel失败只记日志。queued取消和
  completed winner都是明确no-op。
- 同步图片 Gateway 已在 durable fence 中把 POST 断连判为 `outcome_unknown`，但旧图片结果 helper 曾捕获所有异常后统一包装成 `IMAGE_GENERATION_THROWN/GENERATION_FAILED`；Task policy 因此把同一逻辑 invocation 调度到三次 attempt，虽由 fence 阻止了第二次真实 POST，用户仍看到错误的可重试表象和被吞掉的 canonical code。旧提交围栏只保证“不会重复请求”，没有保证 typed disposition 穿过 handler。当前图片 helper 原样抛出 Gateway `AppError`，仅包装尚未分类的本地异常；Task 直接持久化 `PROVIDER_SUBMISSION_OUTCOME_UNKNOWN` 的非重试终态。真实外部断连是否已被 Provider 受理仍不可从客户端证明，因此显式新任务是唯一允许的再次生成入口。
- Mureka cue score 新增 `scoreWindowStartMs/scoreWindowEndMs` 时，Worker、adapter runtime type 与 wire mapping 已接入，production option schema 和 engine execution type 却漏接；共享 `normalizeAiOptions` 又被包在 durable route `execute()` 内。真实 Task 在任何 HTTP 前抛出 plain `AI_OPTION_UNSUPPORTED`，fence 因已写 `submitting` 且无法证明错误来源，只能按 PG-06 记为 `outcome_unknown`。旧 provider conformance 分别验证了 adapter capability 与 fence 的 typed `AppError`，没有从真实 Worker payload 穷尽 option schema，也没有反证本地规范化发生在 claim 后。当前 Mureka schema 正式声明并交叉校验两个窗口字段；`executeMediaGeneration` 为所有媒体 route 在构造 route 时完成 descriptor/normalize，保留原 request hash 与 invocation identity，durable fence 内只剩可能触达 Provider 的 adapter execution。adapter 内其他 provider 配置与 wire 前置条件仍由 typed `AppError` 最后防守；真实收费 Mureka submit 未执行。

- Assistant reasoning 首次展示只改了 renderer 与终态投影，OpenRouter 请求没有声明 `summary:auto`，真实 GPT 只返回 encrypted block；随后虽增加占位状态，SDK UI converter 又忽略嵌套 `model/reasoning-delta`，真实组合仍在长推理期间保持空白。当前 capability registry 决定请求语义，共享 normalizer 只接收可读 delta，provider wire contract 与 wakeable stream logic 分别反证“没有摘要”和“摘要被缓冲”两种复发；真实外部 provider 仍需发布前复验。
- 媒体 SSRF 首轮防线只在 `outbound-image` 中做“DNS 预检后普通 fetch”，实际连接会再次解析 hostname，且对配置过的 internal hostname 按 host 放行任意端口；Provider result 的 storage image/video 与 audio 下载还完全绕过该 policy。旧安全测试 mock 了 DNS 与 fetch，只证明预检被调用，无法反证 DNS rebinding 或旁路。当前全部主动媒体下载收敛到 `outbound-fetch`：每一跳先检查全部解析结果，socket lookup 再执行同一 policy 并只连接通过的地址；hostname-only 例外和三条普通 fetch 已删除。

- Provider错误过去主要由共享 normalizer 对四十余个中英文 message子串分类，导致自部署
  Provider账户欠费被误判为平台余额不足；Ark、Google、OpenRouter、FAL的异步失败又只传
  message，无法稳定到达终态。当前 adapter在协议边界产出 canonical code，平台余额与
  Provider凭证/账单分离，所有异步 poll union强制携带 errorCode；字符串猜测分支已删除。
  真实各 Provider 的拒绝 body仍可能随外部协议变化，需在发布监控中以内部诊断补充分类，
  不得把未知 message再次暴露或加入共享子串规则。
- Adapter 已开始抛出 typed `AppError` 后，durable provider fence 仍只用它判断
  `retryable_rejected/rejected`，随后却重新包装为通用 `PROVIDER_SUBMIT_FAILED` 或
  `PROVIDER_SUBMISSION_REJECTED`；进程若在 checkpoint commit 后重放，checkpoint 又只保存
  name/message，连本次进程内尚能保留的 code 也会丢失。这是同一“分类在调用层被覆盖”根因
  的换形式复发，旧 at-most-once 场景只反证重复 POST 与 checkpoint 状态，没有把 canonical
  code 当独立 oracle。当前 fence 将 typed code 与 disposition 写入同一 checkpoint，立即返回
  和重放都重建同一 `AppError`；未知错误仍保持 `outcome_unknown`，没有新增提交或重试入口。

## 修改检查表

1. provider/model 是否来自统一服务端 selection 或声明式等价 route set，而非 Agent、名称、类型或错误文案推断？
2. 调用是否经过 ai-exec 与 provider adapter，而非 route/Task Activity 直连？
3. 新 provider 专属代码是否只放在自己的 provider 目录？
4. 异步任务的 external id、poll、成功、失败与 retryable 错误是否完整覆盖？
5. 非 typed pre-accept rejection 是否明确报错；合法 route advance 是否保持同一 Task、报价、Resource、invocation 与 durable checkpoint？
