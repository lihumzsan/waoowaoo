<!-- architecture-module: provider-gateway -->

# Provider Gateway

## 设计理念

Provider 差异只能停留在 `ai-providers` 的 provider 实现、`ai-exec` 的统一执行/轮询边界和 `ai-registry` 的模型选择边界。业务 route、worker 和 operation 只声明需求与明确模型选择，不能猜测 provider、切换 provider、重建另一条调用链或在失败时静默降级。

外部异步任务的创建、external id、轮询、终态、错误分类和重试必须是完整协议。Provider 返回失败、未知状态或不支持的能力时必须如实 surface，不能伪造完成、跳过或换模型继续执行。

## 不变量

- **PG-01 — 显式选择。** provider 与 model 必须由统一 registry/selection 解析；禁止按模型名、媒体类型或可用性猜测 provider。
- **PG-02 — 单一网关。** route、worker 和业务 operation 不得直连 provider SDK、旧入口或 generator factory；调用必须经由 `ai-exec` 与 provider adapter。
- **PG-03 — Provider 隔离。** provider 专属模型常量、option 和条件分支只能留在自身 `ai-providers/<provider>/` 实现内；跨 provider 分支属于 registry/engine 的职责。
- **PG-04 — 异步协议完整。** external id、轮询状态、成功结果、失败原因和可重试性必须被明确归一化；未知或失败状态不得被映射为完成。
- **PG-05 — 零隐式降级。** 不支持的模型、能力、输出或 provider 故障必须显式失败。任何 fallback、默认模型或跨 provider 替换都必须被拒绝，而非悄悄继续。

## 权威入口

- Provider adapter、媒体/LLM 实现与异步注册：`src/lib/ai-providers/`。
- 执行引擎、结果归一化与异步轮询：`src/lib/ai-exec/engine.ts`、`src/lib/ai-exec/async-poll.ts`。
- 模型目录、价格、能力和运行时选择：`src/lib/ai-registry/`。
- 用户 provider 配置的严格解析：`src/lib/user-api/runtime-config.ts`。

## 验证

- `tests/integration/provider/fal-provider.contract.test.ts`、`fal-queue-result-errors.contract.test.ts`、`fal-video-*.contract.test.ts` 和 `elevenlabs-sound-effect-provider.contract.test.ts` 验证真实 provider 协议；FAL queue 的 malformed、FAILED、422、500 与 unknown 状态必须显式分类，不得进入 fallback。
- `tests/unit/task/async-poll-external-id.test.ts` 验证异步 external id 与轮询语义。
- `tests/unit/guards/no-provider-model-fallback.test.ts` 与 `no-cross-provider-model-data.test.ts` 验证零降级和物理隔离。
- `scripts/guards/no-provider-model-fallback.mjs`、`no-cross-provider-switch.mjs`、`no-cross-provider-model-data.mjs`、`no-provider-guessing.mjs` 和 `no-legacy-ai-entry-imports.mjs` 阻止散落的 provider 语义。
- `scripts/guards/no-api-direct-llm-call.mjs` 与 `no-media-provider-bypass.mjs` 阻止 API/媒体调用绕过网关。

## 历史回归

- `ccdd10be6` 修复 FAL 异步失败未被 surface 的问题：provider 的失败终态必须进入统一任务失败边界，不能留在 polling 中静默消失。
- `9207d119` 修复视频生成的项目模型 fallback：模型不可用应显式失败，不得改用另一个模型或 provider。
- `95254ae71` 收敛 AI 与 Task 重试，说明 provider 的错误分类不能由多个调用层各自猜测。

## 修改检查表

1. provider/model 是否来自统一 selection，而非名称、类型或本地 fallback 推断？
2. 调用是否经过 ai-exec 与 provider adapter，而非 route/worker 直连？
3. 新 provider 专属代码是否只放在自己的 provider 目录？
4. 异步任务的 external id、poll、成功、失败与 retryable 错误是否完整覆盖？
5. 不支持或失败时是否明确报错，而非切换 provider/model 或伪造成功？
