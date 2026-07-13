<!-- architecture-module: test-governance -->

# 测试治理

## 设计理念

测试的目标不是增加数量，而是用最少的独立证据反证会伤害用户结果或架构不变量的错误实现。证据只分为 Fast、Critical 和 Journey 三层；Harness 是 Journey 的隔离运行环境，不是第四类产品测试。

产品行为的最高证据是一条从空项目到最终视频的真实 Playwright 主 Journey。浏览器难以经济、确定性注入的事务、并发、崩溃、重试和协议故障由 Critical 补充；纯函数与生产 registry 契约由 Fast 补充。禁止按 workflow 阶段复制产品、克隆 checkpoint 或维护第二条下游主线。

## 不变量

- **TG-01 — 独立 oracle。** 期望结果来自用户目标、模块不变量、生产 registry 或已确认历史事实，不得从当前实现、mock 返回值、源码字符串、文件名或调用次数反推。
- **TG-02 — 测试准入。** 修改生产代码不自动要求新增测试。新证据只能是主 Journey、必要安全 Journey、Critical Infrastructure、非平凡 Logic、Registry Conformance 或 Harness fail-closed 自测。
- **TG-03 — 真实主链。** Journey 不得 mock 被测系统自己的 UI、route、service、状态机、数据库、队列、worker、Outbox、SSE 或 projector。只替代付费或不可控外部模型与媒体系统。
- **TG-04 — 一个产品主线。** 创作产品只有 `GJ-MAIN-STORY-TO-FINAL-DELIVERABLE` 一条主 Journey。它从空项目开始，至少生成两个章节和多个资产，经过最终成片，并在核心 processing 阶段刷新。
- **TG-05 — 权威事实断言。** 主 Journey 同时断言浏览器无异常和只读持久事实：章节、逐章脚本、逐章镜头执行计划、多个资产需求、最终输出与持久 identity 无重复。只看到按钮、文案或最终页面不算完成。
- **TG-06 — 最小安全边界。** 未登录、跨用户项目、跨项目资产三个所有权边界保留为独立 Journey，因为创作主线无法自然反证它们；普通 CRUD、i18n、部署展示等不得各建一条浏览器产品线。
- **TG-07 — Critical 负责故障语义。** 事务、幂等、并发、晚到、重复、断线、重试、补偿和 provider 故障使用真实基础设施与生产 owner，只开放一个明确故障 seam，不再通过阶段克隆驱动浏览器变体。
- **TG-08 — Fast 只保留真实规格。** Logic 只允许有非平凡边界的纯函数、parser、resolver、reducer、policy、状态机、算法和 canonical identity；Conformance 必须从生产 registry 穷尽枚举，不维护第二份实例清单。
- **TG-09 — Harness fail-closed。** 每次 Journey 运行必须拥有独立 runtime identity，并隔离 MySQL/Redis scope、端口、Next `distDir`、上传目录与报告目录；这些生成目录必须同时被 Git 与源码 lint 排除，使 `test:journey → verify:push` 的 canonical 顺序只验证源码且结果稳定。场景未挂载、依赖不可用、浏览器异常、外部付费调用或只读 Oracle 可写必须显式失败。
- **TG-10 — Harness 不是产品旁路。** Harness 只启动隔离环境、协议兼容外部替身、网络限制、只读 Oracle 和报告器；不得提供生产 Workflow 克隆、阶段跳转、强制工具或写入业务事实的捷径。
- **TG-11 — 纠正性反证。** 修复测试必须证明同一断言在 pre-fix 代码或真实受控语义故障下失败；把错误常量传入断言、mock X 再断言 X 不构成反证。
- **TG-12 — 权威 Journey 同步。** 主 Journey 或安全 Journey 所覆盖的流程、入口、生命周期、终态或禁止副作用改变时，必须同步 scenario、真实驱动与 Oracle，并实际运行 `npm run test:journey`；未执行只能报告未验证。
- **TG-13 — 执行时机独立。** 本模块定义证据和 canonical command；CI 可显式调用这些命令，Git hooks 不得隐式挂载完整测试。
- **TG-14 — 架构影响逐文件路由。** 修改前用明确路径运行 `architecture:impact`，修改后用 `architecture:impact --changed` 逐文件复核。router 不决定测试适用性或任务所有权。
- **TG-15 — 过程材料不持久化。** 临时历史矩阵与治理分析不进入仓库；长期有效的根因、防线和盲区只压缩进所属模块。

## 权威入口

- Fast：`npm run test:fast`，聚合 `test:logic` 与 `test:conformance`。
- Critical：`npm run test:critical`，聚合 provider、Task、billing 与 billing concurrency 的真实基础设施场景。
- Journey：`npm run test:journey`，先运行 Harness 自测与隔离检查，再运行一条多章节主线和三个安全边界。
- 主 Journey：`tests/golden-journey/journeys/mainline-complete.spec.ts`。
- 安全边界：`auth-project-permission.spec.ts` 与 `asset-hub-ownership.spec.ts`。
- Scenario identity：`tests/golden-journey/contracts/scenarios.ts`。
- 只读持久 Oracle：`tests/golden-journey/oracle/**`。
- 隔离环境、网络、外部协议替身和 Playwright 报告：`tests/golden-journey/runtime/**`、`providers/**`、`browser/**`。
- Critical：`tests/integration/provider/**`、`tests/integration/task/**`、`tests/integration/billing/**`、`tests/concurrency/billing/**`。
- Logic 与 Conformance：`tests/unit/**`、`tests/contracts/**`。
- Required suite 的 discovery/skip 核对：`scripts/test-verification/run-required-suite.mjs` 与 `verify-vitest-report.mjs`。

## 明确删除的旧证据

- Workflow Lab 的生产 UI、API、领域克隆与测试 checkpoint；
- stage probe、checkpoint staircase、Matrix、Discovery、downstream continuation 与浏览器故障变体；
- API-only long-form runner、mocked route/component/service/worker 和“mock X 后断言 X”；
- route catalog、requirements matrix、synthetic history registry、覆盖率与 mutation 数量目标；
- `unit / integration / system / regression / contracts` 每层机械补齐的目录制度；
- 自定义历史报告数据库；每次 Playwright 运行只写自己隔离目录内的 JSON、HTML、trace、截图和失败视频。

## 验证与失败语义

主 Journey setup 后只走生产写入路径。它使用稳定产品 selector，不使用 Browser Use、视觉模型或 AI 元素选择作为可重复证据。固定 sleep 只能形成可观察窗口，不能证明成功；成功必须收口到浏览器结果和只读持久事实。

外部模型替身生成最小但不平凡的数据：至少两个可独立锚定的故事块，派生两个章节与多个资产。核心 processing 阶段刷新后必须恢复或前进；Style Bible、并行章节/资产、逐章镜头计划和媒体生成必须观察其 canonical Canvas identity。最终只允许一个 durable final output。

基础设施不可用、场景 skip/todo、浏览器崩溃或 paid provider 泄漏都属于失败，不得以“未发现产品错误”宣称通过。

## 历史回归

- Golden 已使用独立 `.next-golden/<runtime>` 与 `artifacts/golden-journey/runs/<runtime>` 防止运行间竞争，但 ESLint 只排除了 `.next` 与 `.next-verify`；完整 Journey 通过后再运行 `verify:push` 会把数十万行 Turbopack 编译产物和 Playwright trace 当源码，先耗尽默认 heap，扩大 heap 后再报告生成代码错误。当前全局 lint ignore 与 Git ignore 共同排除这两类 Golden 运行产物，不放宽任何源码规则；防线是 canonical 顺序下 `test:journey` 后实际运行 `verify:push`。

- 旧体系拥有大量 mock、分阶段和变体测试，却经常在更早阶段失败或从未运行到目标阶段；文件存在与场景名称被误当成覆盖，真实多章节组合仍漏测。
- Workflow Lab 克隆的是历史状态，不是用户从空项目走出的真实因果链。克隆需要重写 run、Approval、Task target、领域 identity 与未来事实，形成第二套状态解释和长期维护源，因此已整体删除。
- 旧 Golden 主要证明终态 stage，没有在多章节 processing + reload 中观察每个 Task target 对应的 Canvas node，导致逐章计划缺节点、半成品被正式 Query 解析等问题未被发现。当前主 Journey 直接要求至少两个运行 target、稳定节点和刷新恢复。
- Canvas terminal handoff 首版 Golden 只分别看见 streaming 端点、正式终态端点，并记录整个 node shell 是否曾移除；内部 presentation 先清空、disclosure 先折叠以及旧 succeeded 资源接管新 Task 都不会让 shell count 变成零，因此场景错误通过。当前主 Journey 的同一连续 observer 同时记录 stream Task identity、presentation、disclosure 与正式资源 owner identity，任一中间空窗或非同 Task 接管都直接失败。
- Style Bible 集合在 `985d1524e` 改为“已有可用候选即 succeeded”，Logic/Conformance 已同步，主 Journey 却仍要求选择前为 pending，导致完整主链在风格选择处产生假失败并永远到不了后续 Canvas/SSE 阶段。改正 phase 后又暴露旧 driver 用固定 500ms 代替选择持久化确认：下一轮 reload 会中断仍在上传的 choice POST，服务端收到截断 JSON，测试再原地循环到超时。当前 Journey 对齐生产集合 View 的 succeeded 语义，并在一次点击后以权威 Workflow 离开 `needs_style_choice` 作为提交 Oracle，随后才验证同 node identity 与 reload；不再用 phase 不变或 timer 猜测完成。
- 旧 Journey 与本地开发进程共享 `.next`，多个 Next/Turbopack 进程会互相覆盖 manifest，出现源码页面存在但运行时报 `PageNotFoundError`。当前 Harness 用 runtime identity 隔离 `NEXT_DIST_DIR`、上传和报告目录。
- Golden 环境曾共享 Compose identity、固定端口和全局 teardown。当前每次运行拥有独立 scope 和 loopback endpoint，停止一个 scope 不得影响另一个。

## 修改检查表

1. 已有主 Journey、Critical、Logic 或 Conformance 是否已反证本次风险？
2. 新证据属于哪一个唯一准入类别，权威 Oracle 是什么？
3. 是否把内部层 mock 掉后仍声称证明真实产品？
4. 是否能在 pre-fix 或受控真实故障下失败？
5. 是否改变主 Journey/安全 Journey 的入口、生命周期、终态或禁止副作用？
6. 删除旧测试前，仍有效的观察是否已迁入主 Journey或 Critical？
7. 实际命令是否无 failed/skipped/todo，未验证盲区是否明确？
8. Harness 的数据库、Redis、端口、Next 输出、上传和 artifacts 是否全部按运行隔离？
