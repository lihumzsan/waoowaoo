<!-- architecture-module: ai-prompt-output-contract -->

# Agent 指令、固定专业子 Agent 与输出契约

## 设计理念

Codex app-server 是唯一通用 Agent Runtime。主 Agent只接收产品边界、当前 locale、Project 工作区约定和 Wao MCP，所有 native Skill 均禁用；Wao Creative Skill 正文只存在于 Registry 生成的固定 custom agent 指令里。

## 指令层级

主 Agent：Codex 内置基础指令 → Wao `developerInstructions` → Wao MCP schema → Turn locale/context → 用户消息。

专业子 Agent：Codex 内置基础指令 → 固定 custom agent `developer_instructions`（worker 边界 + 精确 Skill 正文 + 交付契约）→ 主 Agent分派的输入/输出路径。专业子 Agent不拥有 Wao MCP。

这是同一 Runtime 的 parent/child 上下文隔离，不是第二套模型循环。

## 不变量

- **APO-01 — 唯一 Runtime。** 聊天、Plan、Goal、request_user_input、搜索、Shell、文件、Skill 与 Subagent 均由 Codex app-server 产生；禁止恢复 Agents SDK 或自研 Worker loop。
- **APO-02 — 主 Prompt 只声明边界。** 主 Agent developer instructions 只说明 scope、工作区所有权、固定 worker 路由、locale 与 MCP 使用原则，不复制 Skill 正文。
- **APO-03 — 固定子上下文。** 专业子 Agent的角色和 Skill 集由 Registry 决定并在载入时注入；description、用户措辞和模型输出不能改变 Skill 集。
- **APO-04 — 结构来自协议。** Plan、Goal、request_user_input、Web Search、命令、Diff、MCP、审批、compaction 与 Subagent 状态只消费 Codex 原生 JSON-RPC item/event。
- **APO-05 — 专业输出先落文件。** 固定专业子 Agent是剧本、方向、提示词和 Manifest 的 writer；主 Agent不得复制或改写，只能引用路径。
- **APO-06 — 业务输入冻结。** `submit_production_manifest` 按 `manifestPath` 读取 ready 文本 Resource，冻结 `resourceId + contentVersion + workspacePath + sha256 + manifestId`，再把其完整 Prompt、参数与引用冻结到 Task payload。
- **APO-07 — 参数分权。** 专业子 Agent拥有完整创作 Prompt 与叙事相关参数（资产 4:3、视频画幅/时长、音乐时长/模式）；系统拥有模型选择、Provider 路由、能力校验、计费、审批、Task 和终态。视频/音乐子 Agent只读取 `system/project.json.productionCapabilities` 的当前只读能力事实，能力为空时不得猜测或交付可执行 Manifest。
- **APO-08 — 缺能力显式失败。** 缺 custom agent、无效 Manifest、未知 event、缺 MCP capability 或版本不兼容必须原地失败；禁止 fallback 到主 Agent创作、直接媒体 MCP 或服务端 Prompt 编译。
- **APO-09 — 用户可见内容本地化。** Wao UI 文案来自 i18n；Agent 输出遵循 Turn locale 或用户明确语言。

## 权威入口

- Runtime protocol：`src/lib/codex-runtime/runtime-adapter.ts`、`app-server-client.ts`。
- Parent instructions 与会话：`src/lib/assistant-runtime/**`。
- 固定角色与 Skill 注入：`src/lib/creative-skills/agent-profiles.ts`。
- 原生 item/event → View：`src/lib/assistant-runtime/event-projector.ts`。
- Manifest 契约：`src/lib/workspace-resource/production-manifest.ts`。
- 只读生产能力投影：`src/lib/codex-workspace/projector.ts` → `system/project.json`。
- 业务执行：Wao MCP → Operation registry → Task/Temporal/Provider。

## 验证

钉死的 Codex app-server smoke 覆盖 initialize、thread start/resume、Turn 和 parent Skill 零暴露；生产 Registry conformance 穷尽 custom agent 与 MCP Operation；Manifest schema 使用独立的声明式约束验证字段分权。
