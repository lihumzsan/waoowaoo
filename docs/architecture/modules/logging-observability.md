<!-- architecture-module: logging-observability -->

# 日志与可观测性

## 设计理念

日志是运行观测事实的单一结构化流，不是第二份业务数据库。所有进程（Next.js、worker、独立脚本）把 JSON LogEvent 写到 stdout，这是唯一权威输出流；采集、检索和告警都以 stdout 为准。`logs/app.log` 只是自托管管理员下载用的便利副本，不承担正确性。日志记录 identity（ID）、摘要与耗时，业务原文的唯一权威在数据库；从日志内容反推业务状态属于架构违规。

## 不变量

- **LG-01 — stdout JSON 是权威日志流。** 所有服务端日志经 `src/lib/logging/core.ts` 的唯一 `write` 出口序列化为单行 JSON 写 stdout（ERROR 走 stderr）。`logs/app.log` 由 `file-writer.ts` 追加，仅为自托管便利副本：全局单文件、超 50MB 时原子 rename 轮转为 `app.log.1`、fire-and-forget、失败不影响应用；禁止恢复 per-project 或 per-task 分文件写入。
- **LG-02 — LogEvent 字段契约唯一。** 事件结构由 `src/lib/logging/types.ts` 的 `LogEvent` 定义：`ts`（UTC+8 ISO）、`level`、`service`、`audit`、`module`、`action`、`message`、关联 identity（`requestId`/`taskId`/`taskAttempt`/`threadId`/`turnId`/`operationId`/`projectId`/`userId`/`provider`）、失败语义（`errorCode`/`retryable`/`failureClass`）、`durationMs`、`details`、`error`。新增关联维度必须扩展该契约，禁止把 identity 埋进 `details` 或 `message` 字符串。
- **LG-03 — 只记 ID、摘要与耗时。** 日志不得记录业务原文（prompt 全文、模型 raw output、剧本/章节内容、用户上传内容）；这些事实的唯一权威在数据库。敏感键由 `redact.ts` 按 `LOG_REDACT_KEYS` 在唯一出口统一脱敏。
- **LG-04 — audit 通道语义。** `audit: true` 事件绕过级别过滤（仅受 `LOG_AUDIT_ENABLED` 控制），保留给必须可追溯的用户操作、账本与认证审计（`logAuthAction`/`logProjectAction`）。审计事件必须携带顶层 `userId`（可得时），不得把 userId 埋进 `details`。
- **LG-05 — `alert.*` action 命名空间保留。** 需要外部告警路由（如接入监控/on-call）的事件使用 `alert.` 前缀 action；普通事件不得占用该前缀，告警筛选只按 action 命名空间，不按 message 文本匹配。
- **LG-06 — no-console 由 ESLint 唯一裁决。** `eslint.config.mjs` 对 `src/**` 强制 `no-console: error`；唯一豁免为 `src/lib/logging/core.ts`、`src/lib/logging/file-writer.ts`（权威流最终写出点）、`src/lib/storage/init.ts`（logger 就绪前的独立 bootstrap 进程）与 `scripts/**`。禁止另建自研 console 扫描脚本。
- **LG-07 — 语义 action 由所属生命周期契约拥有。** 关键 action 必须与其唯一生命周期 owner 同步演进；禁止以源码字符串或文件存在性脚本冒充运行协议 oracle。
- **LG-08 — 用户 reference 与内部 cause 分离。** API错误响应和用户可见终态携带可公开的
  requestId/taskId/turnId，供用户报障；原始 cause、Provider detail与stack只进入服务端日志或
  既有持久诊断字段。客户端未知异常经 `/api/client-log` 上报同一 reference，不得为了可观测
  性把内部 message复制回 toast、模型历史或公开 response。

## 权威入口

- 事件构造与唯一写出：`src/lib/logging/core.ts`（`createScopedLogger`、`logDebug/Info/Warn/Error`，内部唯一 `write`）。
- 执行上下文传播：`src/lib/logging/context.ts`（`withLogContext`/`setLogContext`/`getLogContext`，AsyncLocalStorage）。
- 语义封装：`src/lib/logging/semantic.ts`（`logAuthAction(action, message, details?, userId?, username?)`、`logProjectAction`、`logInternal`）。
- 配置：`src/lib/logging/config.ts`（`LOG_LEVEL` 默认 `INFO`、`LOG_DEBUG_ENABLED`、`LOG_AUDIT_ENABLED`、`LOG_REDACT_KEYS`、`LOG_SERVICE`）。
- 脱敏：`src/lib/logging/redact.ts`。
- 便利副本与管理员下载：`src/lib/logging/file-writer.ts`（写入与 `readAllLogs`，下载 route 需管理员授权）。
- 浏览器未知异常上报：`src/lib/client-reporter.ts` 与 `/api/client-log`；只承担诊断，不拥有
  UI状态或业务终态。
- 服务启动挂载：`src/instrumentation.ts` 只做 runtime 分流；Node-only process observer 位于 `src/instrumentation-node.ts`，避免把 Node API 编进 Edge instrumentation bundle。
- 守卫：`eslint.config.mjs`（no-console）与结构化 logger 共享类型。

## 状态所有权

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| LogEvent 结构与序列化 | `core.ts` 唯一 `write` 出口 | stdout 采集、`file-writer` |
| 执行上下文（requestId/taskId/attempt/threadId/turnId 等） | `context.ts` AsyncLocalStorage | `core.ts` 合并进事件；（架构债）billing 幂等与 provider fence |
| 级别/审计/脱敏配置 | `config.ts`（环境变量解析一次） | `core.ts`、`redact.ts` |
| `logs/app.log` 便利副本 | `file-writer.ts`（全局单文件 + rename 轮转） | 自托管管理员下载 |
| 业务原文（prompt、raw output、创作内容） | 数据库（各模块 persistence） | 不进入日志 |

## 验证

- `npm run lint:all`：no-console 全 `src/**` 强制与豁免面。
- `npm run typecheck`：LogEvent/SemanticContext 契约。
- 生产 stdout 采集与 `logs/app.log` 轮转行为属于真实部署复验边界，无自动化测试（不满足测试准入）。

## 历史回归

- 日志级别默认曾为 `ERROR`，生产环境正常路径事件全部被过滤，观测归零；事故排查时无 INFO 轨迹可用。当前默认 `INFO`（`config.ts` 解析失败也回落 `INFO`），DEBUG 需显式开启，审计事件独立于级别（LG-04）。
- LLM 调用曾把 `llm.raw` 模型输出全文写入日志文件，日志膨胀且把业务原文复制成第二事实源。当前防线：LG-03 只记 ID/摘要/耗时，raw 输出的唯一权威在数据库；`worker.progress.stream` 等高频流事件在 core 内显式抑制。
- 文件日志曾按 per-project 分文件，多进程（Next.js + worker）read-modify-write 同一文件产生竞态丢行。当前防线：全局单文件 append + 原子 rename 轮转（LG-01），文件仅为便利副本，正确性由 stdout 承担。
- `logAuthAction` 曾长期被 25 处调用系统性错位传参（用户名当 message、userId 埋进 details），顶层 `userId` 恒空导致审计日志无法按 userId 检索。当前调用方已统一为 `(action, 语义 message, 结构化 details, userId, username)`；位置参数签名仍是误用温床，扩展字段时优先考虑改为结构化入参。
- 自研 `check-no-console.ts` 未接 CI、allowlist 过时，且 `rg` 缺失时静默通过（守卫本身静默降级）。当前由 ESLint `no-console` 承担（LG-06）。后续源码字符串存在性脚本也因没有独立 oracle 被删除；语义由所属生命周期契约与真实消费方验证。
- **待办 / 架构债（勿误改）：** `getLogContext()` 的执行上下文目前被业务正确性复用——billing 幂等判定（`src/lib/billing/service.ts:504` 等以 `getLogContext().taskId` 区分 task 通道）与 provider at-most-once fence（`src/lib/task/provider-invocation.ts:316`、`src/lib/ai-exec/engine.ts:267`）。日志上下文丢失将直接改变计费与重提交行为，这超出了"观测"职责。待拆分为独立 execution-context 模块后，日志 context 才能回归纯观测语义;在拆分前不得以"日志无关正确性"为由重构 `context.ts` 的传播行为。

## 修改检查表

1. 新日志是否经 `core.ts`/`semantic.ts` 唯一入口，而不是新建 console 或第二 writer？
2. 新增关联维度是否进入 `LogEvent` 契约顶层字段，而不是埋进 `details`/`message`？
3. 是否只记 ID/摘要/耗时，没有把业务原文复制进日志？
4. 审计事件是否使用 `audit: true` 并携带顶层 `userId`？
5. 需要外部告警的事件是否使用 `alert.*` action 命名空间？
6. 重命名/删除关键 action 时是否同步所属生命周期模块与真实观测消费方？
7. 改动 `context.ts` 前是否确认了 billing 幂等与 provider fence 对 log context 的正确性依赖（见历史回归待办）？
