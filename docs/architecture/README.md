# 架构契约目录

这里记录跨功能、跨层且不能依赖记忆维持的一致性规则。它不是实现手册，也不替代类型、状态机或通过准入的验证证据。

## 使用方式

修改业务代码前，先根据改动范围在下表定位模块，阅读对应文档的「设计理念」「不变量」「权威入口」和「验证」。可运行：

```bash
npm run architecture:impact -- <准备修改的文件或目录>
```

命令只负责路由和提示，不能代替验证。实现必须复用文档列出的权威入口，并选择相应的 Golden、Critical、Logic、Conformance 或结构检查；不要求机械新增测试。

| 改动范围 | 必读模块 | 主要权威入口 |
| --- | --- | --- |
| 图片、视频、音乐、音效的报价、确认、提交、扣费 | [计费与审批](modules/billing-approval.md) | billing policy、operation plan、task submitter |
| 新增或修改 Canvas 节点、节点身份、流式事件、展开态、重放 | [Canvas 节点与流式状态](modules/canvas-node.md)；[动效 Presence 收敛](canvas-motion-presence-convergence.md) | node id、structured stream adapter、canvas projection、motion presence transition |
| route → queue → worker → DB 的任务提交、状态、重试、补偿 | [异步任务生命周期](modules/async-task-lifecycle.md) | task types、submitter、task service |
| Agent run、工具调度、确认、心跳、恢复、任务完成后的继续执行 | [Assistant Run 生命周期](modules/assistant-run-lifecycle.md) | project-agent runtime、operation registry |
| provider、模型选择、异步轮询、外部失败与降级 | [Provider Gateway](modules/provider-gateway.md) | ai-providers、ai-exec、ai-registry |
| 注册/登录、顶层导航、语言切换、deployment capability 投影 | [产品外壳、身份与本地化](modules/product-shell.md) | auth/session、i18n navigation、deployment features、Navbar |
| 全局/项目资产的 owner、scope、kind、variant 与复制边界 | [资产 Scope 所有权](modules/asset-scope-ownership.md) | asset scope resolver、asset actions、unified asset operations |
| Golden Journey、关键基础设施场景、纯逻辑规格、registry conformance 与 harness | [测试治理](modules/test-governance.md) | Golden scenario registry、read-only oracle、critical scenarios、admission contract |

## 权威层级

1. 模块文档定义产品/架构决策的**为什么**和不可违背语义。
2. 共享类型、registry、policy、状态机定义机器可执行的**是什么**。
3. 满足准入的真实场景证明用户结果，适用的结构检查证明已知旁路不会静默恢复；两者不能互相冒充。

文档与代码冲突时，不允许在调用方加兼容分支。必须先确认产品决策，再同步收敛文档、权威入口和适用验证证据。

Assistant 的暂停协议（Choice、Approval、Task）发生架构性调整时，还必须阅读 [Assistant Suspension 收敛设计](assistant-suspension-convergence.md) 与 [Assistant 执行段交接收敛](assistant-execution-segment-convergence.md)：执行资格与等待结果是两个事实，不能用 Run status 互相推导；message、卡片、Wait 和 Run 必须作为同一可恢复交接提交。

## 维护规则

- 新增或变更一个模块的语义不变量时，必须同步更新该模块文档、`modules.json`、权威代码和验证。
- 纯局部实现变更不要求机械修改文档；但不得改变文档所述语义。
- 每条不变量应有稳定编号；只有满足测试准入时才要求 executable evidence，并尽可能保留真实历史反例。
- `npm run check:architecture-docs` 校验目录、模块文档、权威入口、已声明测试和结构检查的引用完整性；它不证明产品行为正确。
