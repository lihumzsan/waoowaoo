<!-- architecture-module: chapter-planning -->

# Chapter、连续性与并行创作单元

## 设计理念

Chapter 是可选、可版本化的创作上下文单元，不是工作流阶段。它只在一个作品需要多个相对独立的工作单元、并行处理、局部失败恢复或有界上下文时提供价值；单一连续上下文即使很长，也不必被系统强制拆分。

连续性不是“存在多个 Chapter”的同义词。Primary Agent 依据共享 canon、跨单元人物/场景/道具状态、时间顺序、视觉与声音延续、上下文预算和用户目标，决定是否委派 `continuity_analysis`、采用 Story Canon 或建立 Chapters。总时长大于 180 秒只是强规划信号，不是代码分支。

## 不变量

- **CP-01 — Chapter 可选且独立。** Chapter 可以由显式 Operation 从精确剧本 Resource 或用户给出的结构创建、修改和删除；采用 Story Canon 不自动创建 Chapter，创建 Chapter 不自动生成 Story Canon、连续性分析、资产、视频或渲染。
- **CP-02 — 没有时长状态机。** 服务端不得按 `<=15`、`15–180`、`>180` 自动选择流程、Operation 或 Worker。`>180s` 只进入 Primary 的规划提示；最终判断还必须考虑独立工作单元、共享事实、上下文与恢复价值。Primary 已经选择委派 `chapter_plan` 后，`adopt_chapters` 只校验每个已给独立单元不超过 180 秒；它不决定章数或边界。
- **CP-11 — Chapter 估时是规划事实，不是交付预算。** `targetDurationSec` 只服务分章判断、每章 180 秒上限校验与规划展示。它不得被服务端自动转成下游交付时长：按 Chapter 委派 `video_prompt_set` 时，交付时长权威只有调用方显式给出的 `durationIntent`，`mode=fixed` 仅用于承接用户明确说明并正在被分配的总时长，其余情况使用 `mode=derive` 由 Worker 从真实内容推导。Chapter 估时仍随编译上下文作为参考事实提供给 Worker。
- **CP-03 — 精确 screenplay Resource 是来源。** Chapter 必须显式引用一个精确 `screenplay` Resource；resourceId 是唯一跨层身份，服务端回库读取剧本文本。该 Resource 可以来自 `creative_work(outputKind=screenplay)`，也可以是 `create_text.current_user_text + classification.kind=screenplay` 精确捕获的用户完整剧本；Story Canon/Chapter/continuity 不得强迫后一种来源先经过另一个 screenplay Subagent。`ProjectEpisodeSourceDocument` 只是该 Resource 的严格领域投影，不拥有第二份内容解释权。不存在 `confirmed_screenplay`、最近剧本、“正式剧本”副本或 scene/entity registry 前置。
- **CP-04 — Story Canon、连续性分析与 Chapter 分权。** Story Canon 是可采用的全局 canon Resource，continuity analysis 是针对一组精确输入 Resources 的专业结果，Chapter 是执行上下文单元。三者各有唯一 writer，互不自动派生，消费者必须显式传入实际使用的 Resource IDs。
- **CP-05 — 并行不产生 WorkerGroup。** Primary 可对多个 Chapter 调用 `delegate_creative_work({delegation:{source:'chapters'}})`；每个 Chapter 对应一个独立 `creative_work` Task，聚合只复用 OperationBatch/Wait。系统不持久化 WorkerGroup、章节批次状态机或跨 Task 共享可变内存。
- **CP-06 — 最小上下文纯派生。** Context Compiler 只从显式 canonical screenplay/Story Canon/Chapter/asset Resource ID 为一个 Chapter 构造有界输入；缺失、scope 或 schema 不符必须失败。它不读取或投影 Creative Direction，不写事实、不选择 Skill、不创建 Task、不决定执行顺序。后续唯一 Task 输入编译器在 Task 创建时，向每个非方向生产者统一冻结完整已采纳 Direction；这不改变 Chapter context 的事实边界。
- **CP-07 — 连续事实有唯一 owner。** 全局 canon 只由被采用的 Story Canon Resource 解释；一次 continuity analysis 只描述其精确输入的分析结果，不能覆盖 Story Canon。Chapter 局部状态只属于该 Chapter；跨单元冲突由 Primary 重新委派分析或显式采用新 Resource，不能由晚到 Task 覆盖。
- **CP-08 — 媒体执行仍按精确输入。** 视频、资产和音乐 Resource 可以直接从任意合法 Resources 生成，也可以消费 Chapter context；是否使用 Chapter 不改变 Operation eligibility。provider 的单次时长/引用数量约束由 capability registry 在执行前校验，不得反向变成创作工作流。
- **CP-09 — UI 只显示真实事实。** Canvas 可显示持久 Chapter、Resource、Task 与 Lineage，但不得投影“当前阶段”“下一章”“全局连续性已完成”或按时长自动生成节点。连线只来自实际 Resource lineage。
- **CP-10 — Chapter ID 是计划内叙事身份。** 同一 `chapter_plan` Resource 的重复采用必须返回原有 Chapter IDs；采用不同 Resource 时必须在一个 Episode 锁和同一事务内删除旧投影并创建全部新 IDs。`chapterIndex` 只负责新计划内部排序与唯一位置，不能通过 upsert 让旧计划的叙事 identity 漂移到新内容。

## 状态所有权

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| 剧本文本与写作元信息 | `screenplay` Creative Resource / Creative Task terminal materializer | Primary、Story Canon/continuity/Chapter Operations |
| 全局 canon | 被采用的 Story Canon Resource / Story Canon adoption Operation | Context Compiler、Primary、显式下游调用 |
| Chapter identity 与版本 | `adopt_chapters` / Chapter service；同 Plan 幂等、不同 Plan 原子重建 | Primary、Context Compiler、Canvas |
| 连续性分析结果 | `creative_work(outputKind=continuity_analysis)` 终态 Resource | Primary；除非显式采用，不写其他事实 |
| Chapter 专业结果 | 每 Chapter 的独立 `creative_work` Task/Resource | Primary、显式下游 Operation |
| 并行聚合与恢复 | OperationBatch + collecting Wait | Assistant continuation |

## 权威入口

- Chapter 创作判断：`creative_work(outputKind=chapter_plan)` 与相关 Skill；领域投影的显式采用：`adopt_chapters`。
- Creative Worker 输出协议：`src/lib/creative-worker/output-registry.ts`。
- Chapter 最小上下文：`src/lib/creative-worker/context-compiler.ts`、`src/lib/edit-chapter/creative-context-service.ts`。
- Primary 规划规则：`src/lib/ai-prompts/templates/project-agent/system/**`；它只能提供判断标准，不能实现服务端分支。
- 并行与恢复：`src/lib/project-agent/operation-batch.ts`、`waits.ts` 与 Task terminal continuation。

## 验证

- Operation/Task conformance 应证明 Chapter、Story Canon 与 continuity analysis 是独立能力，没有自动下游提交或 WorkerGroup identity。
- 不使用 Chapter、多个 Chapter 并行、Story Canon/Chapter 独立采用和刷新后的内容一致性依赖真实模型规划，作为人工产品复验；不再以 Prompt token guard 或脚本 Journey 伪装模型行为证据。

## 历史回归

- 旧 Edit-first 把确认剧本、Story Canon、Chapter、核心剪辑、资产和视频编码成连续阶段；自由 Operation registry 上线后仍保留这条“专业主链”，形成两个入口和两个状态解释器。首次修正只把 WorkflowView 降级为 recommendation，没有删除 splitter、固定 Choice、旧 writer 与 stage Golden，因此真实剧本成功后仍弹出“确认剧本，生成制作规划”。当前删除整条流程解释权，Chapter 只作为独立事实存在。
- 首次长视频修正用 `>180s` 自动启用 Source/Story Canon/Chapter，并把 15–180 秒写成另一固定配方。它能提醒模型注意上下文，却把启发式变成第二工作流，无法表达短但多线并行、长但单场连续等真实情况。当前只保留 Primary 可见的强信号，代码没有时长分支。
- 旧 splitter 在采用 Story Canon 的同一事务创建全部 Chapter，导致 Story Canon writer 同时拥有执行分组；随后 `delegation.source=chapters` 容易被误解为持久 WorkerGroup。当前 Story Canon 与 Chapter writer 分离，一个 Chapter 一个 Task，批量只属于既有 Wait 聚合协议。
- Chapter 委派曾把 `chapter.targetDurationSec` 直接写成下游 `targetDurationSeconds`，使规划估时未经区分成为视频交付硬预算：Worker 必须让分段之和精确等于它，估算虚高部分只能由拖慢的表演填满。当前删除该自动映射，交付时长只由调用方显式 `durationIntent` 决定，Chapter 估时退回规划与上限校验职责，仍作为参考事实进入编译上下文。
- Chapter 投影最初按 `(episodeId, chapterIndex)` upsert；采用新计划时数据库 ID 不变但标题、范围和事件已全部替换，使 provenance 中的 chapterId 同时表示“位置”和“叙事单元”。当前同 Plan 重试保留 IDs，不同 Plan 原子 delete+create，位置只在单个计划内部有意义。
- Project 删除曾同时级联 Episode、Source Document 与 Story Canon；Story Canon 对 Source Document 的 `RESTRICT` 会在两条级联路径完成前拒绝删除。单独的权限 Golden 只删空项目，自由 Resource Golden 又不删除，因而没有反证这个真实组合。当前 `delete_project` 仍是唯一入口，但先调用 Chapter Planning owner，按 Story Canon → Chapter → Source Document 的依赖顺序删除项目叙事投影，再删除 Project；外键语义和单实体 writer 均未放宽。

## 修改检查表

1. Chapter 是否仍是可选独立事实，而不是阶段或时长分支？
2. Story Canon、continuity analysis、Chapter 是否各有唯一 writer，且互不自动创建？
3. 每个输入是否只引用精确 Resource ID 并由服务端回读，而非最近记录、内容副本或确认副本？
4. 多 Chapter 是否只复用 OperationBatch/Wait，没有 WorkerGroup 或第二恢复协议？
5. Context Compiler 是否纯派生且 fail closed？
6. UI/Canvas 是否只显示真实事实，没有阶段、下一步或伪造 Lineage？
