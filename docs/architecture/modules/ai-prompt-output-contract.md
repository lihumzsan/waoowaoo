<!-- architecture-module: ai-prompt-output-contract -->

# Agent 指令、固定专业子 Agent 与输出契约

## 为什么是这样

Codex app-server 是唯一通用 Agent Runtime。主 Agent 只接收产品边界、当前 locale、工作区约定和
业务 MCP，所有原生 Skill 均禁用；专业 Skill 正文只存在于 registry 生成的固定 custom agent 指令里。

这是同一 Runtime 的 parent/child 上下文隔离，不是第二套模型循环。

**指令层级**——主 Agent：内置基础指令 → Runtime 全局指令面（自主委派授权）→ Wao 开发者指令 →
MCP schema → Turn locale/context → 用户消息。专业子 Agent：内置基础指令 → 固定 custom agent 指令
（worker 边界 + 唯一 outputKind schema + 核心 Skill + 一个专业 Skill）→ 主 Agent 分派的 Resource
引用与任务说明。专业子 Agent 不拥有业务 MCP。

## 不变量

- **APO-01 — 唯一 Runtime。** 聊天、Plan、Goal、用户输入请求、搜索、Shell、文件、Skill 与
  Subagent 均由 app-server 产生；不恢复第二套 Agent SDK 或自研 Worker loop。
- **APO-02 — 主 Prompt 只声明边界。** 主 Agent 指令只说明 scope、工作区所有权、worker 路由、
  locale 与 MCP 使用原则，不复制 Skill 正文。
- **APO-03 — 固定子上下文。** 子 Agent 的角色和 Skill 集由 registry 决定并在载入时注入；
  description、用户措辞和模型输出不能改变 Skill 集。
- **APO-04 — 结构来自协议。** 所有交互结构只消费原生 JSON-RPC item/event，不从正文解析。
- **APO-05 — 专业输出是固定 JSON final response。** 固定子 Agent 是各类专业 JSON 的唯一 writer；
  registry 给每个角色恰好一个 outputKind 和 strict schema。主 Agent 不得复制、修复或改写，只验证
  并提交；不从 Skill 散文或临时文件猜字段。
- **APO-06 — 业务输入冻结。** 提交只接受 ready Resource 的 id + 内容版本，服务端验证 ownership 并
  冻结当时路径与内容摘要，再把完整 Prompt、参数与引用冻结到 Task payload。
- **APO-07 — 参数分权。** 子 Agent 拥有完整创作 Prompt 与叙事相关参数；系统拥有模型选择、Provider
  路由、能力校验、计费、审批、Task 和终态。子 Agent 只读取只读能力投影，能力为空时不得猜测或交付
  可执行 generation items。
- **APO-08 — 缺能力显式失败。** 缺 custom agent、无效 generation batch、未知 event、缺 MCP
  capability 或版本不兼容必须原地失败；禁止 fallback 到主 Agent 创作或服务端 Prompt 编译。
- **APO-09 — 用户可见内容本地化。** UI 文案来自 i18n；Agent 输出遵循 Turn locale 或用户明确语言。
- **APO-10 — 不用 Prompt 伪造媒体能力边界。** 指令与 Skill 不注入真人、公众人物、相似度或写实
  风格禁令。能力只读取声明式投影，执行时的 Provider 拒绝只通过统一 typed failure 返回，不得再
  投影成常驻 Agent 政策。
- **APO-11 — 自主委派使用原生指令面。** 全局指令面明确允许主 Agent 自主选择固定子 Agent；不得
  依赖用户说出实现术语、伪造用户消息，或用全局提升推理等级换取委派权限。

## 权威入口

- Runtime 协议：`src/lib/codex-runtime/**`
- 主 Agent 指令与会话：`src/lib/assistant-runtime/**`（事件投影：`event-projector.ts`）
- 固定角色、Skill 注入与全部 outputKind 契约：`src/lib/creative-skills/**`
- 媒体批量输入契约：`src/lib/workspace-resource/generation-request.ts`
- 只读能力投影：`src/lib/codex-workspace/projector.ts`

## 踩过的坑

- 一份"真人视觉安全政策"曾作为唯一正文注入主 Agent，用来规避当时视频模型的输入限制 → 把已过期的
  Provider 能力限制固化成常驻 Agent 政策 → 模型支持后政策文件与注入点一并删除，Provider 拒绝只由
  adapter 的 typed failure 表达（APO-10）。
- custom agent 曾只有自然语言交付说明，Skill 内手写示例与执行层 strict schema 分别演化；错误边界
  又只返回"参数无效"，模型无法知道该删哪个字段，转而猜路径连续重试 → 字段契约有两份表示 →
  registry 是唯一权威，自动生成的 schema 注入对应 child，失败返回精确字段 corrections（APO-05）。
