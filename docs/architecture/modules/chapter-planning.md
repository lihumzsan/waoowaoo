<!-- architecture-module: chapter-planning -->

# Chapter、连续性与并行创作单元

## 设计理念

Chapter 是可选、可版本化的创作上下文单元，不是工作流阶段。它只在一个作品需要多个相对独立的工作单元、并行处理、局部失败恢复或有界上下文时提供价值；单一连续上下文即使很长，也不必被系统强制拆分。

连续性不是“存在多个 Chapter”的同义词。Primary Agent 依据共享 canon、跨单元人物/场景/道具状态、时间顺序、视觉与声音延续、上下文预算和用户目标，决定是否委派 `continuity_analysis`、采用 Bible 或建立 Chapters。总时长大于 180 秒只是强规划信号，不是代码分支。

## 不变量

- **CP-01 — Chapter 可选且独立。** Chapter 可以由显式 Operation 从精确剧本 Revision 或用户给出的结构创建、修改和删除；采用 Bible 不自动创建 Chapter，创建 Chapter 不自动生成 Bible、连续性分析、资产、视频或渲染。
- **CP-02 — 没有时长状态机。** 服务端不得按 `<=15`、`15–180`、`>180` 自动选择流程、Operation 或 Worker。`>180s` 只进入 Primary 的规划提示；最终判断还必须考虑独立工作单元、共享事实、上下文与恢复价值。Primary 已经选择委派 `chapter_plan` 后，`adopt_chapters` 只校验每个已给独立单元不超过 180 秒；它不决定章数或边界。
- **CP-03 — 剧本 Revision 是来源。** Chapter 必须显式引用一个精确 screenplay Resource Revision 及范围/内容 fingerprint；`ProjectEpisodeSourceDocument` 只是该 Revision 的严格不可变领域投影，不拥有第二份内容解释权。不存在 `confirmed_screenplay`、最近剧本或“正式剧本”副本。旧 Revision 即使不再是 head 仍可合法使用。
- **CP-04 — Bible、连续性分析与 Chapter 分权。** Bible 是可采用的全局 canon Resource，continuity analysis 是针对一组精确输入 revisions 的专业结果，Chapter 是执行上下文单元。三者各有唯一 writer 和版本，互不自动派生，消费者必须显式传入实际使用的 revisions。
- **CP-05 — 并行不产生 WorkerGroup。** Primary 可对多个 Chapter 调用 `delegate_creative_work({delegation:{source:'chapters'}})`；每个 Chapter 对应一个独立 `creative_work` Task，聚合只复用 OperationBatch/Wait。系统不持久化 WorkerGroup、章节批次状态机或跨 Task 共享可变内存。
- **CP-06 — 最小上下文纯派生。** Context Compiler 只从显式 screenplay/Bible/Chapter/Style/asset revisions 为一个 Chapter 构造有界输入；缺失、scope 不符或 fingerprint 变化必须失败。它不写事实、不选择 Skill、不创建 Task、不决定执行顺序。
- **CP-07 — 连续事实有唯一 owner。** 全局 canon 只由被采用的 Bible Revision 解释；一次 continuity analysis 只描述其精确输入的分析结果，不能覆盖 Bible。Chapter 局部状态只属于该 Chapter revision；跨单元冲突由 Primary 重新委派分析或显式采用新版本，不能由晚到 Task 覆盖。
- **CP-08 — 媒体执行仍按精确输入。** 视频、资产和音乐 Resource 可以直接从任意合法 revisions 生成，也可以消费 Chapter context；是否使用 Chapter 不改变 Operation eligibility。provider 的单次时长/引用数量约束由 capability registry 在执行前校验，不得反向变成创作工作流。
- **CP-09 — UI 只显示真实事实。** Canvas 可显示持久 Chapter、Resource、Task 与 Lineage，但不得投影“当前阶段”“下一章”“全局连续性已完成”或按时长自动生成节点。连线只来自实际 Revision lineage。

## 状态所有权

| 事实 | 唯一 owner / writer | 消费者 |
| --- | --- | --- |
| 剧本内容 | `screenplay_draft` Creative Resource Revision | Primary、Bible/continuity/Chapter Operations |
| 全局 canon | 被采用的 Bible Resource Revision / Bible adoption Operation | Context Compiler、Primary、显式下游调用 |
| Chapter identity 与版本 | Chapter service / Chapter Operation | Primary、Context Compiler、Canvas |
| 连续性分析结果 | `creative_work(outputKind=continuity_analysis)` 终态 Revision | Primary；除非显式采用，不写其他事实 |
| Chapter 专业结果 | 每 Chapter 的独立 `creative_work` Task/Resource Revision | Primary、显式下游 Operation |
| 并行聚合与恢复 | OperationBatch + collecting Wait | Assistant continuation |

## 权威入口

- Chapter 创作判断：`creative_work(outputKind=chapter_plan)` 与相关 Skill；领域投影的显式采用：`adopt_chapters`。
- Creative Worker 输出协议：`src/lib/creative-worker/output-registry.ts`。
- Chapter 最小上下文：`src/lib/creative-worker/context-compiler.ts`、`src/lib/edit-chapter/creative-context-service.ts`。
- Primary 规划规则：`src/lib/ai-prompts/templates/project-agent/system/**`；它只能提供判断标准，不能实现服务端分支。
- 并行与恢复：`src/lib/project-agent/operation-batch.ts`、`waits.ts` 与 Task terminal continuation。

## 验证

- Operation/Task conformance 应证明 Chapter、Bible 与 continuity analysis 是独立能力，没有自动下游提交或 WorkerGroup identity。
- Choice/Prompt guards 应拒绝固定阶段、`confirmed_screenplay`、时长配方和专用 Chapter 卡片。
- 适用自由组合 Golden 应覆盖：不使用 Chapter 的单上下文作品；多个 Chapter 并行且只恢复一次；Bible/Chapter 独立采用；刷新后精确 Revision 与 Lineage 保持不变。

## 历史回归

- 旧 Edit-first 把确认剧本、Bible、Chapter、核心剪辑、资产和视频编码成连续阶段；自由 Operation registry 上线后仍保留这条“专业主链”，形成两个入口和两个状态解释器。首次修正只把 WorkflowView 降级为 recommendation，没有删除 splitter、固定 Choice、旧 writer 与 stage Golden，因此真实剧本成功后仍弹出“确认剧本，生成制作规划”。当前删除整条流程解释权，Chapter 只作为独立事实存在。
- 首次长视频修正用 `>180s` 自动启用 Source/Bible/Chapter，并把 15–180 秒写成另一固定配方。它能提醒模型注意上下文，却把启发式变成第二工作流，无法表达短但多线并行、长但单场连续等真实情况。当前只保留 Primary 可见的强信号，代码没有时长分支。
- 旧 splitter 在采用 Bible 的同一事务创建全部 Chapter，导致 Bible writer 同时拥有执行分组；随后 `delegation.source=chapters` 容易被误解为持久 WorkerGroup。当前 Bible 与 Chapter writer 分离，一个 Chapter 一个 Task，批量只属于既有 Wait 聚合协议。

## 修改检查表

1. Chapter 是否仍是可选独立事实，而不是阶段或时长分支？
2. Bible、continuity analysis、Chapter 是否各有唯一 writer，且互不自动创建？
3. 每个输入是否引用精确 Resource Revision/fingerprint，而非最近记录或确认副本？
4. 多 Chapter 是否只复用 OperationBatch/Wait，没有 WorkerGroup 或第二恢复协议？
5. Context Compiler 是否纯派生且 fail closed？
6. UI/Canvas 是否只显示真实事实，没有阶段、下一步或伪造 Lineage？
