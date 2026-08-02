<!-- architecture-module: ai-prompt-output-contract -->

# Agent 指令、Skill 与模型输出契约

## 设计理念

Wao 不再维护自研 Primary Agent Prompt、上下文压缩 Prompt、Tool discovery Prompt 或固定工作流。
Codex app-server 拥有通用推理、上下文、工具选择和压缩；Wao 只向它投影项目文件、版本锁定的
Creative Skills、用户 locale、安全政策和 MCP 能力。专业创作仍可委派给一次性 Creative Worker，
其结果由严格 output registry 校验后物化为不可变 Resource。

## 不变量

- **AP-01 — Primary 指令只有三个来源。** 产品级运行纪律由
  `assistant-runtime/runtime-access.ts` 注入；项目事实与可写边界由 Creative Workspace 的
  `AGENTS.md` 和 `system/*.json` 投影；专业方法只来自 `system/skills/*/SKILL.md`。不存在
  `project-agent-system`、context checkpoint、双语 Primary 模板或第二套模型历史。
- **AP-02 — Skill 是方法，不是状态或权限。** Skill 不能写 Resource、Task、Billing、Approval
  或 Canvas；版本和目录由 Creative Skill registry 唯一声明。Codex 可按目标自由读取相关 Skill，
  Creative Worker 只能读取 output registry 为当前 output kind 绑定的一个专业 Skill。
- **AP-03 — MCP 是唯一产品能力目录。** Primary 不再调用 `load_tools/execute_operation` 或
  Agents SDK Tool wrapper；Codex 从 Wao MCP 的 `tools/list` 发现 registry 中 `channels.mcp=true`
  的能力，并以 canonical JSON Schema 调用。MCP 只传输调用，Operation invocation、计划、Grant、
  Task、Billing、Provider 与 Resource owner 保持唯一。
- **AP-04 — 专业输出由 strict registry 裁决。** `screenplay`、
  `chapter_continuity_plan`、`creative_direction`、`asset_manifest`、`video_prompt_set` 与
  `music_direction` 是穷尽 output kind。Worker 直接提交由同一 Zod schema 派生的根对象；禁止
  `output`/`outputJson` 包装、字符串化 JSON、宽松字段、第二次 LLM repair 或从文本猜状态。
- **AP-05 — 来源内容由服务端重读。** Creative Work 和媒体 Operation 只接收精确 Resource ID
  与显式用途；服务端验证 owner、scope、schema、内容和 lineage。模型不得用最近记录、数组位置、
  显示名称、历史消息或自报 fingerprint 代替正式 identity。
- **AP-06 — 专业职责不重叠。** `story-development` 只创作/修改剧本；
  `chapter-continuity-planning` 只在确有多个 Chapter 时一次生成 Canon 与边界；
  `creative-direction` 只拥有全局呈现政策；`asset-development` 只筛选资产并写稳定可见设计；
  `video-direction` 独占最终视频分段和 Prompt；`music-direction` 独占 spotting 与 cue 指令。
  Operation、Codex 或另一个 Worker 不得重写这些结果。
- **AP-07 — 自由规划不等于隐式工作流。** Codex 根据用户目标、Workspace 与正式 View 自由组合
  Skill 和 MCP，不存在时长档位、固定段数、固定 next action、自动采用或隐藏串行链。产品交付纪律
  可以进入运行指令或 Skill，但不得变成未声明的服务端前置条件。
- **AP-08 — 过程与事实分离。** Codex reasoning、plan、command、file change、collaboration 和
  MCP item 只投影为 Assistant View；Task terminal 与已采用 Resource 才是产品事实。UI 不从
  Markdown、历史消息、文件中的 status 或模型措辞推断完成状态。
- **AP-09 — 用户可见语言显式注入。** 每个 Turn 都注入当前 locale；模型用户可见回复遵守该
  locale，UI 文案继续走 i18n。Skill 与模型侧英文指令不是用户可见语言的权威。
- **AP-10 — 真人视觉安全政策只有一份正文。** `HUMAN_VISUAL_SAFETY_POLICY` 由
  `src/lib/ai-prompts/human-visual-safety-policy.ts` 唯一拥有，并同时投影给 Codex Primary 与需要
  视觉判断的 Creative Worker。Skill、Operation 描述和 Compiler 不复制或改写正文。
- **AP-11 — Provider 能力不创建第二流程。** 模型、wire API、上下文窗、媒体时长、画幅与参考
  数量来自 provider/capability registry。缺失能力原地失败；禁止按 Provider 名称猜测、静默降级、
  切回 Chat Completions 或恢复旧 Primary runtime。
- **AP-12 — 精确剧本独占派生时间线。** 用户未指定时长时，精确剧本与 `creative-core` 的真实语速、
  动作和停顿方法决定总时长；Direction、题材、画幅、示例和 Provider 分段不得反向创造时长。

## 权威入口

- Codex 运行指令与 locale：`src/lib/assistant-runtime/runtime-access.ts`。
- Workspace 与 Skill 投影：`src/lib/codex-workspace/**`、`src/lib/creative-skills/**`。
- Wao 能力目录：`src/lib/wao-mcp/**`、`src/lib/operations/registry.ts`。
- Creative Worker strict 输出：`src/lib/creative-worker/output-registry.ts`、
  `output-submission.ts`、`task-contract.ts`。
- Resource 物化与 Lineage：`src/lib/creative-resource/**`。
- 唯一真人视觉政策：`src/lib/ai-prompts/human-visual-safety-policy.ts`。

## 验证

- `npm run runtime:codex:smoke` 使用真实 Codex app-server 验证自定义 Responses provider、
  thread rollout、纯 JSONL 恢复，以及从生产 Operation registry 派生的 MCP 目录与 elicitation。
- Operation/Task registry conformance 验证确定性接线；真实模型是否正确选择 Skill、规划镜头和遵守
  创作方法没有可靠自动 oracle，必须用真实模型与媒体样片复验。

## 历史回归

旧 Primary 先后拥有系统 Prompt、动态 Tool discovery、上下文 checkpoint、Agents SDK runner、
MySQL model history 和 Temporal Turn Coordinator。每次修补模型服从、上下文或恢复问题都会增加
新的状态解释者。当前防线是删除整套 Primary Prompt/runtime，只保留 Codex 的通用能力与 Wao 的
产品事实边界；专业知识继续由版本锁定 Skill 和 strict Worker 输出拥有。

真人视觉政策曾分别复制进 Primary Prompt、Skill 与 Worker constraints，内容发生漂移。当前正文
只在一个常量中维护，由 Primary runtime 与 visual Worker 引用同一值。

视频时长和分段曾被三档 Playbook、固定段数与 Provider 时长共同解释。当前没有 Primary 配方；
derive 时间线只来自精确剧本与 `creative-core`，执行层只校验已选 Provider 的确定性 capability。

## 修改检查表

1. 是否重新增加了自研 Primary Prompt、模型历史、Tool discovery 或固定工作流？
2. 新能力是否来自 Operation registry 的 MCP 投影并继续经过原有 owner？
3. 新专业输出是否在 output registry 穷尽声明唯一 Skill、schema、scope 与物化入口？
4. Workspace 文件是否只表达创作内容/指针，未复制 Task、Billing 或 Resource status？
5. 用户可见内容是否遵守 Turn locale，安全政策是否仍引用唯一正文？
6. 无自动 oracle 的创作质量是否如实保留为真实模型/媒体复验盲区？
