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
| AI Prompt、Prompt registry、结构化模型输出字段或 raw output 协议 | [AI Prompt 与模型输出契约](modules/ai-prompt-output-contract.md) | prompt catalog、生产 raw schema、parser/normalizer、stream adapter |
| 图片、视频、音乐的报价、确认、提交、扣费 | [计费与审批](modules/billing-approval.md) | billing policy、operation plan、task submitter |
| 创作产物身份、Lineage、Binding、通用媒体卡片 | [创作 Resource 与 Lineage](modules/creative-resource.md) | creative-resource persistence、Task terminal materializer、Resource View |
| 新增或修改 Canvas 节点、节点身份、流式事件、展开态、重放 | [Canvas 节点与流式状态](modules/canvas-node.md) | node id、structured stream adapter、canvas projection、motion presence transition |
| 章节核心剪辑计划、镜头结构、章节 ledger 事实投影 | [章节核心剪辑规划](modules/chapter-planning.md) | chapter input、strict output schema、ledger facts projector |
| 整集 BGM 规划、候选与最终混音 | [BGM 规划、生成与最终混音](modules/audio-production.md) | BgmDesign strict contract、candidate QC、design/timeline fence、final mix |
| route → queue → worker → DB 的任务提交、状态、重试、补偿 | [异步任务生命周期](modules/async-task-lifecycle.md) | task types、submitter、task service |
| Agent run、工具调度、确认、心跳、恢复、任务完成后的继续执行 | [Assistant Run 生命周期](modules/assistant-run-lifecycle.md) | project-agent runtime、operation registry |
| Creative Skill、专业知识发现、无状态 Creative Worker 与主 Agent 委派 | [Creative Skill 与无状态 Worker](modules/creative-skill-worker.md) | Creative Skill registry、Creative Worker、`delegate_creative_work` |
| 联网搜索、OpenAI 托管研究、研究预算、证据归档与不可信网页边界 | [Web Search](modules/web-search.md) | web-search service/provider、`web_search` Operation、Creative Worker research projector |
| provider、模型选择、异步轮询、外部失败与降级 | [Provider Gateway](modules/provider-gateway.md) | ai-providers、ai-exec、ai-registry |
| 注册/登录、顶层导航、语言切换、deployment capability 投影 | [产品外壳、身份与本地化](modules/product-shell.md) | auth/session、i18n navigation、deployment features、Navbar |
| 全局/项目资产的 owner、scope、kind、variant 与复制边界 | [资产 Scope 所有权](modules/asset-scope-ownership.md) | asset scope resolver、asset actions、unified asset operations |
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
