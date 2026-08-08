<!-- architecture-module: failure-governance -->

# 原生失败证据与重放裁决

## 为什么是这样

外部系统和程序异常是开放集合，产品错误码是封闭集合。把未知异常先翻译成产品错误码会永久丢掉
诊断事实，也会让新错误错误地继承某个旧错误码的重试行为。因此失败记录先保存原生证据，产品解释
只用于展示；重放许可由被执行动作的幂等和副作用契约决定。

## 不变量

- **FG-01 — 原生证据是失败事实。** 任意被捕获失败必须形成同一个版本化 FailureRecord，且必含
  脱敏、有界的原生 name、message、code、status、request id、metadata 与 cause。后续边界只能
  追加 context、解释和恢复事实，不得用统一 code 或包装文案覆盖原始证据。
- **FG-02 — 产品解释不裁决重放。** canonical code/details 只承担 i18n、公开状态和用户动作；
  未知异常可以解释为 INTERNAL_ERROR，但不得因此被归为 Provider 永久拒绝。任何自动重放函数的
  输入不得使用产品错误码、category 或 retryable 标志。
- **FG-03 — 操作 registry 是唯一重放裁判。** 任何允许自动重放的外部动作必须选择封闭 operation
  identity；未声明动作默认禁止重放。registry 唯一声明同 attempt 重放次数、幂等语义、失败时副作用
  和 Task 恢复许可。调用方不得传 retry 次数或自定义 shouldRetry。Provider 提交受理结果未知时始终
  禁止重提；同 key 同内容对象写可安全重放。复合动作的内层失败若声明更严格的 operation（例如下载
  过程中发现不安全重定向），外层不得放宽其重放权限。
- **FG-04 — 投影不建立第二事实。** Task/Turn 仍是持久失败 owner；Temporal、checkpoint、API、
  Workspace 与 Assistant 只传递或投影同一 FailureRecord。Assistant 获得脱敏原生诊断、阶段、操作、
  副作用和尝试次数；公开 UI 仍只获得公开字段。
- **FG-05 — 绕过必须机器失败。** 类型要求每个 retry/fetch 调用选择 operation；CI conformance 穷尽
  registry 并拒绝旧 failure class、caller policy、storage allowlist、v1 codec 及 Provider code
  授权重放。文档或 review 提醒不算边界。

## 权威入口

- 失败证据、解释和投影：`src/lib/errors/**`
- 操作 identity 与重放契约：`src/lib/external-operation/registry.ts`
- 统一执行重放：`src/lib/retry/**`
- 对象存储 adapter：`src/lib/storage/**`
- CI 守卫：`scripts/check-failure-governance.ts`

## 踩过的坑

- FailureRecord v1 虽统一了 Task、Temporal 与 Assistant 的传输，却把 code/message 当事实；COS 返回
  未知 `UserNetworkTooSlow` 时先坍缩为 INTERNAL_ERROR，再被 code retryability 判成不可重试，模型
  也只看到空洞错误 → 传输统一不等于证据完整，v2 强制原生证据并让重放函数不接收错误码。
- 为 COS 增加错误名和 HTTP 状态白名单只修复了一个已知实例；开放世界的下一个错误仍会落空 →
  对象写是否可重放取决于同 key/同 payload 的动作契约，白名单整体删除。
