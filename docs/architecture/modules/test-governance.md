<!-- architecture-module: test-governance -->

# 测试治理

## 设计理念

测试不是代码变更的附件，也不以数量、覆盖率、目录层级或 mutation 分数衡量。唯一目标是用独立 oracle 反证会伤害用户结果或架构不变量的错误实现。

产品行为的最高证据是经过真实浏览器、生产 UI/API/service、MySQL、Redis、队列、worker、Outbox、SSE 和刷新恢复的 Golden Journey。浏览器难以经济、确定性注入的并发、崩溃、事务、重试和外部协议故障，才由关键基础设施测试补充。纯逻辑测试只保护有实际边界空间的 parser、resolver、reducer、policy、状态机、算法和 canonical identity。

## 不变量

- **TG-01 — 独立 oracle。** 期望结果必须来自用户目标、模块不变量、生产 registry 契约或已确认历史事实，不得从当前实现、mock 返回值、源码字符串或调用次数反推。
- **TG-02 — 测试准入。** 修改文件、增加 route、修复 bug 或新增实例都不自动要求新测试。新测试必须符合下方准入契约；优先扩展既有场景或穷尽 registry。
- **TG-03 — 真实主链。** 产品旅程不得 mock 被测系统自己的 UI、route、service、状态机、数据库、队列、worker、SSE 或 projector。只有付费/不可控外部系统和明确故障边界可以用协议兼容替身。
- **TG-04 — 可反证。** 纠正性测试必须证明同一断言在 pre-fix 代码或受控语义故障下失败；把错误值直接传给断言不构成历史路径反证。
- **TG-05 — 权威事实断言。** 行为测试断言用户可见结果和/或只读持久事实。DOM 文案、日志、测试 ledger、文件存在和 scenario 名称不能单独证明业务正确。
- **TG-06 — 真实基础设施。** 关键 integration 使用真实 MySQL/Redis/queue/worker 或真实协议服务器，且动作必须经过生产 owner；setup 可创建隔离前置数据，但不能代替被测动作。
- **TG-07 — 纯逻辑边界。** logic 测试不得 mock 相邻内部层来伪装集成，只允许显式输入到显式输出；getter、透传、call-count、当前映射快照和组件内部实现不准入。
- **TG-08 — 穷尽 conformance。** registry conformance 必须枚举生产 registry，并验证 capability/policy/identity 等真实契约。动态调用后只检查“返回 Response”不构成 conformance。
- **TG-09 — Harness fail-closed。** Golden 场景未挂载、required case 被跳过、依赖不可用、浏览器异常、外部付费调用或只读 oracle 写入都必须显式失败。
- **TG-10 — 执行时机独立。** 本模块定义测试证据和命令，不定义 commit、push、PR、nightly 或 release 的运行时机。Git hooks 保持由独立策略决定。
- **TG-11 — 关键 Journey 契约同步。** 已承担权威证据职责的 Golden/Critical Journey 所覆盖的用户流程、阶段、生产入口、生命周期、终态、失败语义或禁止副作用发生变化时，同一变更必须审计并同步 canonical scenario contract、真实驱动路径与独立 oracle，并实际运行该场景的 canonical command。若 observable 不变，必须记录“不适用 + 原因”并证明原场景仍通过。禁止保留旧语义、删除场景、放宽断言或以 skip/todo 逃避同步；未执行或基础设施不可用只能报告未验证。
- **TG-12 — 架构影响逐文件路由。** 修改前必须用显式目标路径读取适用模块，修改后必须用 `architecture:impact --changed` 逐文件复核 Git 工作区实际变化。router 只按 manifest 展示 path → module → verification 关系，不得根据 changed files 决定测试适用性、接管任务文件或让未映射路径失败；Journey 仍只由模块语义与 TG-11 裁决。
- **TG-13 — 过程文档不持久化。** C/D 前置治理和历史矩阵只存在于当前任务计划或 Git 忽略的临时文件；交付前把长期有效的不变量、根因、旧防线失效原因与盲区压缩进所属模块并删除临时材料。禁止维护 incident 文档库、执行日志、生产 identity 清单或第二份当前契约。

## 准入类别

一个新测试至少属于且只声明一个主类别：

1. **Golden Journey**：P0/P1 用户旅程、稳定交互边界、刷新恢复或真实组合故障。
2. **Critical Infrastructure**：浏览器无法经济且确定性构造的事务、幂等、并发、晚到、重复、崩溃、重试、补偿或外部协议故障。
3. **Logic Specification**：有非平凡边界或组合空间的纯函数、parser、resolver、reducer、policy、状态机、算法或 canonical identity。
4. **Registry Conformance**：同类实例必须穷尽的生产 registry identity/capability/policy 合同。
5. **Harness Self-test**：证明 Golden provider、network policy、read-only oracle、场景挂载和报告器 fail closed。

准入说明必须写明权威来源、会被拒绝的错误实现、生产入口、最终 oracle 和可执行命令。实现与测试可以在同一变更中提交，但纠正性变更必须保留 red/green 证据。

## 权威入口

- 浏览器完整旅程、场景 identity、故障变体、只读 oracle 与 harness：`tests/golden-journey/**`。
- Golden 场景 identity 与预期终态：`tests/golden-journey/contracts/scenarios.ts`；真实驱动路径：`tests/golden-journey/journeys/**`。
- 关键 Task/Assistant/Outbox 并发与事务：`tests/integration/task/**`。
- 外部 provider 协议：`tests/integration/provider/**`。
- 计费事务与并发：`tests/integration/billing/**`、`tests/concurrency/billing/**`。
- Workflow Lab checkpoint 真实性：`tests/golden-journey/journeys/stage-probes.spec.ts` 通过真实浏览器、生产 Route、克隆事务、目标 Session 与后续 UI 动作验证。只有可持久恢复、可重复 fork 且能执行下一真实边界的阶段可进入 checkpoint registry；内部瞬时 workflow enum 只由最长 Journey 覆盖，不得为追求枚举数量伪装成 checkpoint。连续 fork 必须保留最早真实 source，Approval 必须验证 `list → fork → list → fork → consume`，调试项目名必须遵守共享 Project 名称上限。
- 纯逻辑规格：经本模块准入后保留在 `tests/unit/**`；目录名是现有物理位置，不代表恢复“每层都要 Unit”的旧制度。
- 穷尽 registry conformance：`tests/contracts/**`。
- Required Vitest suite 的发现/执行/skip 核对：`scripts/test-verification/run-required-suite.mjs` 与 `verify-vitest-report.mjs`。
- 架构影响路由：`scripts/architecture-impact.mjs`；Git status 解析与 path/module 纯匹配：`scripts/architecture-impact-lib.mjs`。
- 架构结构检查集合：`npm run check:architecture`。
- `scripts/guards/architecture-docs-contract-guard.mjs` 除模块结构外还拒绝 `docs/architecture/incidents/**` 文件和根目录过程性 Markdown，防止临时治理材料重新成为第二文档库。
- `tests/unit/test-verification/architecture-impact.test.ts` 验证 router 对 modified/staged/untracked/rename/copy/delete 的同一 Git snapshot 解析、逐文件模块匹配与未映射结果；它不证明 manifest 的语义覆盖完整。
- 测试命令：`test:logic`、`test:conformance`、`test:critical:*`、`test:golden:*`。这些命令不隐含运行时机。

## 明确删除的旧证据

以下内容不再是架构防线：

- mocked route、component、service、worker 与“mock X 后断言 X”测试；
- route 文件 catalog、behavior ledger、requirements matrix 与测试文件覆盖率；
- synthetic history registry 和手工错误返回值式 fail-before；
- 全仓 mutation baseline、coverage baseline 和相关分数；
- test-size、changed-file-test-impact、route-test-count、behavior-quality guard；
- `unit / integration / system / regression / contracts` 每层都要覆盖的目录制度；
- `test:all`、`test:regression` 等以跑遍旧目录定义完整性的聚合命令；
- API-only long-form runner 作为第二条 Golden Journey。

历史根因、旧防线失效原因和当前防线只在所属模块的「历史回归」中精简保留。需要 executable protection 时，链接到真实 Golden 或 Critical scenario；文档记录本身不伪装成测试。

## 验证与失败语义

Golden Journey 从浏览器启动，setup 后只走生产写入路径，以浏览器观察和只读 durable oracle 共同收口。固定 sleep 不能证明成功；timeout 只负责界定失败。失败、取消、拒绝、重试、重复、晚到、断线、刷新与并发场景必须声明预期 terminal 和禁止的部分副作用。

Critical Infrastructure 测试只开放一个受控故障 seam，并验证真实生产 owner 的事务、idempotency、terminal、compensation 和 recovery。Logic Specification 直接输入事实并断言完整结果。Registry Conformance 从生产 registry 枚举，不维护第二份实例文件清单。

测试基础设施不可用时只能报告未验证，不得宣称对应证据通过。是否以及何时运行这些命令由后续执行策略决定，本阶段不修改 commit/push hooks。

## 历史回归

- 旧体系累计数百个 Unit、mocked Integration、System、Regression 和元测试文件，却未能发现真实 Assistant 组合链缺陷。
- Route catalog 在 mock 鉴权和内部依赖后把“返回一个拒绝 Response”当成场景执行，不能证明 route 业务语义。
- Synthetic history registry 把手工错误常量传给同一断言充当 fail-before，没有执行历史生产路径。
- 全仓 mutation、coverage、test-size、requirements matrix 与 changed-file guard 提高了维护成本，但没有提高真实组合错误的发现率。
- Golden Journey 首次通过真实 Chromium、MySQL、Redis、worker、Outbox、SSE 和刷新组合独立复现了此前绿色测试遗漏的问题，因此成为浏览器完整产品证据的唯一 owner。
- 原 `architecture:impact` 把多个输入路径聚合成一份模块列表，未映射文件会被其他命中路径掩盖；现改为逐文件路由，`--changed` 只复用该 router 复核实际 Git 变化，不恢复 changed-file 测试选择器。
- Golden 环境曾因共享 Compose identity、固定端口和全局 teardown 删除其他工作区服务；现在每次运行拥有独立 scope、动态 loopback endpoint，并在删除数据 scope 前终止自己的进程组。基础设施自测必须证明停止一个 scope 不影响另一个。
- Workflow Lab 曾投影出正确 stage 却丢失 durable interruption、chapter、plan 或未来事实清理，导致 fork 不能执行下一合法动作。checkpoint 只有在 `list → fork → list → fork → consume` 可重复且能通过真实 UI 执行下一边界时才可登记；内部瞬时 enum 不得冒充 checkpoint。

## 修改检查表

1. 已有 Golden、Critical、Logic 或 Conformance 是否已经保护本次事实？
2. 若要新增测试，它属于哪个唯一准入类别？
3. oracle 来自哪里，哪一种具体错误实现会失败？
4. 是否 mock 了错误可能存在的内部层？
5. 纠正性变更是否有 pre-fix 或真实受控故障 red 证据？
6. 断言是否收口到用户结果或权威持久事实？
7. 场景是否被一个明确命令实际发现，且无 skip/todo？
8. 删除旧测试时，它是无效证据，还是需要先由真实场景接管？
9. 本次是否改变了既有 Golden/Critical 所覆盖的流程、入口、生命周期、终态、失败或禁止副作用？若改变，scenario contract、真实驱动路径、独立 oracle 与 canonical command 是否已同步；若未改变，是否记录了“不适用 + 原因”并证明原场景仍通过？
10. 修改前显式目标与修改后 `--changed` 是否均已逐文件路由；未映射路径是否完成不适用/补映射判断，且没有据 changed files 猜测 Journey？
11. 是否把任务计划、临时矩阵、执行日志或生产 identity 提交成永久文档；长期结论是否已压缩到唯一模块契约？
