<!-- architecture-module: provider-gateway -->

# Provider Gateway

## 设计理念

Provider 差异只能停留在 `ai-providers` 的 provider 实现、`ai-exec` 的统一执行/轮询边界和 `ai-registry` 的模型选择边界。业务 route、worker 和 operation 只声明需求与明确模型选择，不能猜测 provider、切换 provider、重建另一条调用链或在失败时静默降级。

外部异步任务的创建、external id、轮询、终态、错误分类和重试必须是完整协议。Provider 返回失败、未知状态或不支持的能力时必须如实 surface，不能伪造完成、跳过或换模型继续执行。

## 不变量

- **PG-01 — 显式选择。** provider 与 model 必须由统一 registry/selection 解析；禁止按模型名、媒体类型或可用性猜测 provider。
- **PG-02 — 单一网关。** route、worker 和业务 operation 不得直连 provider SDK、旧入口或 generator factory；调用必须经由 `ai-exec` 与 provider adapter。
- **PG-03 — Provider 隔离。** provider 专属模型常量、option 和条件分支只能留在自身 `ai-providers/<provider>/` 实现内；跨 provider 分支属于 registry/engine 的职责。
- **PG-04 — 异步协议完整。** external id、轮询状态、成功结果、失败原因和 `retryable | permanent` 终态分类必须由共享 discriminated union 与唯一 normalizer 明确归一化；`failed` 缺少 disposition、非失败状态携带 disposition、未知 provider 状态或失败状态被映射为完成都必须原地失败。网络/查询异常直接抛出并恢复同一 external id，不得伪装成 provider 终态。
- **PG-05 — 零隐式降级。** 不支持的模型、能力、输出或 provider 故障必须显式失败。任何 fallback、默认模型或跨 provider 替换都必须被拒绝，而非悄悄继续。
- **PG-06 — 提交与查询重试分离。** 媒体、LLM 与 vision POST 每个逻辑 invocation 在同一 DB Task attempt 只能发送一次，调用必须先经过 durable provider fence。明确未受理、结构化结果不可用或 external job 明确终态失败时，fence 才允许更高 attempt 原子重取该 invocation 的一次新提交权；成功的兄弟 invocation 继续重放。断连、超时、无类型 `success:false` 或无法证明是否受理的响应必须进入 `outcome_unknown`，禁止自动重提。获得 external id 后的 poll、结果下载和存储读取可以按各自策略重试，但 pending job 只能恢复；只有明确终态失败才能重建 provider job。本地持久化失败重放 provider 结果与稳定 artifact key，不重新生成。
- **PG-07 — LLM stream 与最终 completion 同源。** provider adapter 必须把 SDK stream delta 与 `finalChatCompletion()` 归一为同一次 completion。若 final text 是已发正文的严格前缀扩展，adapter 必须在 `onComplete` 前补发尚未发出的 suffix；若此前没有正文 delta，则补发完整 final text。final text 与已发正文分叉时不得拼接、猜测或重发整份内容，正式 completion 仍按 provider 返回值显式结算。该归一化只是同一 provider 响应的传输完整性，不得变成非流式重试、跨 provider fallback 或第二次模型调用。

## 权威入口

- Provider adapter、媒体/LLM 实现与异步注册：`src/lib/ai-providers/`。
- 执行引擎、结果归一化与异步轮询：`src/lib/ai-exec/engine.ts`、`src/lib/ai-exec/async-poll.ts`、`src/lib/ai-exec/async-wait.ts`；FAL image/video/music 共用标准 external id 与这一等待入口，provider adapter 不在提交函数内隐藏第二套轮询循环。
- Task 媒体/LLM/vision 提交围栏与结果重放：`src/lib/task/provider-invocation.ts`；稳定产物身份：`src/lib/task/artifact-storage.ts`。
- 模型目录、价格、能力和运行时选择：`src/lib/ai-registry/`。
- 用户 provider 配置的严格解析：`src/lib/user-api/runtime-config.ts`。
- `standards/capabilities/**` 与 `standards/pricing/**` 当前分别由 catalog 检查脚本读取，不是生产 runtime registry 的 writer；运行时仍从 `src/lib/ai-providers/*/models.ts` 经 builtin catalog 注册。修改 standards 必须审计相应 runtime catalog，不能把校验通过解释为生产能力或价格已切换。

## 验证

- `tests/integration/provider/fal-*.contract.test.ts` 使用本地协议服务器验证真实 FAL adapter 的提交、轮询、FAILED/unknown/malformed/无媒体结果、422/500 和零隐式 retry。
- `tests/integration/provider/provider-gateway-{capabilities,connections}.contract.test.ts` 与 `message-content.contract.test.ts` 验证生产 registry capability、connection 和消息协议。
- `tests/integration/provider/source-script-scene-stream.contract.test.ts` 验证 scene-level streaming 协议；`tests/integration/task/provider-invocation-at-most-once.integration.test.ts` 使用真实 MySQL 验证并发首次提交唯一、成功兄弟重放、失败 invocation/external job 仅由更高 attempt 重取，以及 `outcome_unknown` 与永久拒绝零重提。
- `tests/unit/task/async-poll-external-id.test.ts` 只验证纯 external identity 解析。
- provider guards 只阻止 API/媒体绕过、跨 provider 猜测和 fallback 等结构旁路，不替代协议或用户旅程证据。
- `npm run check:capability-catalog` 与 `npm run check:pricing-catalog` 验证 standards 文件自身及 tier/capability 字段关系；它们不证明 standards 与运行时代码 catalog 值一致。
## 历史回归

- `ccdd10be6` 修复 FAL 异步失败未被 surface 的问题：provider 的失败终态必须进入统一任务失败边界，不能留在 polling 中静默消失。
- `9207d119` 修复视频生成的项目模型 fallback：模型不可用应显式失败，不得改用另一个模型或 provider。
- `95254ae71` 收敛 AI 与 Task 重试，说明 provider 的错误分类不能由多个调用层各自猜测。
- 真实 worker retry Journey 曾发现所有 `FetchStatusError` 被 durable fence 统一解释为永久拒绝，导致 Task retry 形同虚设；提交结果分类必须由 fence 一次性写入，BullMQ 只调度其允许的下一 attempt。
- 结构化 LLM 输出校验曾发生在 provider checkpoint 已写 `submitted` 之后；队列虽进入更高 attempt，网关仍永久重放旧结果。逻辑 invocation 必须由结果消费者显式写回“该结果不可用”，但重新提交资格仍只由 provider fence 的 attempt CAS 裁决，不能由业务调用方另开请求入口。
- OpenRouter SDK 可在 `finalChatCompletion()` 才暴露此前 delta 未完整携带的正文；旧 adapter 用该正文完成正式持久化，却没有补给同一次 stream callback，造成 Task 成功而 Canvas 没有 structured preview。现只补发 final text 相对已发正文的确定 suffix；分叉内容不做隐式拼接，也不发起第二次调用。

## 修改检查表

1. provider/model 是否来自统一 selection，而非名称、类型或本地 fallback 推断？
2. 调用是否经过 ai-exec 与 provider adapter，而非 route/worker 直连？
3. 新 provider 专属代码是否只放在自己的 provider 目录？
4. 异步任务的 external id、poll、成功、失败与 retryable 错误是否完整覆盖？
5. 不支持或失败时是否明确报错，而非切换 provider/model 或伪造成功？
