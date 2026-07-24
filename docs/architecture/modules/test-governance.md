<!-- architecture-module: test-governance -->

# 测试治理

## 设计理念

测试用最少的独立证据反证会伤害用户结果或架构不变量的错误实现。证据分为 Logic、Registry Conformance、Critical Infrastructure 与 Golden Journey；Harness 只是隔离运行环境。固定创作阶段已经删除，因此测试不能再通过复刻 screenplay → Story Canon → Chapter → asset → video 的顺序制造第二条 Workflow。

## 不变量

- **TG-01 — 独立 oracle。** 期望来自用户目标、模块不变量、生产 registry 或已确认历史事实，不从当前实现、mock 返回、源码字符串、文件名或测试数量反推。
- **TG-02 — 测试准入。** 新测试只能属于真实 Golden、安全 Journey、Critical Infrastructure、非平凡 Logic、Registry Conformance 或 Harness fail-closed 自测。
- **TG-03 — Golden 走生产链。** 不 mock 自己的 UI、route、service、数据库、queue、worker、Outbox、SSE、projector 或状态机；只在付费/不可控外部模型和媒体协议边界使用替身。
- **TG-04 — 自由组合是最高产品证据。** Golden 只给 Primary 自然语言目标，允许 Skill、Subagent、Operation 和 Resource 自由组合。它不能指定工具顺序、注入阶段、写业务事实或使用旧 mainline driver。
- **TG-05 — 权威事实断言。** Oracle 读取 Project/Run/Task/Operation、CreativeResource/Revision/Lineage/Binding，以及可选的 screenplay source projection、Story Canon adoption 和 Chapter projection。不得查询已删除的 style preview/edit script/shot/video segment/BGM/final output 表，也不得用卡片文案代替领域事实。
- **TG-06 — 关键目标必须有组合反证。** 适用 Golden 应覆盖通用模型作者 Choice、Choice 只提交当前决定、剧本 Revision 无确认门、Style Bible 默认无预览、多 Chapter 由 Primary 自主选择、`>180s` 不触发服务端分支、Story Canon/continuity/Chapter 独立。
- **TG-07 — Critical 负责故障语义。** 事务、幂等、并发、late/replay、断线、重试、补偿和 provider 故障使用真实基础设施与生产 owner，只开放一个明确故障 seam。
- **TG-08 — Logic 与 Conformance 有边界。** Logic 只验证非平凡纯函数、parser、resolver、policy、状态机、算法和 canonical identity；Conformance 必须从生产 registry 穷尽枚举，禁止维护第二份 Task/Operation/Canvas/Resource 清单。
- **TG-09 — Harness fail closed。** runtime identity、MySQL/Redis scope、端口、Next dist、Next tsconfig、上传和报告目录必须隔离；Golden 为每个 runtime 生成忽略且可清理的独立 tsconfig，Next 不得回写仓库根 `tsconfig.json`。required case 缺失、skip/todo、浏览器异常、依赖不可用、付费调用或 Oracle 写入都显式失败。
- **TG-10 — 纠正性证据必须 fail-before。** 同一断言必须能在 pre-fix 或受控真实故障下失败；mock X 再断言 X、检查文件存在或调用次数不算行为证明。
- **TG-11 — Journey 同步。** Golden 覆盖的入口、生命周期、终态或禁止副作用变化时，同一变更必须更新 scenario、driver、Oracle 并执行 canonical command；不能执行只能报告未验证。
- **TG-12 — 过程材料不持久化。** 临时历史矩阵和执行记录不进入仓库；长期有效结论压缩进模块历史回归。

## 权威入口

- Logic：`npm run test:logic`。
- Conformance：`npm run test:conformance`。
- Critical：`npm run test:critical` 及其 provider/task/billing 子集。
- Golden：`npm run test:journey`。
- 自由组合与取消：`tests/golden-journey/journeys/freeform-resources.spec.ts`。
- 安全边界：`auth-project-permission.spec.ts`、`asset-hub-ownership.spec.ts`。
- Scenario registry：`tests/golden-journey/contracts/scenarios.ts`。
- 只读 Oracle：`tests/golden-journey/oracle/**`。
- Harness：`tests/golden-journey/runtime/**`、`providers/**`、`browser/**`。

## 验证

### Golden 观察面

自由组合 Journey 从空项目通过真实 Composer 发出目标，由外部模型替身按可见 Resource/Task 事实返回普通生产 Tool calls。Oracle 必须证明：

1. 每个创作结论是 `creative_work` 终态物化的 Resource Revision；
2. 媒体只消费精确输入 revisions，并产生 Lineage；
3. 部分失败只重试失败 Resource，成功 Resource 不重复提交；
4. 通用 Choice 的 subject/option/commit 只属于当前决定；
5. 不采用 Chapter 的长内容不会被服务端自动拆分；采用 Chapter 时来自 `chapter_plan` Resource 且每单元局部约束有效；
6. Style Bible 未显式要求预览时不会创建 image Task；
7. 刷新和 SSE replay 后 Resource、Task、Binding 与 Lineage identity 不变；
8. 旧固定表、TaskType、Workflow 卡片和自动下游副作用为零。

外部基础设施不可用、场景未挂载或浏览器崩溃都属于未通过，不能用“未发现产品错误”替代。

## 历史回归

- 旧 Golden 以 `mainline-complete.spec.ts` 编排固定多章节阶段，既成为第二 Workflow，又要求已删除表继续存在。当前删除主线 driver，唯一专业产品证据改为自然语言驱动的自由 Resource 组合。
- 旧 Oracle 查询 style preview、edit script、shot execution、video segment、BGM、music score 和 final output 表；生产删表后 Golden 会在进入行为前直接 SQL 失败。当前 Oracle 只读取 Resource spine 与仍存在的可选投影。
- 旧测试用 stream 延迟和固定 sleep 观察 processing 卡片，机器速度变化会制造假失败。当前成功由持久 Task/Resource 终态和只读 Oracle 裁决，时间只限定等待上界。
- 旧阶段测试数量很多，但真实组合经常在更早阶段失败，文件存在被误当作覆盖。当前 required suite 必须真实执行且无 failed/skipped/todo；未运行范围明确列为盲区。
- Golden 生成目录曾被 lint 当成源码，导致 `test:journey → verify:push` 顺序不稳定。当前 runtime identity 隔离 `.next-golden` 与 artifacts，并由 Git/lint 排除；过期本地缓存不能作为源码类型错误。
- Next dev 会把每个动态 `.next-golden/<runtime>/types` 追加进它使用的 tsconfig；仅隔离 distDir 仍持续污染被追踪的根配置。当前每个 Golden runtime 生成唯一且忽略的根相对 tsconfig，预先包含精确 dist types 并在停止时清理，根 `tsconfig.json` 不再承担 Harness 运行状态。

## 修改检查表

1. 已有 Golden、Critical、Logic 或 Conformance 是否已反证本次风险？
2. 新证据属于哪一类，独立 Oracle 是什么？
3. 是否 mock 了被测系统自己的关键层？
4. 是否能在 pre-fix 或受控真实故障下失败？
5. 是否同步了受影响 Golden scenario、driver 与 Oracle？
6. 实际命令是否无 failed/skipped/todo，未验证盲区是否明确？
