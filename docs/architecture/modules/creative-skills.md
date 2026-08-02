<!-- architecture-module: creative-skills -->

# Creative Skills

## 设计理念

Creative Skill 是 Codex Runtime 可发现、可按需读取的专业知识，不是第二套 Agent、Task 或结构化输出流水线。主 Agent 可以自己读取 Skill，也可以把目录边界明确的工作交给 Codex 原生 Subagent；两者共享同一个 Project 工作区，最终结果都只是普通 WorkspaceResource。

系统不再拥有 `Creative Worker`、`delegate_creative_work`、output kind registry 或 Worker 专用模型循环。媒体、计费和长期任务仍只能通过 Wao MCP 的正式能力执行。

## 不变量

- **CS-01 — 一个 Skill identity。** `CREATIVE_SKILL_REGISTRY` 是 Wao Skill id、标题、摘要、版本和磁盘目录的唯一声明；加载器只解析 registry 中的 `SKILL.md`，禁止按 Operation 名或任意路径猜测。
- **CS-02 — Skill 只提供知识。** Skill 不拥有项目状态、工具权限、Task、Resource、计费、审批或输出采用权；内容不能创建第二业务入口。
- **CS-03 — 按需读取。** 主 Agent 的 developer instructions 只注入 Skill 目录摘要，不预载全部正文。需要专业判断时由 Codex 读取对应 `SKILL.md`，避免长期占用主上下文。
- **CS-04 — 原生 Subagent。** 并行专业工作只使用 Codex 原生协作协议和 UI 事件，不创建 Wao 自研 Worker。Subagent 必须先获得互斥目录边界；共享全局连续性文件只有主 Agent可写。
- **CS-05 — 普通文件交付。** 剧本、方向、资产表、连续性、分集与镜头计划都写入用户工作区的普通文件/目录；没有 Story Canon、Episode、Chapter 或 Skill output 的系统实体。
- **CS-06 — 语言由用户决定。** Skill 可以使用最适合模型的知识语言，但用户可见文本和工作区交付遵循当前 locale 或用户明确要求。
- **CS-07 — 版本钉死。** Runtime 通过 `skills/list` 读取实际可用 Skill；加载错误必须显式投影，禁止静默换成内置提示词或旧 Worker。

## 权威入口

| 事实或动作 | 唯一入口 |
| --- | --- |
| Skill identity 与版本 | `src/lib/creative-skills/registry.ts` |
| Skill 文件解析 | `src/lib/creative-skills/loader.ts` |
| Runtime 发现 | `RuntimeAdapter.listSkills` / Codex `skills/list` |
| Skill 使用与协作事件 | Codex app-server 原生 item/event；`src/lib/assistant-runtime/event-projector.ts` |
| 创作结果 | WorkspaceResource Catalog 与 Codex workspace checkpoint |

## 并行写入规则

主 Agent 可把独立集、独立镜头组或独立研究目录分派给 Subagent；每个 Subagent 只能写被指派目录。全局设定、共享资产索引、连续性总表和 Production Manifest 由主 Agent 单写。两个协作者不能同时修改同一路径；冲突由 WorkspaceResource checkpoint 的基线校验原地拒绝。

## 验证

- Codex runtime smoke 必须真实验证 `skills/list` 与 Skill 变更刷新。
- Runtime 事件投影必须显示 Subagent Active、Done、失败和详情，不以文本猜状态。
- 结构扫描必须证明旧 Worker、`delegate_creative_work`、Worker output registry 和专用 Task 已删除。

## 修改检查表

- 新 Skill 是否只增加 registry 声明和一份知识文件？
- 是否把 Skill 错当成工具权限、持久状态或强制工作流？
- 并行任务是否有互斥目录，且全局连续性只有一个 writer？
- UI 是否消费 Codex 原生 Skill/Subagent 事件，而不是恢复旧 Worker 卡片？
