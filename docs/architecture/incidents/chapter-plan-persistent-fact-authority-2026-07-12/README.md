# 核心剪辑计划持久事实权威收敛（2026-07-12）

## 任务分类

本次为 D 类 Architecture Incident。真实 `plan_chapters` 批次中，第一章模型输出把章节事件台账里的两个持久事实改写后写入 `persistentFactsIntroduced`；字符重合率校验拒绝了这两个同源改写。Task 随后进入三次 worker attempt，但 durable provider invocation 只提交了一次模型请求，后两次重放同一结果并再次失败。

## 目标与非目标

目标：

- 章节 ledger events 是章节持久事实的唯一 owner 与唯一 writer。
- 核心剪辑计划模型只组织 shots 与 generationSegments，不再生成、改写或选择持久事实。
- provenance 中的 `persistentFactsIntroduced` 由服务端从当前章节 events 确定性投影。
- 删除字符包含、字符 token 重合率等语义启发式，不再让启发式承担事实 identity。

非目标：

- 不修改 Assistant Task follow-up 的自动下一步、章节名称解释或 Run 失败卡。
- 不改变 provider at-most-once 提交协议。
- 不以本次变更重新定义所有 LLM Task 的通用 retry 策略；本事故只记录真实 attempt 与 provider invocation 的差异。
- 不修改既有章节 ledger、剧本切分、镜头内容或用户数据，不执行 migration/backfill。

禁止范围：

- 不允许根据自然语言相似度把模型文本升级为持久事实。
- 不允许在 prompt、validator 与 persistence 分别维护三份事实解释逻辑。
- 不允许把 Task.attempt 当作新的 provider invocation identity，绕过 durable provider fence。

并行边界：本阶段只拥有 chapter plan 模型输出契约、ledger facts projector、相关模块文档与适用验证；不触碰当前工作区其他 Golden Journey/Canvas 改动。

## 入口枚举

| 入口 | 当前职责 | 收敛后职责 |
| --- | --- | --- |
| `plan_chapters` / `generate_edit_script` / `replan_chapter` | 提交 `edit_script_generate` Task | 不变 |
| `handleEditScriptGenerateTask` | 调用章节计划 service | 不变 |
| `generateProjectEditScript` | 组 prompt、解析模型事实、语义校验、持久化 | 只解析镜头结构；从 ledger 投影 provenance facts |
| structure prompt/schema | 要求模型输出 `persistentFactsIntroduced` 字符串 | 明确禁止该字段，只输出 shots 与 generationSegments |
| `validateChapterPlan` | 以字符包含和 0.8 token overlap 猜测事实等价 | 删除；不再是事实裁判 |
| Task retry / provider invocation | output validation 可调度更高 worker attempt；成功 provider 结果按 invocation identity 重放 | 协议不变；不得声称更高 worker attempt 等于重新生成 |
| Canvas / Assistant / debug | 消费 Task、EditScript、provenance 投影 | 不新增事实解释权 |

## 状态与所有权

| 事实 | canonical identity / scope | 唯一 owner / writer | 消费者 |
| --- | --- | --- | --- |
| 章节入章事实 | episode + chapter + ledger snapshot fact string | Edit Bible ledger projector | chapter planner prompt |
| 本章新增持久事实 | episode + chapter + eventId + event persistentFacts 顺序 | Edit Bible ledger events | provenance projector、后续章节 snapshot |
| 核心剪辑镜头结构 | chapterId + generationTaskId | EditScript generation service | asset、shot、storyboard pipeline |
| provenance facts | chapterId + planVersion，值为当前 events 的确定性投影 | chapter facts projector | debug/audit |
| Task attempt | taskId + DB attempt | Task service | worker fence、日志、retry policy |
| provider invocation | taskId + execution fingerprint + invocation key + request hash | durable provider invocation fence | ai-exec、worker replay |

模型不再拥有持久事实写权；它只消费 ledger 事实并生成镜头结构。

## 生命周期与时序

- 正常：Task claim → 读取章节 ledger → 模型生成 shots/segments → strict schema 拒绝额外字段 → 服务端投影 event facts → owner-fenced persistence → handler checkpoint → Task completed。
- 模型输出旧字段：strict schema 显式失败，不静默删除；提示词同时声明禁止字段。
- 失败：parse/schema/镜头结构错误仍按既有错误分类与 Task terminal 协议处理。
- 重试：更高 worker attempt 可重放已持久化 provider 结果；本次不把 replay 描述为新模型生成。
- 取消、超时、重复、晚到、刷新、断线、并发：不改变 Task、provider invocation、target ownership 或 SSE 协议。
- 部分成功：批次仍由 Wait 聚合各 chapter Task 终态；本阶段不改变 Assistant 解释。

## 事务、幂等与崩溃

- ledger facts projector 是纯函数，无独立写入；事实随 EditScript 成功事务写入 provenance。
- `generationTaskId` 继续作为 EditScript 成功写入 fence。
- provider request 仍由 durable invocation checkpoint 保证每个 invocation at-most-once。
- 崩溃发生在正式资源成功写入后时，既有完成资源重放路径继续返回正式 EditScript，不重新生成事实。

## 删除项与计数

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 持久事实内容 writer | 2（ledger、模型输出） | 1（ledger） |
| 持久事实解释者 | 2（ledger exact、字符相似度 validator） | 1（ledger projector） |
| 章节计划执行入口 | 1 | 1 |
| provider invocation 入口 | 1 | 1 |
| 事实 fallback/heuristic | 2（substring、token overlap） | 0 |

删除：模型输出字段、动态/静态 schema 字段、normalize 透传、`plan-validator.ts` 语义比较器及其调用。

## 验证计划与准入

- Logic Specification：章节 event facts projector 必须按事件顺序去重并只投影 events，不接受 entry snapshot 或模型文本。权威 oracle 是 ledger ownership；会拒绝“模型改写事实仍进入 provenance”和“把入章事实误算为本章 introduced facts”。生产入口是 `generateProjectEditScript` 的持久化路径。命令：定向 Vitest。
- 现有 Golden provider fixture 移除已废弃字段，证明生产 schema 与协议替身一致。用户 observable 不变，因此不扩展 Golden scenario contract；运行现有核心剪辑规划所覆盖的 canonical 场景若环境可用。
- 结构检查：`npm run check:architecture`。
- 类型与 prompt registry：定向 prompt 检查、`npm run typecheck`。

## 未验证盲区

- 本阶段不证明所有 LLM Task 的 output-validation retry 都会产生新 provider invocation；TL-13 明确禁止把 DB Task attempt 自身当作新 invocation identity。
- 不验证 Assistant 对失败 chapter 标题的解释或通用 Run 失败卡；已由用户划出本阶段。
- 若 Golden 环境或付费模型不可用，只报告未验证，不宣称真实组合通过。

## 实际验证结果

- `npx vitest run tests/unit/edit-chapter/persistent-facts.test.ts tests/golden-journey/self-tests/model-provider.test.ts`：22 passed，0 failed，0 skipped/todo。
- `npm run test:logic`：92 files、415 tests passed，0 failed，0 skipped/todo。
- `npm run test:golden:self`：7 files、34 tests passed；34 scenarios 挂载与测试服务隔离检查通过，0 failed，0 skipped/todo。
- `npm run test:golden:variant:structured-preview`：2 Playwright scenarios passed，0 failed，0 skipped/todo。用户 observable 不变，因此 scenario contract 不适用修改；原 canonical scenario 仍通过。
- `npm run typecheck`：passed。
- `npm run check:architecture`：passed，包含 Prompt i18n/semantic、provider at-most-once 与新增 chapter fact authority guard。
- 未运行付费真实模型；本次 Golden 使用仓库受控 provider 协议替身。真实模型对新 strict schema 的服从程度仍是未验证盲区，但模型已无持久事实写权。
