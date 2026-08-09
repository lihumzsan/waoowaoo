<!-- architecture-module: ai-prompt-output-contract -->

# Agent 指令、Skill 与输出契约

## 为什么是这样

Codex app-server 是唯一 Agent Runtime。主 Agent 接收产品边界、当前 locale、实时项目生产上下文和
业务 MCP；专业方法通过 registry 生成的原生 Wao Skill 按需读取。每个专业结果只使用它对应的
Skill，同一用户目标可顺序产生多个不同领域结果。专业创作不跨线程交接，Codex agents 默认关闭。

**指令层级**——主 Agent：内置基础指令 → Runtime 全局主 Agent 约束 → Wao 开发者指令与固定领域
映射 → 系统构造的当前项目生产上下文 → 原生 Skill inventory → MCP schema → Turn locale/context →
用户消息。读取某个领域 Skill 后，该 Skill 内的“核心正文 + 一个专业正文 + 唯一 outputKind schema”
成为本次专业结果的完整方法契约。

## 不变量

- **APO-01 — 唯一 Runtime。** 聊天、Plan、Goal、用户输入请求、搜索、Shell、文件与 Skill 均由
  app-server 产生；不恢复第二套 Agent SDK、自研 Worker loop 或专业 child Thread。
- **APO-02 — 主 Prompt 只声明边界。** 主 Agent 固定指令只说明 scope、所有权、Skill 路由、locale
  与 MCP 使用原则，不复制专业 Skill 正文。
- **APO-03 — 固定 Skill 上下文。** 每个领域 Skill 的核心正文、专业正文和 outputKind schema 由
  registry 决定并在 Runtime 物化时组装；description、用户措辞和模型输出不能改变其内部 Skill 集。
- **APO-04 — 结构来自协议。** 所有交互结构只消费原生 JSON-RPC item/event，不从正文解析生命周期。
- **APO-05 — 专业输出是一个 typed in-turn 对象。** 主 Agent 是各类专业 JSON 的唯一 writer；
  registry 给每个领域恰好一个 outputKind 和 strict schema。响应、显式保存与媒体提交必须使用同一个
  对象，不从 Skill 散文、历史消息或临时文件猜字段。
- **APO-06 — 业务输入冻结。** 提交只接受 ready Resource 的 id + 内容版本，服务端验证 ownership 并
  冻结当时路径与内容摘要，再把完整 Prompt、参数与引用冻结到 Task payload。
- **APO-07 — 参数分权。** 主 Agent 的专业结果拥有完整创作 Prompt 与叙事相关参数；系统拥有模型
  选择、Provider 路由、Project 画幅、资产格式、能力校验、计费、审批、Task 和终态。当前能力上下文
  由服务端每 Turn 从唯一 resolver 直接注入主 Agent；能力为空时不得猜测或提交可执行 items。
- **APO-08 — 缺能力显式失败。** 缺 Runtime Skill、无效 generation batch、未知关键 event、缺 MCP
  capability 或版本不兼容必须原地失败；禁止 fallback 到另一个 Agent、服务端 Prompt 编译或第二套
  schema。
- **APO-09 — 用户可见内容本地化。** UI 文案来自 i18n；Agent 输出遵循 Turn locale 或用户明确语言。
- **APO-10 — 不用 Prompt 伪造媒体能力边界。** 指令与 Skill 不注入真人、公众人物、相似度或写实
  风格禁令。能力只读取系统注入的声明式 View，Provider 拒绝只通过统一 typed failure 返回，不得再
  投影成常驻 Agent 政策。
- **APO-11 — 不存在 Wao 委派旁路。** Wao 不创建或恢复 child Thread，也不通过 placement 改写用户 Codex Home 的
  agents 配置。专业结果的创建、修正和提交都留在同一 Turn；不得通过 child event、hook、UI 或提高推理等级恢复第二 writer。

## 权威入口

- Runtime 协议：`src/lib/codex-runtime/**`
- 主 Agent 提示词：`src/lib/ai-prompts/templates/project-agent/system/project-agent-system.txt`；加载与
  会话：`src/lib/ai-prompts/project-agent-system.ts`、`src/lib/assistant-runtime/**`（事件投影：
  `event-projector.ts`）
- Skill 组装与全部 outputKind 契约：`src/lib/creative-skills/**`
- 媒体批量输入契约：`src/lib/workspace-resource/generation-request.ts`
- 项目生产上下文 resolver 与 Turn 注入：`src/lib/project-production-context.ts`、
  `src/lib/assistant-runtime/runtime-access.ts`

## 踩过的坑

- 一份“真人视觉安全政策”曾作为唯一正文注入主 Agent，用来规避当时视频模型的输入限制 → 把已过期的
  Provider 能力限制固化成常驻 Agent 政策 → 模型支持后政策文件与注入点一并删除，Provider 拒绝只由
  adapter 的 typed failure 表达（APO-10）。
- Skill 内手写示例与执行层 strict schema 曾分别演化；错误边界又只返回“参数无效”，模型无法知道该
  删哪个字段并连续猜测 → 字段契约有两份表示 → output registry 是唯一权威，物化时把 schema 直接
  组装进对应 Skill，执行失败返回精确字段 corrections（APO-03/05）。
