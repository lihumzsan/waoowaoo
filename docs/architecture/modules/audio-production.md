<!-- architecture-module: audio-production -->

# 独立音乐、音色与确定性混音

## 设计理念

音乐、声音参考和混音结果都是普通 WorkspaceResource。创作判断由 Agent 按需读取 `music-direction` Skill 并写入工作区；媒体生成通过 Wao MCP/Operation，最终混音只消费显式冻结的媒体与时间线。系统没有自动 BGM 阶段或声音工作流状态机。

## 不变量

- **AP-01 — 方向是普通文件。** 配乐方向、cue 和对白/音效说明由 Agent 写入用户目录；没有 Creative Worker output、BGM plan 实体或“规划完成自动生成”。
- **AP-02 — 每次生成显式提交。** `create_audio` / voice capability 必须给出 Placement、模型公共参数和精确输入引用；alternatives 仍由 registry 声明数量上限。成功只生成对应 Resource，不自动触发混音或视频。
- **AP-03 — Provider 能力只约束单次执行。** 时长、格式和输入上限由模型 capability registry 唯一声明；不得据此自动拆分作品或创建系统 Episode/Chapter。
- **AP-04 — 音色是资源。** 角色/旁白参考音色只有在本次输入显式引用并冻结其 resourceId/version 时才传给 Provider；“当前音色”或最近记录不是事实。
- **AP-05 — 混音确定且有界。** 输入视频/音频、顺序、start/end、gain/fade/automation 全部冻结；输出时长由 stitched timeline 决定。执行统一采样率、PTS、pad/trim 和超时，不能分析内容后改写创作决定。
- **AP-06 — 终态不连锁。** 音频 Task 只结算自身 Resource/账单；后续采用、重做、混音或视频均需独立用户意图和授权。
- **AP-07 — 音乐输入是显式产品字段。** `create_audio` 只接收 `durationSeconds`、`vocalMode`、`genre`、`mood`、`bpm` 与精确 context/video 引用；格式、模型和 provider option 由服务端 registry/config 编译并在 Plan 前校验。原始 prompt 与这些字段由唯一共享编译器组成 Provider 最终文本，Planner 对最终文本执行模型长度校验；Task handler 只消费冻结结果，不能把缺失默认值或可预测的 prompt 超限改写为 Worker 内部错误。

## 权威入口

- 创作知识：`src/lib/creative-skills/skills/music-direction/SKILL.md`。
- 公共能力/模型参数：AI/provider capability registry。
- 计划、Placement、冻结与提交：生产 Operation registry、Wao MCP、PlanSnapshot。
- 音频/声音执行：`src/lib/task/execution/handlers/workspace-resource-audio.ts`、`workspace-resource-voice.ts` 与 provider adapter。
- 确定性视频/音频装配：video merge Operation/handler。
- Resource 终态：Task Terminal Service 与 WorkspaceResource materializer。

## 验证

Registry conformance 穷尽验证音频/声音/混音能力的 Placement、schema 与计费；Task critical suites 验证重试、终态、Resource 版本和账本。FFmpeg 时长、PTS、超时以及真实 Provider 时长服从度需在适用执行样本验证。

## 修改检查表

- 是否恢复了固定 BGM planner、Worker output 或终态自动后继？
- 输入音色/音频是否使用精确 Resource 版本，而非当前/最近推断？
- Provider 限制是否只留在 capability/adapter，不成为创作层级？
- 混音是否只做显式技术装配？
