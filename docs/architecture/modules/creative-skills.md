<!-- architecture-module: creative-skills -->

# Creative Skills

## 设计理念

Codex app-server 是唯一 Agent Runtime。Wao 不维护第二套 Creative Worker 循环，但专业创作也不依赖主 Agent的上下文或 Skill 语义猜测：服务端 Registry 把每个 `workerKind` 确定性绑定到一个 Codex custom agent 和固定 Skill 集，Runtime 启动时把这些 Skill 正文只注入对应子 Agent 的 `developer_instructions`。

主 Agent不安装、不投影、不读取 Wao Creative Skill；它只理解工作区、用户目标和 Wao MCP，负责为固定专业子 Agent划定输入与互斥输出路径，并按路径提交后者写好的 Production Manifest。

## 不变量

- **CS-01 — Skill identity 单一。** `CREATIVE_SKILL_REGISTRY` 是 Skill id、版本和磁盘正文的唯一声明；加载器只读取 Registry 中的 `SKILL.md`。
- **CS-02 — Worker 路由确定。** `CREATIVE_WORKER_REGISTRY` 是 `workerKind → agentType → 固定 Skill IDs → 交付契约` 的唯一声明。Skill description 只供解释，不能参与正确性、隐式路由或 fallback。
- **CS-03 — 主 Agent零 Skill。** Wao Skill 不进入 Project 文件树、`$CODEX_HOME/skills`、主 Agent developer instructions 或主 Agent Tool schema；钉死 Codex 版本自带的 native Skills 也由生成的 `config.toml` 全部禁用。每 Turn 不做 Skill inventory admission；Runtime smoke 发现任何 enabled Skill 都失败。
- **CS-04 — 子 Agent固定注入。** 每个 custom agent 只收到 `creative-core + 一个专业 Skill` 的完整正文；不得发现或加载其他 Wao Skill。子 Agent的 Wao MCP 必须禁用，因此不能直接花费、审批、创建 Task 或执行媒体生产。
- **CS-05 — 专业内容单 writer。** 被选定的专业子 Agent独占其交付文件。主 Agent只检查文件存在、路径和提交前置条件，不复制、续写或改写专业内容。并行子 Agent必须写互斥路径；长篇共享连续性由 `wao_long_form` 单写。
- **CS-06 — 普通文件交付。** 剧本、方向、连续性、最终提示词和 Production Manifest 都是普通 WorkspaceResource。没有 Skill output、Creative Worker Task、Episode、Chapter 或 Canon 系统实体。
- **CS-07 — Manifest 是执行连接件。** 资产、视频、音乐子 Agent把完整最终 Prompt 与显式生成参数写入 JSON Manifest；主 Agent只有 `submit_production_manifest({manifestPath})` 这一条新媒体生产入口。视频/音乐角色必须同时读取 `system/project.json` 中对应的非空 `productionCapabilities`，不从示例或模型名猜能力。服务端只校验、冻结和执行，不补写创作内容。
- **CS-08 — 原生生命周期。** 创建、等待、中断和完成只消费 Codex 原生 Subagent item/event，并投影到现有 UI；禁止恢复旧 Worker 卡片或第二状态机。
- **CS-09 — 语言由用户决定。** Skill 可以使用适合模型的知识语言，但用户可见文本和工作区交付遵循当前 locale 或用户明确要求。

## 固定角色

| workerKind | agentType | 固定 Skill 集 | 交付 |
| --- | --- | --- | --- |
| story | `wao_story` | creative-core + story-development | 剧本文件 |
| long_form | `wao_long_form` | creative-core + long-form-production | 连续性与长篇生产索引 |
| direction | `wao_direction` | creative-core + creative-direction | Creative Direction |
| assets | `wao_assets` | creative-core + asset-development | 资产设计与资产 Production Manifest |
| video | `wao_video` | creative-core + video-direction | 视频 Production Manifest |
| music | `wao_music` | creative-core + music-direction | 音乐 Production Manifest |

## 权威入口

| 事实或动作 | 唯一入口 |
| --- | --- |
| Skill identity 与正文 | `src/lib/creative-skills/registry.ts`、`loader.ts` |
| Worker identity、路由与 custom agent 配置 | `src/lib/creative-skills/agent-profiles.ts` |
| Runtime 配置物化 | `src/lib/assistant-runtime/runtime-persistence.ts` |
| 主 Agent路由边界 | `src/lib/assistant-runtime/runtime-access.ts` |
| 专业交付 | WorkspaceResource checkpoint |
| 媒体提交 | `submit_production_manifest({manifestPath})` |
| Subagent 生命周期 | Codex app-server item/event → `event-projector.ts` |

## 验证

- Runtime smoke 必须证明主 Agent的 `skills/list` 没有任何 enabled Skill，并证明每个固定 custom agent 文件只嵌入 Registry 声明的 Skill 且禁用 Wao MCP。
- Registry conformance 必须证明直接 image/audio/video Operation 不进入 MCP，Manifest 仍是唯一 MCP 新媒体入口。
- Manifest schema 必须拒绝资产 kind/schema 不匹配、资产非 4:3、重复 item/path/reference position 和缺失最终 Prompt。

## 历史回归

- 首版 Codex 接管把全部七份 Skill 投影进 `system/skills`，再安装到主 Agent的 `$CODEX_HOME/skills`，并允许主 Agent“自己读取或委派”。这让 Skill 选择变成 best-effort 语义猜测，也让主上下文重新承担全部专业方法；每 Turn inventory 校验只证明文件加载，不证明选对。当前版本删除投影、安装和 Turn admission，改为固定 worker Registry 在 custom agent 创建前直接注入精确正文。
- 服务端 Asset Format Policy 曾依据 `schemaId` 猜资产类型、拼接创作 Prompt 并覆盖 4:3。它与 Agent形成第二个创作 writer，且让测试无法区分 Skill 效果。当前资产专业子 Agent写完整 Prompt 和显式 4:3 参数；服务端只做严格验证与冻结。
- Codex custom agent 首次接管时只注入 Skill 正文，却没有恢复旧 Worker 的 `productionContext`，视频与音乐角色仍被要求遵守一份不存在的能力输入，只能从示例猜时长和引用上限。当前 Project Runtime 把已配置模型 Registry 的能力派生为只读 `system/project.json.productionCapabilities`；主 Agent必须把该固定路径列为视频/音乐角色输入，执行层仍按提交时当前配置重新严格校验。
- Session Manager 曾把 Subagent child Thread 的 Turn 事件误判成 parent identity 漂移并恢复整个 Runtime。当前 parent slot 只消费已映射 Product Thread，Subagent 生命周期继续由原生协作事件进入产品 View。
