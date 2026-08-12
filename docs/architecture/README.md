# 架构契约目录

这里只记录**实现怎么变都不会变**的东西：跨功能、跨层、且违反后果是钱、数据或越权的约束。

它不是实现手册，不替代类型、registry、状态机或代码。**读代码能得到的答案，不该来这里找。**

## 使用方式

修改业务代码前，按改动范围在下表定位模块，读它的「为什么是这样」和「不变量」。可运行：

```bash
npm run architecture:impact -- <准备修改的文件或目录>
```

`--changed` 可对工作区实际变化逐文件复核。它只提供只读路由，不决定验证方式、任务所有权或提交
范围；未映射路径正常报告且不失败，由执行者判断"不适用"或补充映射。

| 改动范围 | 必读模块 |
| --- | --- |
| 执行许可、长期 Task 调度、恢复与跨系统交接 | [Temporal 持久执行边界](modules/durable-execution.md) |
| Task 提交、attempt、Provider 幂等与终态 | [Temporal 异步 Task 生命周期](modules/async-task-lifecycle.md) |
| 报价、审批、扣费、余额与订阅 | [计费与审批](modules/billing-approval.md) |
| provider/模型选择、异步轮询、外部失败与出站边界 | [Provider Gateway](modules/provider-gateway.md) |
| 资源身份、内容版本、Lineage、Placement 与工作区写回 | [Workspace Resource 树](modules/workspace-resource.md) |
| 全局 Asset Hub 的 owner、kind、variant 与媒体访问边界 | [资产 Scope 所有权](modules/asset-scope-ownership.md) |
| Canvas 节点身份、投影、布局与直接动作 | [Canvas 节点与投影](modules/canvas-node.md) |
| Thread/Turn、审批、中断、steer 与任务完成后的新 Turn | [Assistant Thread 与 Turn](modules/assistant-run-lifecycle.md) |
| Runtime 隔离、placement、workspace 同步与能力桥 | [Codex Creative Runtime](modules/codex-runtime-rollout.md) |
| 生产发布、Worker 切换、主机缓存、镜像与数据库备份治理 | [生产发布与主机治理](modules/production-operations.md) |
| Agent 指令层级、原生 Skill 与结构化输出契约 | [指令与输出契约](modules/ai-prompt-output-contract.md) |
| Creative Skill、专业领域路由与主 Agent 输出 | [Creative Skills](modules/creative-skills.md) |
| 联网搜索入口、证据边界与计费身份 | [Web Search](modules/web-search.md) |
| 音乐、音色与确定性混音 | [音频生产](modules/audio-production.md) |
| 注册登录、顶层导航、语言切换、部署能力投影 | [产品外壳、身份与本地化](modules/product-shell.md) |
| 结构化日志、审计通道与告警命名空间 | [日志与可观测性](modules/logging-observability.md) |
| 自动化测试准入与保留集合 | [测试治理](modules/test-governance.md) |

## 权威层级

1. 模块文档定义**为什么**和不可违背语义。
2. 共享类型、registry、policy、状态机定义机器可执行的**是什么**。
3. 真实运行与人工复验证明用户结果。

文档与代码冲突时，不允许在调用方加兼容分支。先确认产品决策，再同步收敛文档与权威入口。

## 什么可以写进这里

每个模块只有四节，顺序固定：

| 节 | 内容 |
| --- | --- |
| 为什么是这样 | 否定式决策——我们**不**做 X，因为 Y。这是全篇密度最高的部分 |
| 不变量 | 违反后果是钱、数据或越权的约束，编号稳定 |
| 权威入口 | 谁是唯一 writer / 唯一裁判，目录级指向 |
| 踩过的坑 | 症状 → 根因 → 现在靠什么防住。一条一行 |

一条内容想进来，必须同时通过三问：

1. **它能被一个 check 脚本强制吗？** 能 → 去写脚本，不要写在这里。仓库已有
   `check:pricing-catalog`、`check:capability-catalog`、`check:model-config-contract`、
   `check:media-normalization`、`architecture:durable-budget` 五个先例。
2. **实现改了它要不要跟着改？** 要 → 它是实现的副本，不是契约，别写。
3. **违反的后果是钱、数据还是越权？** 都不是 → 那是代码风格，属于 `AGENTS.md` 或 review。

因此这里**永远不写**：具体秒数、阈值、超时值；当前实例枚举（registry 才是权威）；文件清单；
时序图与失败矩阵；验证计划；修改检查表；已完成迁移的"必须删除"清单。

## 维护规则

- 只有**新增或删除一条不变量**时才改文档。实现细节变化不动文档。
- 不变量编号稳定，删除后不复用；缺号是正常的。
- 「踩过的坑」只记录损失是钱/数据/越权的事故，或同一不变量的换形式复发。写清楚**上一版为什么
  没防住**——只写"现在的实现是 X"没有价值，那是实现的副本。
- 治理过程分析属于任务过程，放在任务计划或 Git 忽略的临时文件里；只有长期有效的结论进入模块，
  不建立永久 process/incident 文档库。
