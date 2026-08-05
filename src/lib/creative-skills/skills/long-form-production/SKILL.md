---
name: long-form-production
description: Organize long-form creative work into resumable production units and direct media batches.
---

# 长篇连续制作

## 作用

把长剧、电影或其他长篇内容组织成 Agent 能长期维护、并行创作、批量生产和局部续跑的工作区结构计划。Episode、Chapter、Scene 不是系统实体；作品的自然层级由目录路径和本次 `long_form_plan` 描述。

## 第一原则

- 精确剧本和用户确认内容是故事事实；视觉方向、类型惯例和研究不能改写它。
- 目录服务于理解和生产，不为了形式机械拆分。短内容不需要长篇结构。
- 每份事实只有一个维护位置。共享人物、世界规则和持续状态只进入 `continuityFacts`；局部范围进入对应 `productionUnits`，不复制一份会漂移的共享事实。
- 本长篇专业子 Agent是 `long_form_plan` 的唯一 writer；其他专业子 Agent只返回各自固定的严格 JSON。主 Agent只编排和提交，不改写专业内容。
- 系统只保证提交时冻结精确 Resource 版本，不理解或替 Agent 判断剧情一致性。

## 工作区结构

在 `workspaceStructure` 中根据作品类型和实际交付规划清楚但不过度机械的项目相对路径。面向用户的目录使用用户工作语言，并先延续项目已有的命名方式；不要预设或机械补齐空目录。示例：中文剧集可按 `分集/第001集/`，英文剧集可按 `Episodes/Episode-001/`；中文电影可按 `场次/第001场/`，英文电影可按 `Scenes/Scene-001/`。这些只示范语言一致、层级清楚和编号可排序，不是固定根目录、必需层级或系统协议；纪录片、广告、音乐、单片和其他用途应按内容本身组织。关键是路径清晰、边界互斥、共享事实单写。这里只描述结构和用途，不直接创建第二套目录文档。

## 连续性事实

`continuityFacts` 只记录后续仍有效的事实：人物身份和关系、外观/身体状态、知情状态、目标、位置、道具持有与损坏、世界规则、未解决伏笔及已经兑现的变化。每条事实使用稳定 `key` 并指向实际 `sourcePaths`。普通走路、镜头设计、临时情绪和无后果动作不进入共享连续性。

每次更新计划时依据已确认剧本和实际交付更新同一组事实。无法确认的内容进入 `assumptions` 或 `warnings`，不伪装成事实。

## 拆分制作单元

- 优先按完整场景、动作、信息揭示、因果变化和情绪落点切分，不按固定字符或时长平均切。
- 不在尚未完成的持续动作或状态变化中切分。
- 每个单元写清来源范围、目标、入口状态、必须到达的出口状态以及所需共享资产。
- 时长用 `creative-core` 的真实演出方法估算；Provider 的单次时长上限只决定生成分段，不决定故事目录。
- 可独立单元可以分给 Subagent；存在事实依赖的单元按顺序处理。

## 共享资产

重复出现的人物、地点、道具和声音参考只保留一个权威 WorkspaceResource 路径。各单元通过路径引用，不重新生成不同身份。需要新状态时明确创建版本或新资源，并在连续性文档写明生效范围。

## Production Index 与领域生成批次

批量生产前，本长篇专业子 Agent在 `productionUnits` 中列出制作单元、依赖、权威输入、入口/出口状态和负责的固定专业角色。它不替资产、视频或音乐专业子 Agent编写最终 Prompt。

每个真正提交的领域生成批次由对应固定专业子 Agent独占返回，并满足：

- 每个 item 有稳定、唯一的本地 identity。
- 明确输入 `resourceId + contentVersion`、完整最终 Prompt、显式生成参数和依赖；媒体 Placement 由服务端从 canonical folder ID 与名称派生。
- 输入必须指向主 Agent提供的 canonical Resource；禁止“最近结果”或名称猜测。
- 相互独立的 item 可并行；有依赖的 item 明确排序。
- 提交前检查共享资产引用、时长和预算。

一次媒体工具调用由 Wao 在同一个 PlanSnapshot 中冻结实际 `resourceId + contentVersion`、服务端 Placement、报价和 batch item。失败后只续跑失败 item；成功 item 不重新提交或收费。

## 质量检查

- 每个制作单元是否完整覆盖其剧本范围，没有重复或遗漏？
- 入口/出口和共享连续性是否一致？
- 同一角色、地点、道具和声音是否引用同一路径身份？
- 并行专业子 Agent是否严格返回各自固定 outputKind，共享连续性是否只有本长篇专业子 Agent维护？
- `productionUnits.deliverables` 是否为每个专业输出指定唯一 workerKind/outputKind？
- 失败续跑是否只包含失败项？

## 边界

本 Skill 只提供长篇组织与生产方法。唯一正式交付是 Agent profile 注入的 `outputKind: "long_form_plan"` 严格 JSON，不另建 continuity.md、production-index.md 或领域 Prompt 文件。媒体执行、输入冻结、计费、审批、Task、Temporal 和 Resource 终态由 Wao MCP 与系统服务负责。
