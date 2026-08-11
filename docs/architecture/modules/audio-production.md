<!-- architecture-module: audio-production -->

# 独立音乐、音色与确定性混音

## 为什么是这样

音乐、声音参考和混音结果都是普通 WorkspaceResource。主 Agent 读取音乐 Skill 后形成唯一 strict
JSON 专业结果，并把同一 items 直接提交给 `create_audio`。系统没有自动 BGM 阶段、声音工作流状态机
或“规划完成自动生成”。

最终混音只做显式技术装配：输入、顺序、时间和增益全部冻结，执行不分析内容后改写创作决定。

## 不变量

- **AP-01 — 方向是固定 JSON 结果。** 配乐方向、cue 和音效说明由主 Agent 使用音乐 Skill 写入唯一
  outputKind 的 JSON；没有强制文件、第二份 Markdown、Worker output 或 BGM plan 实体。“不配乐”是同一
  schema 的显式空分支，不能提交为生产任务。
- **AP-02 — 每次生成显式提交。** `create_audio` items 必须给出名称、模态公共参数和精确输入引用；
  Placement 由服务端根据项目相对目标文件夹路径与用户可见名称派生；
  候选数量上限由 registry 声明。成功只生成对应 Resource，不自动触发混音或视频。
- **AP-03 — Provider 能力只约束单次执行。** 生成模式、Composition Plan、时长、格式和输入上限由
  capability registry 唯一声明；Skill 可把真实 Provider 限制重复为创作纪律，但执行校验仍只读
  registry。能力缺失原地失败，不自动换模型、改写计划、拆分作品或创建系统层级实体。
- **AP-04 — 音色是资源。** 参考音色只有在本次输入显式引用并冻结其资源 id 与版本时才传给 Provider；
  "当前音色"或最近记录不是事实。
- **AP-05 — 混音确定且有界。** 每个音乐 cue 必须携带一个精确成片版本的 lineage；输入、顺序、
  毫秒放置、计划派生时长、增益与自动化由既有 merge Operation 唯一冻结。执行只统一采样率、时间戳、
  pad/trim、cue 总线与对白 ducking，不能分析内容后改写创作决定。
- **AP-06 — 终态不连锁。** 音频 Task 只结算自身 Resource 与账单；后续采用、重做、混音或视频均需
  独立用户意图和授权。
- **AP-07 — 音乐输入是唯一结构化计划。** 主 Agent 的音乐结果直接写 Composition Plan、绝对时间线
  放置、混音意图与精确成片引用；不得再由 Provider 自动 plan、video-to-music、Prompt 编译器或 handler
  产生第二份配乐解释。Planner 在报价和 Task 前校验并冻结同一结构；retry、adapter、Resource provenance
  与 merge planner 只消费这份冻结事实。

## 权威入口

- 创作知识：`src/lib/creative-skills/skills/music-direction/SKILL.md`
- 计划、Placement、冻结与提交：生产 Operation registry + PlanSnapshot
- 执行：`src/lib/task/execution/handlers/workspace-resource-{audio,voice}.ts` 与 provider adapter
- 确定性装配：video merge Operation/handler
- 终态：Task Terminal Service 与 WorkspaceResource materializer

## 踩过的坑

- BGM 曾以 planner stream → 设计实体 → 乐谱 → 最终节点依次交接，任何 owner 字段或查询条件漂移都
  制造空窗 → 多阶段专用实体各自解释一段状态 → 音乐方向是普通 Resource，生成音乐是普通 audio
  Resource，最终输出是普通 video Resource。
- 音乐模型能力曾以少数固定秒数枚举表达，业务层无法为任意时间线声明明确请求 → 能力被抄成第二份
  枚举 → registry 唯一声明连续区间，短目标统一请求下限后本地确定性贴合，超上限拒绝（AP-03）。
- 音乐 Prompt 已由 Skill 写成完整结果，Provider 共享 helper 仍在冻结后追加 genre、mood、时长等文案，
  1021 字符的合法输入因此被扩成 1147 字符并遭拒 → 上一版只约束了 Planner 与 handler，没有把
  adapter 纳入单 writer 边界 → 删除服务端编译器，adapter 原样发送冻结 Prompt，并向 Skill 注入远低于
  Provider 硬上限的保守目标预算（AP-07）。
- 音色首版只保存了音频对象却把真实时长写成 null，视频预检又只校验引用角色与数量，1.728 秒试听因而在
  报价授权后才被 Provider 拒绝并诱导额外付费重做 → 上一版防线没有把冻结媒体事实纳入能力约束 → 音色
  Worker 测量并持久化时长，视频 Planner 按模型 registry 对精确 ResourceVersion 在 Plan 前校验（AP-03/04）。
- cue 起止曾只存在于创作输出，生成 Operation 没有冻结放置，最终 merge 又只会从零开始铺一条 BGM；
  上一版仅校验 Agent JSON，没有覆盖 Task、retry、Resource provenance 和真实 mixer 调用链 → cue timing
  与精确成片 lineage 成为同一冻结事实，merge planner 是唯一 placement writer（AP-05/07）。
