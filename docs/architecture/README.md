# 架构契约目录

这里记录跨功能、跨层且不能依赖记忆维持的一致性规则。它不是实现手册，也不替代类型、状态机或通过准入的验证证据。

## 使用方式

修改业务代码前，先根据改动范围在下表定位模块，阅读对应文档的「设计理念」「不变量」「权威入口」和「验证」。可运行：

```bash
npm run architecture:impact -- <准备修改的文件或目录>
```

实现完成后再逐文件复核实际工作区变化：

```bash
npm run architecture:impact -- --changed
```

`--changed` 包含 tracked modified、staged、untracked、renamed 与 deleted 路径，但只提供只读路由；它不决定验证方式、当前任务所有权或提交范围。未映射路径正常报告且不失败，执行者必须根据真实语义明确“不适用”或补充模块映射。命令不能代替验证，不能根据 changed files 猜测测试；实现必须复用文档列出的权威入口，并按风险选择最低成本的有效验证。

| 改动范围 | 必读模块 | 主要权威入口 |
| --- | --- | --- |
| Temporal、Thread/Turn 执行许可、长期 Task 调度、恢复与跨系统交接 | [Temporal 持久执行边界](modules/durable-execution.md) | Thread Coordinator、TaskWorkflow、SchedulerWorkflow、业务幂等账本 |
| Agent 指令、Skill、结构化模型输出字段或 raw output 协议 | [Agent 指令、Skill 与模型输出契约](modules/ai-prompt-output-contract.md) | Runtime instructions、Skill registry、生产 raw schema、parser/normalizer、MCP adapter |
| 图片、视频、音乐的报价、确认、提交、扣费 | [计费与审批](modules/billing-approval.md) | billing policy、operation plan、task submitter |
| 创作目录、Resource 身份、内容版本、Lineage、Placement 与媒体卡片 | [Workspace Resource 树](modules/workspace-resource.md) | WorkspaceResource Catalog、对象存储内容、Task terminal materializer、Resource View |
| Canvas 文件夹导航、direct children、节点身份、卡片投影、folder-scoped layout 或大规模渲染 | [Canvas 节点与流式状态](modules/canvas-node.md) | WorkspaceResource View、node registry、folderKey layout、ReactFlow projection |
| 整集 BGM 规划、候选与最终混音 | [BGM 规划、生成与最终混音](modules/audio-production.md) | BgmDesign strict contract、candidate QC、design/timeline fence、final mix |
| Operation → Temporal → Activity → DB 的任务提交、attempt、恢复与终态 | [Temporal 异步 Task 生命周期](modules/async-task-lifecycle.md) | Task registry、TaskWorkflow、SchedulerWorkflow、Terminal Service |
| Agent Thread/Turn、原生交互、审批、中断、steer 与任务完成后的新 Turn | [Assistant Thread、Turn 与交互生命周期](modules/assistant-run-lifecycle.md) | AssistantRuntime、Runtime Session Manager、Codex event projector |
| Codex app-server、临时 Workspace、Wao MCP 与生产隔离 | [Codex Creative Runtime](modules/codex-runtime-rollout.md) | RuntimeAdapter、Session Manager、Workspace materialize/capture、MCP 投影 |
| Creative Skill、专业知识发现与 Codex 原生 Subagent | [Creative Skills](modules/creative-skills.md) | Creative Skill registry、Codex skills/list、原生协作事件 |
| Codex 原生联网搜索、搜索事件投影与不可信网页边界 | [Web Search](modules/web-search.md) | Codex app-server Web Search、Assistant View projector |
| provider、模型选择、异步轮询、外部失败与降级 | [Provider Gateway](modules/provider-gateway.md) | ai-providers、ai-exec、ai-registry |
| 注册/登录、顶层导航、语言切换、deployment capability 投影 | [产品外壳、身份与本地化](modules/product-shell.md) | auth/session、i18n navigation、deployment features、Navbar |
| 全局 Asset Hub 的 owner、kind、variant 与媒体访问边界 | [资产 Scope 所有权](modules/asset-scope-ownership.md) | asset scope resolver、asset actions、Asset Hub operations |
| 结构化日志、log context、审计通道与告警命名空间 | [日志与可观测性](modules/logging-observability.md) | logging core 唯一 write、semantic helpers、log context |
| 自动化测试准入、保留集合、关键基础设施、registry conformance 与最小浏览器安全 | [测试治理](modules/test-governance.md) | admission contract、retained suites、critical scenarios、security browser harness |

## 权威层级

1. 模块文档定义产品/架构决策的**为什么**和不可违背语义。
2. 共享类型、registry、policy、状态机定义机器可执行的**是什么**。
3. 满足准入的真实场景证明用户结果。

文档与代码冲突时，不允许在调用方加兼容分支。必须先确认产品决策，再同步收敛文档、权威入口和适用验证证据。

## 维护规则

- 新增或变更一个模块的语义不变量时，必须同步更新该模块文档、`modules.json`、权威代码和验证。
- 纯局部实现变更不要求机械修改文档；但不得改变文档所述语义。
- 每条不变量应有稳定编号；只有满足测试准入时才要求 executable evidence，并尽可能保留真实历史反例。
- 架构变更前置治理分析属于当前任务过程，可存在于任务计划或 Git 忽略的临时文件；完成后只把长期有效的不变量、权威入口、历史根因与盲区压缩进所属模块，禁止建立永久 process/incident 文档库。
