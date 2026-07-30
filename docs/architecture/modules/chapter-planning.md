<!-- architecture-module: chapter-planning -->

# Chapter、Story Canon 与并行创作单元

## 设计理念

Chapter 是可选、可版本化的创作上下文单元，不是工作流阶段。只有当一个作品确实需要至少两个相对独立的生产单元，或者用户明确要求分 Chapter 时，Primary 才委派一次 `chapter_continuity_plan`。

跨 Chapter 一致性只有一个专业输出：同一个 Resource 同时保存 Story Canon 与全部 Chapter 边界。Story Canon 是共享稳定事实的唯一权威；Chapter Context 是服务端从该 Canon、精确剧本范围和 Chapter 投影派生的局部输入，不是第二份 Canon。系统不存在通用 `continuity_analysis` 或成片审计能力。

## 不变量

- **CP-01 — Chapter 可选且至少为二。** 单一连续上下文不创建 Chapter、Story Canon 或连续性分析。只有 Primary 判断至少两个 Chapter 有并行、恢复或上下文价值，或者用户明确要求分 Chapter时，才委派 `creative_work(outputKind=chapter_continuity_plan)`；strict 输出 `chapters` 至少两项。
- **CP-02 — 没有时长状态机。** 服务端不按 `<=15`、`15–180`、`>180` 自动选择流程、Operation 或 Worker。总时长超过 180 秒只是 Primary 的规划信号；已经决定分 Chapter 后，每章 `targetDurationSec` 不得超过 180 秒。
- **CP-03 — 精确 screenplay Resource 是唯一来源。** 计划必须精确引用一个 `project.screenplay` Resource，服务端回库读取真实内容并验证 Lineage。该 Resource 可以来自 Creative Worker，也可以是 `create_text` 精确捕获的用户完整剧本；不存在 confirmed screenplay、最近剧本或正式副本。
- **CP-04 — Canon 与 Chapters 同源同版本。** `chapter_continuity_plan` 的一个 Resource 同时包含 Story Canon、Beat/Ledger 和全部 Chapter 范围。`adopt_chapter_continuity_plan` 在一个 Episode 锁和一个事务内采用 Canon并创建或替换全部 Chapter；二者绑定相同 Resource ID 和 plan version，任一步失败全部回滚。
- **CP-05 — 一个专业 Skill。** output registry 把 `chapter_continuity_plan` 唯一映射到 `chapter-continuity-planning`。Worker 只加载 `creative-core + chapter-continuity-planning`，不得读取 `story-development`、已删除的 `continuity-memory` 或其他专业 Skill。
- **CP-06 — Chapter Context 纯派生。** Context Compiler 从同一个 adopted plan Resource、精确 screenplay 范围、持久 Chapter 和显式资产 Resource 为每章构造局部输入。入口状态、范围内事件、出口变化和相关 Canon 实体从共享 Ledger 派生，不在 Chapter 再写一份竞争事实。
- **CP-07 — 不审片、不写执行 Prompt。** `chapter_continuity_plan` 不设计镜头、Video Prompt、图片、音频或下游 Task，也不能审看成片或声称完成媒体连续性检查。局部视频执行约束只属于 `video_prompt_set`。
- **CP-08 — 并行不产生 WorkerGroup。** `delegation.source=chapters` 为每个持久 Chapter 创建一个独立 Creative Task，聚合只复用 OperationBatch/Wait；没有 WorkerGroup 表、跨 Task 共享可变内存或第二恢复协议。
- **CP-09 — 精确 identity 与原子替换。** 同一 Plan Resource 重复采用返回原 Chapter IDs；采用不同 Resource 时原子删除旧 Chapter 投影并创建新 IDs。`chapterIndex` 只在同一计划内部排序。
- **CP-10 — UI 只显示真实事实。** Canvas 可以显示持久 Chapter、Resource、Task 与 Lineage，但不得投影“当前阶段”“全局连续性已验证”或成片审计结论。

## 状态所有权

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| 剧本文本 | `project.screenplay` Resource | Primary、Chapter continuity Worker |
| Story Canon + Chapter 边界 | `project.chapter_continuity_plan` Resource / Creative Task terminal materializer | 原子采用 Operation |
| 当前 Canon 投影 + Chapter identities | `adopt_chapter_continuity_plan` 单事务 | Primary、Context Compiler、Canvas |
| 单章入口、事件、出口与相关 Canon | Chapter Context Compiler 纯派生 | 每 Chapter Creative Worker |
| 每章专业结果 | 独立 `creative_work` Task/Resource | Primary、显式下游 Operation |
| 并行聚合与恢复 | OperationBatch + collecting Wait | Assistant continuation |

## 权威入口

- 专业输出与 Skill：`src/lib/creative-worker/output-registry.ts`、`src/lib/creative-skills/skills/chapter-continuity-planning/SKILL.md`。
- 严格 Schema：`src/lib/story-canon/schemas.ts`。
- 唯一采用入口：`adopt_chapter_continuity_plan`、`src/lib/story-canon/service.ts`。
- Chapter Context：`src/lib/creative-worker/context-compiler.ts`、`src/lib/edit-chapter/creative-context-service.ts`。
- 并行与恢复：既有 OperationBatch、Wait 与 Task terminal continuation。

## 时序

1. Primary 确认至少两个 Chapter 有实际价值，或用户明确要求。
2. 一次委派以精确 screenplay Resource 生成一个 `chapter_continuity_plan` Resource。
3. `adopt_chapter_continuity_plan` 回库校验 Resource、scope、Lineage、Canon 和 Chapter 范围。
4. 同一事务写 Canon 投影并原子替换全部 Chapter，二者使用同一 Resource/version。
5. 后续按需以精确 Chapter IDs 并行委派局部任务；Context Compiler 从同一计划派生最小上下文。

## 验证

- 生产 Registry conformance 应证明旧 `story_canon`、`chapter_plan`、`continuity_analysis` output kind 和两个旧采用入口不存在，且新 output kind 恰好绑定一个专业 Skill。
- strict Schema 应拒绝少于两个 Chapter、索引不连续、范围重叠和单章超过 180 秒。
- 原子采用的事务、重复采用和替换 identity 需要真实数据库边界验证；模型是否正确选择分章和边界仍需人工产品复验。

## 历史回归

- 旧 Edit-first 把 Story Canon、Chapter 和媒体生产编码成固定阶段；随后虽改为自由 Operation，仍留下三个专业 output kind、两个采用 writer 和一个可被误用为成片审计的 `continuity_analysis`。真实单 Episode 在没有 Chapter 时也生成了“审看十段成片”的连续性报告，而 Worker 实际没有媒体读取能力。
- 第一轮长视频修正只取消 `>180s` 代码分支，却继续让 Story Canon、Chapter Plan 和 continuity analysis 由模型分别决定、分别生成、分别采用，产生中间状态和职责重叠。当前删除三个旧 output kind、两个旧采用入口和 `continuity-memory`，改为一个计划 Resource 与一次原子采用。
- Chapter 曾按 `(episodeId, chapterIndex)` upsert，使新计划复用旧 ID 并漂移叙事 identity。当前同 Plan 重试保留 IDs，不同 Plan 原子 delete+create。
- Chapter 估时曾被直接写成下游视频固定时长，导致规划估计变成交付预算。当前 `targetDurationSec` 只用于规划和每章上限；视频时长仍只由显式 `durationIntent` 裁决。

## 修改检查表

1. 是否只在至少两个 Chapter 或用户明确要求时委派？
2. Canon 与全部 Chapters 是否来自同一个 Resource/version 和同一采用事务？
3. 是否仍存在旧 output kind、旧采用入口、第二 Canon 或成片 continuity analysis？
4. Context Compiler 是否只派生局部事实且 fail closed？
5. 并行是否只复用既有 Task Batch/Wait？
