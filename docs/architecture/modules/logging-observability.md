<!-- architecture-module: logging-observability -->

# 日志与可观测性

## 为什么是这样

日志是运行观测事实的单一结构化流，不是第二份业务数据库。所有进程把 JSON 事件写到 stdout，这是
唯一权威输出流；采集、检索和告警都以它为准。落盘文件只是自托管管理员下载用的便利副本，不承担
正确性。

日志只记 identity、摘要与耗时。业务原文的唯一权威在数据库——从日志内容反推业务状态属于架构违规。

## 不变量

- **LG-01 — stdout JSON 是权威日志流。** 所有服务端日志经唯一 write 出口序列化为单行 JSON。
  落盘副本全局单文件、超阈值原子 rename 轮转、fire-and-forget、失败不影响应用；禁止恢复
  per-project 或 per-task 分文件写入。
- **LG-02 — 事件字段契约唯一。** 结构由共享 `LogEvent` 类型定义：时间、级别、service、audit、
  module、action、message、关联 identity、失败语义、耗时、details、error。新增关联维度必须扩展
  该契约，禁止把 identity 埋进 details 或 message 字符串。
- **LG-03 — 只记 ID、摘要与耗时。** 不得记录业务原文（Prompt 全文、模型 raw output、创作内容、
  用户上传内容）。敏感键在唯一出口统一脱敏。
- **LG-04 — audit 通道语义。** 审计事件绕过级别过滤，保留给必须可追溯的用户操作、账本与认证审计，
  且必须携带顶层 userId（可得时）。
- **LG-05 — `alert.*` action 命名空间保留。** 需要外部告警路由的事件使用该前缀；告警筛选只按
  action 命名空间，不按 message 文本匹配。
- **LG-06 — no-console 由 ESLint 唯一裁决。** 豁免仅限权威流的最终写出点与 logger 就绪前的独立
  bootstrap 进程。禁止另建自研 console 扫描脚本。
- **LG-07 — 语义 action 由所属生命周期契约拥有。** 关键 action 必须与其唯一生命周期 owner 同步
  演进；禁止用源码字符串或文件存在性脚本冒充运行协议 oracle。
- **LG-08 — 用户、Assistant 与内部投影分离。** 公开 UI 只携带可公开的 request/task/turn identity
  与本地化字段；原始 cause、Provider detail 与 stack 只进服务端日志或持久失败事实。Assistant 可
  获得同一 FailureRecord 的脱敏原生 name/message/code/status/request id 与阶段，不得获得 secret、
  stack、业务原文或未脱敏 metadata。

## 权威入口

- 事件构造与唯一写出、上下文传播、语义封装、配置与脱敏：`src/lib/logging/**`
- 浏览器未知异常上报：`src/lib/errors/client-reporter.ts` 与 `/api/client-log`（只承担诊断）
- 守卫：`eslint.config.mjs` 的 no-console

## 已知架构债（勿误改）

`getLogContext()` 的执行上下文目前被业务正确性复用：计费幂等判定与 provider at-most-once fence
都从中读取 taskId。日志上下文丢失会直接改变计费与重提交行为，这超出了"观测"职责。在拆分出独立
execution-context 模块之前，不得以"日志与正确性无关"为由重构上下文传播行为。

## 踩过的坑

- 日志级别默认曾为 ERROR，生产环境正常路径事件全部被过滤，观测归零 → 默认改为 INFO，解析失败也
  回落 INFO，审计事件独立于级别。
- LLM 调用曾把模型输出全文写入日志 → 把业务原文复制成第二事实源 → 只记 ID/摘要/耗时（LG-03）。
- 文件日志曾按 project 分文件，多进程 read-modify-write 同一文件产生竞态丢行 → 全局单文件 append
  + 原子 rename 轮转（LG-01）。
- 认证审计封装长期被 25 处调用系统性错位传参（用户名当 message、userId 埋进 details），顶层
  userId 恒空导致无法按用户检索 → 位置参数签名是误用温床，扩展字段时优先改为结构化入参。
- 自研的 console 扫描脚本未接 CI、allowlist 过时，且依赖的命令缺失时静默通过 → 守卫本身静默降级
  → 改由 ESLint 承担（LG-06）。后续所有"源码字符串存在性"脚本也因没有独立 oracle 一并删除。
- 共享 poll 入口曾对每次查询写一条 INFO，Worker 又对同一 pending 写进度 INFO，并行任务每数秒
  产生交错日志 → 例行查询不是业务事实 → pending 只记 DEBUG，阶段变化才 INFO。该契约随后在另一
  provider 的状态查询处换形式复发过一次。
