<!-- architecture-module: ai-prompt-output-contract -->

# Agent 指令、固定专业子 Agent 与输出契约

## 设计理念

Codex app-server 是唯一通用 Agent Runtime。主 Agent只接收产品边界、当前 locale、Project 工作区约定和 Wao MCP，所有 native Skill 均禁用；Wao Creative Skill 正文只存在于 Registry 生成的固定 custom agent 指令里。

## 指令层级

主 Agent：Codex 内置基础指令 → Runtime 全局 `AGENTS.md` 自主委派授权 → Wao `developerInstructions` → Wao MCP schema → Turn locale/context → 用户消息。

专业子 Agent：Codex 内置基础指令 → 固定 custom agent `developer_instructions`（worker 边界 + 唯一 outputKind JSON Schema + `creative-core` + 一个精确专业 Skill）→ 主 Agent分派的输入路径与一个独占 `.json` 输出路径。专业子 Agent不拥有 Wao MCP。

这是同一 Runtime 的 parent/child 上下文隔离，不是第二套模型循环。

## 不变量

- **APO-01 — 唯一 Runtime。** 聊天、Plan、Goal、request_user_input、搜索、Shell、文件、Skill 与 Subagent 均由 Codex app-server 产生；禁止恢复 Agents SDK 或自研 Worker loop。
- **APO-02 — 主 Prompt 只声明边界。** 主 Agent developer instructions 只说明 scope、工作区所有权、固定 worker 路由、locale 与 MCP 使用原则，不复制 Skill 正文。
- **APO-03 — 固定子上下文。** 专业子 Agent的角色和 Skill 集由 Registry 决定并在载入时注入；description、用户措辞和模型输出不能改变 Skill 集。
- **APO-04 — 结构来自协议。** Plan、Goal、request_user_input、Web Search、命令、Diff、MCP、审批、compaction 与 Subagent 状态只消费 Codex 原生 JSON-RPC item/event。
- **APO-05 — 专业输出是固定 JSON。** 固定专业子 Agent是剧本、方向、长篇计划、资产、视频和音乐 JSON 的唯一 writer；Registry 给每个角色恰好一个 outputKind 和 strict schema，主 Agent不得复制、修复或改写，只能引用路径。Workspace checkpoint 与媒体提交复用同一 schema，不从 Skill 散文猜字段。
- **APO-06 — 业务输入冻结。** `submit_production_manifest` 按 `manifestPath` 读取 ready 文本 Resource，冻结 `resourceId + contentVersion + workspacePath + sha256 + manifestId`，再把其完整 Prompt、参数与引用冻结到 Task payload。
- **APO-07 — 参数分权。** 专业子 Agent拥有完整创作 Prompt 与叙事相关参数（资产 4:3、视频画幅/时长、音乐时长/模式）；系统拥有模型选择、Provider 路由、能力校验、计费、审批、Task 和终态。视频/音乐子 Agent只读取 `system/project.json.productionCapabilities` 的当前只读能力事实，能力为空时不得猜测或交付可执行 Manifest。
- **APO-08 — 缺能力显式失败。** 缺 custom agent、无效 Manifest、未知 event、缺 MCP capability 或版本不兼容必须原地失败；禁止 fallback 到主 Agent创作、直接媒体 MCP 或服务端 Prompt 编译。
- **APO-09 — 用户可见内容本地化。** Wao UI 文案来自 i18n；Agent 输出遵循 Turn locale 或用户明确语言。
- **APO-10 — 不用 Prompt 伪造媒体能力边界。** 主 Agent instructions 与固定专业 Skill 不注入真人、公众人物、人物相似度或照片写实风格禁令。视频与音乐能力只读取 `system/project.json.productionCapabilities` 的声明式事实，执行时的 Provider 审核拒绝只通过统一 typed failure 返回，不得再投影成常驻 Agent 政策。
- **APO-11 — 自主委派使用 Codex 原生指令面。** Wao 在隔离 Codex home 的全局 `AGENTS.md` 明确允许主 Agent自主选择固定 Subagent；不得依赖用户说出实现术语、伪造 user item 或用全局 Ultra 推理等级换取委派权限。固定 Worker 的角色、Skill 和写入范围继续由 custom agent developer instructions 决定。

## 权威入口

- Runtime protocol：`src/lib/codex-runtime/runtime-adapter.ts`、`app-server-client.ts`。
- Parent instructions 与会话：`src/lib/assistant-runtime/**`。
- 固定角色与 Skill 注入：`src/lib/creative-skills/agent-profiles.ts`。
- 原生 item/event → View：`src/lib/assistant-runtime/event-projector.ts`。
- Manifest 契约：`src/lib/workspace-resource/production-manifest.ts`。
- 全部专业 outputKind 契约：`src/lib/creative-skills/output-registry.ts`。
- 只读生产能力投影：`src/lib/codex-workspace/projector.ts` → `system/project.json`。
- 业务执行：Wao MCP → Operation registry → Task/Temporal/Provider。

## 验证

钉死的 Codex app-server smoke 覆盖 initialize、thread start/resume、Turn 和 parent Skill 零暴露；生产 Registry conformance 穷尽 custom agent 与 MCP Operation；Manifest schema 使用独立的声明式约束验证字段分权。

## 历史回归

- 旧视频模型不接收真人时，`HUMAN_VISUAL_SAFETY_POLICY` 曾作为唯一正文注入主 Agent，避免分散到 Creative Skill。后续正文虽缩窄为只禁可识别真人、公众人物和真人相似物，仍把已过期的 Provider 能力限制固化成常驻 Agent 政策。当前模型已支持真人与真实风格，政策文件、导出和主 Agent注入已一并删除；Creative Skill 中不存在同义副本，Provider 自有拒绝继续由 adapter 的 typed failure 表达。
- Codex 固定专业 Worker 首版把“必须委派”写进 Wao developer instructions，却没有落到 Codex 默认多代理策略认可的用户、`AGENTS.md` 或 Skill 指令面。真实普通创作请求因此处于“主 Agent不能写、Subagent 又不能自动启动”的死锁。当前唯一自主委派授权由 Runtime 全局 `AGENTS.md` 提供，Worker Registry 仍是角色选择与专业内容的唯一权威。
- 固定 custom agent 曾只有自然语言交付说明，Skill 内手写示例与执行层 strict schema 分别演化；错误边界又只返回 `Invalid parameters`，模型无法知道应删除哪个字段，转而猜测路径并连续重试。当前 `CREATIVE_OUTPUT_REGISTRY` 是字段契约唯一权威，自动生成的 JSON Schema只注入对应 child；checkpoint/提交失败返回精确字段 correction，主 Agent只能把它交回同一 worker，不能自己改专业文件。
