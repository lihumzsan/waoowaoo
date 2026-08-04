---
name: long-form-production
description: Organize long-form creative work into resumable workspace folders and production manifests.
---

# 长篇连续制作

## 作用

把长剧、电影或其他长篇内容组织成 Agent 能长期维护、并行创作、批量生产和局部续跑的普通文件夹。所有分集、场景、镜头、共享设定、连续性和生产清单都是用户工作区文件，不是系统实体。

## 第一原则

- 精确剧本和用户确认内容是故事事实；视觉方向、类型惯例和研究不能改写它。
- 目录服务于理解和生产，不为了形式机械拆分。短内容不需要长篇结构。
- 每份事实只有一个维护位置。共享人物、世界规则和持续状态写在 `series/`；局部内容写在对应制作单元，不复制一份会漂移的共享事实。
- 本长篇专业子 Agent是共享连续性和长篇生产索引的唯一 writer；其他专业子 Agent只写主 Agent明确分派的互斥目录与各自领域 Manifest。主 Agent只编排和提交文件，不改写专业内容。
- 系统只保证提交时冻结实际文件与 Resource 版本，不理解或替 Agent 判断剧情一致性。

## 推荐目录（可按作品调整）

```text
series/
  overview.md
  continuity.md
  assets.md
  production-index.md
episodes/
  01/
    screenplay.md
    plan.md
    shots/
    outputs/
  02/
    ...
```

目录名不是协议。若电影更适合按幕/场景、纪录片更适合按段落组织，可以自由替换；关键是路径清晰、边界互斥、共享事实单写。

## 连续性文档

`series/continuity.md` 只记录后续仍有效的事实：人物身份和关系、外观/身体状态、知情状态、目标、位置、道具持有与损坏、世界规则、未解决伏笔及已经兑现的变化。普通走路、镜头设计、临时情绪和无后果动作不进入共享连续性。

每次完成一个制作单元，由本长篇专业子 Agent依据已确认剧本和实际交付更新同一文档。无法确认的内容标为假设或待核对，不伪装成事实。

## 拆分制作单元

- 优先按完整场景、动作、信息揭示、因果变化和情绪落点切分，不按固定字符或时长平均切。
- 不在尚未完成的持续动作或状态变化中切分。
- 每个单元写清来源范围、目标、入口状态、必须到达的出口状态以及所需共享资产。
- 时长用 `creative-core` 的真实演出方法估算；Provider 的单次时长上限只决定生成分段，不决定故事目录。
- 可独立单元可以分给 Subagent；存在事实依赖的单元按顺序处理。

## 共享资产

重复出现的人物、地点、道具和声音参考只保留一个权威 WorkspaceResource 路径。各单元通过路径引用，不重新生成不同身份。需要新状态时明确创建版本或新资源，并在连续性文档写明生效范围。

## Production Index 与领域 Manifest

批量生产前，本长篇专业子 Agent维护生产索引，列出制作单元、依赖、权威输入路径、负责的固定专业角色和应产出的领域 Manifest 路径。它不替资产、视频或音乐专业子 Agent编写最终 Prompt。

每个真正提交的领域 Manifest 由对应固定专业子 Agent独占写入，并满足：

- 每个 item 有稳定、唯一的本地 identity。
- 明确 Placement、输入 `workspacePath`、完整最终 Prompt、显式生成参数和依赖。
- 输入路径必须指向当前工作区实际文件/资源；禁止“最近结果”或名称猜测。
- 相互独立的 item 可并行；有依赖的 item 明确排序。
- 提交前检查目标路径冲突、共享资产引用、时长和预算。

一次提交由 Wao 在同一个 PlanSnapshot 中冻结实际 `resourceId + contentVersion`、Placement、报价和 manifest item。失败后只续跑失败 item；成功 item 不重新提交或收费。

## 质量检查

- 每个制作单元是否完整覆盖其剧本范围，没有重复或遗漏？
- 入口/出口和共享连续性是否一致？
- 同一角色、地点、道具和声音是否引用同一路径身份？
- 并行专业子 Agent是否严格写各自目录，共享连续性文件是否只有本长篇专业子 Agent写？
- Production Index 是否指向实际存在的领域 Manifest，且每个输出都有唯一 Placement？
- 失败续跑是否只包含失败项？

## 边界

本 Skill 只提供长篇组织与生产方法。目录和文档由 Agent 管理；媒体执行、输入冻结、计费、审批、Task、Temporal 和 Resource 终态由 Wao MCP 与系统服务负责。
