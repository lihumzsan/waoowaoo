<!-- architecture-module: test-governance -->

# 测试治理

## 设计理念

自动化测试不是交付税，也不是代码变化的影子副本。仓库只保留少量能以独立 oracle 反证高损失错误的测试；其余验证优先使用类型、静态检查、代码审查、真实运行观察和人工产品复验。

测试文件、覆盖率、通过数量和目录齐全度都不是质量目标。测试若不能指出它会拒绝哪一种真实错误实现，或者其期望只是当前实现、mock、fixture、UI 文案与数据映射的复制，就不应存在。

## 不变量

- **TG-01 — 默认不写测试。** 功能、修复、重构、架构或文档变化均不自动要求新增、修改或补齐测试；不得因为同目录已有测试、历史流程或 CI 形式而同步一份实现副本。
- **TG-02 — 独立 oracle。** 合法期望只能来自数学/算法规格、公开协议、持久事务事实、安全隔离或生产 registry。当前实现输出、mock 返回、调用次数、源码字符串、文件存在、测试名称和旧 fixture 都不是 oracle。
- **TG-03 — 仅四类准入。**
  1. 非平凡纯逻辑：parser、resolver、reducer、policy、状态机、算法、canonical identity；
  2. 关键基础设施：真实数据库/Redis/外部 wire 边界上的资金、事务、并发、幂等、权限、retry、late/replay、补偿或恢复；
  3. Registry Conformance：直接从生产 registry 穷尽枚举 identity、capability 与 policy；
  4. 最小浏览器安全：未登录拒绝、会话恢复、跨用户项目隔离、跨项目资产拒绝。
- **TG-04 — 禁止自证。** 不得 mock 被测系统自己的 route、service、状态机、数据库、queue、worker、SSE 或 projector 后断言该 mock；不得以 `toHaveBeenCalled()`、当前映射/默认值/展示快照、getter、透传或组件内部实现充当行为证据。
- **TG-05 — Critical 使用真实 owner。** 关键基础设施测试必须走生产事务、持久 owner 和正式协议入口，只允许在一个明确外部边界注入故障；数据库或 Redis 不可用时显式失败，不得降级为内存替身。
- **TG-06 — Conformance 不维护第二清单。** Conformance 必须从生产 registry 枚举全集并检查每个成员的必需声明。手写实例名单、当前字段快照和特定产品示例属于重复实现，应删除。
- **TG-07 — 浏览器只保留安全边界。** 不再用脚本模型、脚本媒体 Provider、场景 registry 或复杂产品 Journey 模拟创作行为。LLM 创作质量、自由组合流程和 UI 细节由人工真实产品复验，自动化不得声称覆盖未知模型行为。
- **TG-08 — 失败先审计测试。** 现有测试失败时先证明它到达了有效 oracle。若 fixture 腐烂、语义已删除、断言只复述实现或维护成本高于风险，删除测试及文档/CI 引用；禁止修改生产代码迎合无效测试。
- **TG-09 — 同一作者不等于独立证据。** 实现者可以编写符合准入的测试，但必须明确 oracle 的外部来源和会被拒绝的错误实现。无法说明时不写。
- **TG-10 — Harness fail closed。** retained suite 的 required case 缺失、skip/todo、依赖不可用、浏览器异常或报告不完整必须显式失败；未运行只能报告未验证。Harness 自行启动的长期进程必须持有 canonical process identity，成功、失败与取消都只有在整个进程树已确认退出后才算完成；只发送终止信号或只观察直接子进程退出不构成清理成功。
- **TG-11 — 无隐式挂载。** Git hooks 不运行测试。CI 只运行本模块列出的保留集合；任何新增测试都必须先更新本模块的准入说明，而不是靠目录匹配自动扩张。
- **TG-12 — 如实交付。** 交付只列实际执行的命令、结果和盲区。不得用未执行、已删除或只自证的测试暗示产品行为已验证。
- **TG-13 — 静态检查必须覆盖真实入口。** `npm run typecheck`除应用源码外，还必须通过
  `tsconfig.runtime-scripts.json`穷尽列出`package.json`实际以`tsx`运行的运维、迁移、备份、
  校验与测试服务TypeScript入口。不得以已删除脚本、生成文件或空include让第二段检查表面
  成功；新增/删除runtime script必须同步这一唯一清单。

## 保留集合与权威入口

| 类别 | 入口 | 保留理由 |
| --- | --- | --- |
| Logic | `npm run test:logic` | 独立规格的纯逻辑、状态机、算法、identity，以及 retained harness 的 fail-closed 校验 |
| Conformance | `npm run test:conformance` | 从生产 Task、Operation、Canvas、Provider 等 registry 穷尽检查接线 |
| Provider Critical | `npm run test:critical:provider` | 真实 adapter/wire 协议、零隐式重提与明确失败 |
| Task Critical | `npm run test:critical:task` | 真实 MySQL/Redis 的 Task/Operation 提交原子性、幂等、并发与账本边界 |
| Temporal Critical | `npm run test:critical:temporal` | 真实 Temporal 1.31.2 + MySQL 的 Workflow/Activity、Worker 丢失、heartbeat、ACK 丢失与跨系统重放 |
| Billing Critical | `npm run test:critical:billing`、`npm run test:critical:billing-concurrency` | 余额、冻结、结算、Stripe 逆向资金事件与并发账本 |
| Security Critical | `npm run test:critical:security` | 真实 owner/scope、媒体读取与跨项目写入拒绝 |
| Browser Security | `npm run test:security` | 四个最小 authenticated/unauthenticated 权限边界 |

`npm run test:critical` 只聚合上述 Critical 子集。仓库没有 `test:journey`、Golden scenario registry、脚本模型 Provider 或创作行为自动化入口。

Temporal Critical 只有在 `TEMPORAL_TEST_BOOTSTRAP=1` 时才激活
`docker-compose.test.yml` 的 `temporal` profile。该 profile 在当前 worktree 的独立
Compose project 中启动真实 Temporal Server、专用 `temporal`/`temporal_visibility`
MySQL schema 和测试 namespace，并向测试进程注入随机本机端口；其他保留集合不得隐式
启动 Temporal。依赖或 namespace 未就绪必须失败，禁止退回 mock server 或内存 Workflow。

## 新测试准入记录

新增测试前只需在变更说明中回答四个问题，不创建长期表格或 ledger：

1. 属于 TG-03 的哪一类？
2. 独立 oracle 来自哪里？
3. 会拒绝哪一种具体且高损失的错误实现？
4. 为什么现有类型、静态检查、人工复验或保留测试不足？

任一问题答不清即不新增。修复提交不要求“先红后绿”，但也不得把人工构造错误常量直接传入断言冒充回归证据。

## 历史回归

- 旧测试系统长期把测试数量、mutation 分数和目录覆盖当质量目标；大量 route 测试在鉴权 mock 后即返回，业务路径从未执行。测试与生产代码同步变化，却没有独立发现真实缺陷。
- 旧 Golden Journey 用脚本模型和脚本媒体 Provider 重放预先写好的创作顺序。它能证明 harness 与自身 fixture 一致，却不能发现真实模型的未知组合行为，并持续要求业务变更同步 scenario、driver、oracle 和 provider policy。
- CI 长期常红后仍继续开发，说明红灯已失去阻塞语义。保留集合必须始终可解释：失败要么修复真实缺陷，要么删除失效测试，不允许把常红当正常状态。
- 过去纠正性提交中的测试多数是修复后的同步工作，而不是缺陷发现来源。当前取消“任何修复都补测试”的默认要求，把维护预算集中在资金、并发、幂等、权限和生产 registry 漏接。
- `afd320ca` 精简 Golden Journey 时保留了四项浏览器安全边界，但同时删除了环境协调器、退出等待和超时强制终止。Playwright 结束后，已脱离的 Turbopack Next 进程组因直接子进程先退出而成为 PID 1 的孤儿，继续重连已销毁的 MySQL/Redis，并长期占用 CPU 与 IOAccelerator 内存。当前防线由环境进程统一持有 app process-group identity，正常结束通过带令牌的协调器请求 owner 清理，失败或取消等待整个进程树退出并在超时后强制终止；global teardown 只在 owner 不可用时按同一 identity 恢复清理。该防线已覆盖 macOS 实际进程组路径，Windows `taskkill /T` 分支仍只有静态验证。
- `ee0d9070`删除独立log cleanup进程时，`tsconfig.runtime-scripts.json`仍只include已删除的
  `scripts/log-cleanup.ts`和未跟踪的Next生成声明；当工作区恰有`next-env.d.ts`时第二段
  typecheck可以成功却没有检查任何runtime script，干净worktree才以TS18003暴露。当前配置
  直接枚举`package.json`真实tsx入口，删除生成文件占位；空输入和漏接新脚本都不能继续
  冒充静态验证。首次真正检查随即发现两份图片健康脚本仍引用已删除的三类旧Task；它们现
  只观察生产registry中实际触达outbound image边界的`workspace_resource_image +
  workspace_resource_video`，没有旧枚举兼容或双读。

## 修改检查表

1. 是否默认选择了不新增测试？
2. 保留或新增的测试是否有实现之外的独立 oracle？
3. 是否仍存在脚本创作 Journey、映射快照、mock 自证或重复清单？
4. 失败测试是否先完成有效性审计，而不是让生产代码迁就它？
5. CI 与 package scripts 是否只指向本页保留集合？
6. 实际验证与未验证范围是否如实说明？
7. package中的TypeScript runtime script是否同步进入`tsconfig.runtime-scripts.json`？
