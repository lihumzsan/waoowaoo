<!-- architecture-module: ai-prompt-output-contract -->

# Agent 指令、Skill 与输出契约

## 设计理念

Codex app-server 是唯一通用 Agent Runtime。Wao 只注入产品边界、当前 locale、Project 工作区约定、Creative Skill 目录和 MCP 能力；不再维护另一份 Primary Agent system prompt、工具选择器或模型输出状态机。

## 指令层级

从底到顶依次为：Codex 内置基础指令、Wao `developerInstructions`、MCP 工具 schema、可按需读取的 `SKILL.md`、当前 Turn 的 locale/context、用户消息。它们是同一 Runtime 的不同来源，不是多个 Agent。冲突时遵循 Codex 协议优先级；Wao 不从自然语言输出猜测工具状态。

## 不变量

- **APO-01 — 唯一 Runtime。** 所有聊天、计划、请求用户输入、搜索、Shell、文件修改、Skill 和 Subagent 行为都由 Codex app-server 产生；禁止恢复 Agents SDK 或自研模型循环。
- **APO-02 — Prompt 只声明边界。** `developerInstructions` 说明 Project scope、工作区字段所有权、Subagent 写边界、locale 和 MCP 使用原则，不复制 Creative Skill 正文或业务实现。
- **APO-03 — 结构来自协议。** Plan、Goal、request_user_input、Web Search、命令、Diff、MCP、审批、compaction 和 Subagent 状态只消费 Codex 原生 JSON-RPC item/event；不得从 assistant 文本或 Markdown 反推。
- **APO-04 — 业务输入冻结。** 付费或长期 Operation 的结构化输入由 Wao MCP schema 校验，并在提交边界解析 `workspacePath → resourceId + contentVersion`；模型文本不是执行事实。
- **APO-05 — Skills 按需读取。** Runtime 只收到 Skill 目录摘要；正文由 Agent/原生 Subagent按需读取。Skill 不定义第二输出协议。
- **APO-06 — 用户可见内容本地化。** Wao UI 文案来自 i18n；Agent 输出遵循 Turn locale 或用户明确语言。
- **APO-07 — 缺能力显式失败。** 未知 Codex event、缺失 MCP capability、无效 schema 或版本不兼容必须记录并显示明确失败，禁止 fallback 到旧工具或静默丢弃关键状态。
- **APO-08 — Tool schema 是 Agent 的唯一媒体参数说明。** 每个媒体 Operation 以模态专属严格 schema 和字段 description 告知 Placement、Resource schema、引用 channel/role/position 与产品参数；developer instruction 只声明跨工具不变量（异步未就绪、失败不绕过、资产格式由服务端拥有），不得复制一份易漂移参数表。生成结果只有正式 `.resource` pointer 投影为 ready 且 `contentVersion > 0` 后才能被后续引用。

## 权威入口

- Runtime protocol：`src/lib/codex-runtime/runtime-adapter.ts`、`app-server-client.ts`。
- Wao 指令构造与会话：`src/lib/assistant-runtime/**`。
- 原生 item/event → 产品 View：`src/lib/assistant-runtime/event-projector.ts`。
- Skill：`src/lib/creative-skills/**`。
- 业务 tool schema 与执行：`src/lib/wao-mcp/**`、生产 Operation registry。
- UI：`src/features/project-workspace/components/workspace-assistant/**`。

## 验证

必须以钉死的 Codex app-server 版本运行真实协议 smoke，覆盖 initialize、thread start/resume、turn、steer/interrupt、skills/list、request_user_input、plan、search、MCP/command/file/diff、approval、compaction 与 Subagent事件。类型检查只证明本地解析一致，不能替代真实协议。

## 修改检查表

- 是否新增了第二份 Agent runtime、prompt 状态机或文本启发式？
- 新 Codex item 是否同时更新共享 View、projector、i18n renderer 和协议 smoke？
- 新付费能力是否仍由 MCP/Operation schema 校验并冻结输入？
- 是否把整份 Skill 注入主上下文而不是按需读取？
