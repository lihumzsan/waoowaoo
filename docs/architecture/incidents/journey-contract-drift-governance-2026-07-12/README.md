# 关键 Journey 契约漂移治理（2026-07-12）

## 任务分类与历史结论

本次为 D 类 Architecture Incident。真实 Assistant 组合路径曾在既有 Journey 通过时失败；后续修复又改变了 `nextAction` 与 Run 终态语义，而旧 model-stop 场景仍固化已删除的失败契约。历史证明“测试存在或主线通过”不能证明场景仍与权威流程一致。

2026-07-12 的 test-system reset 删除了 changed-file-test-impact、目录覆盖率和“每次生产改动都机械新增测试”等无效防线，这是正确方向。本次不恢复这些启发式；缺失的是已有关键 Journey 作为权威行为证据时的显式同步义务。

## 目标、非目标与禁止范围

目标：当一个已经承担 Golden/Critical 权威证据职责的用户流程、生产入口、生命周期、终态、失败语义或禁止副作用发生变化时，同一变更必须审计并同步该场景的 contract、真实驱动路径和独立 oracle，并实际运行它的 canonical command。场景未执行、被 skip/todo、基础设施不可用或仍断言旧语义时，只能报告未验证，不能报告阶段完成。

非目标：不要求每个代码改动新增测试；不要求无关 Journey 跟随修改；不以文件同时变化、覆盖率或测试数量作为同步证明；不把真实外部 LLM 的非确定性选择写成强制业务断言。

禁止范围：禁止恢复 changed-file-test-impact guard、第二份 Journey 清单、mock 内部主链、放宽 oracle、删除/skip 场景来消除失败，或以 deterministic provider 的固定 happy path 证明真实模型提示词行为。

并行边界：本阶段只修改测试治理契约与模块映射，不修改产品流程、Golden 实现、Git hook、CI 调度或 package command。

## 权威入口与所有权

| 事实/入口 | canonical identity / scope | 唯一 owner / writer | 消费者 / projector |
| --- | --- | --- | --- |
| 全仓最低测试纪律 | `AGENTS.md` 第 10 节 | 仓库治理变更 | 所有执行者 |
| 测试治理不变量 | `test-governance/TG-*` | `docs/architecture/modules/test-governance.md` | architecture impact、评审与交付 |
| Golden 场景身份和预期终态 | `GoldenScenarioContract.id` | `tests/golden-journey/contracts/scenarios.ts` | Journey spec、harness self-test、报告器 |
| 真实动作路径 | scenario id 对应 Playwright spec | `tests/golden-journey/journeys/**` | Chromium 与生产 UI/API/service/DB/queue/worker |
| 最终行为结论 | 用户结果 + read-only durable oracle | 场景 contract 与模块不变量 | 测试报告、事故文档与交付说明 |
| canonical 执行入口 | `package.json` 中明确的 `test:golden:*` / `test:critical:*` command | 测试治理模块 | 本地、CI 或明确执行阶段 |

不得新增第二个场景清单或根据改动文件名猜测所属 Journey。适用性由被改变的权威用户流程/模块不变量与现有场景 contract 决定；无法确认时必须先完成影响审计。

## 生命周期、失败与恢复

- 正常：权威流程变化 → 定位承担该事实的既有场景 → 同步 contract/驱动路径/oracle（若 observable 未变则记录“不适用 + 原因”）→ 运行 canonical command → 无 failed/skipped/todo 且 oracle 收口后才可报告已验证。
- 失败/拒绝/取消/超时/部分成功：场景 contract 必须声明适用 terminal 和禁止副作用，不得只把页面走通当成功。
- 重试/重复/晚到/刷新/断线/并发：若本次语义改变触及这些 observable，必须由原场景或准入后的 Critical variant 覆盖；不得用固定 sleep、refetch 或事件顺序掩盖。
- 场景失败：先判定生产回归、场景契约漂移或 harness 故障；禁止为了绿灯直接放宽断言。
- 基础设施不可用、scenario 未挂载、skip/todo：fail closed，只报告未验证；恢复基础设施后运行同一 canonical command，不创建替代性假测试。
- 外部不可控系统：只可在协议边界替代。替身负责注入确定输入/故障，不负责证明外部模型一定做出某个非确定性决策。

## 事务、幂等与写入边界

本治理变更不产生业务事务或持久写入。Golden setup 与执行继续遵守测试治理现有的隔离 scope、真实生产 writer 和 read-only oracle；场景 contract identity 是测试同步的幂等身份。重复运行必须落在隔离项目/用户 scope，不能把前次数据当作本次成功证据。

## 删除项与前后数量

本次不新增 runtime writer、执行入口、状态解释者或 guard。新增一条测试治理不变量，并把同一条最低纪律投影到 `AGENTS.md`。

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| Journey 场景 contract owner | 1 | 1 |
| Golden 执行主链 | 1 | 1 |
| changed-file/覆盖率启发式 guard | 0 | 0 |
| 外部 LLM 行为强制测试 | 0 | 0 |
| 明确的关键 Journey 同步不变量 | 0 | 1 |

## 验证结果与盲区

- `npm run architecture:impact -- AGENTS.md`：通过，唯一命中 `test-governance`。
- `npm run check:architecture-docs` 与 `npm run check:architecture`：通过，模块文档、映射与 52 个 mandatory guard 挂载有效。
- `npm run test:golden:self`：7 files、34 tests passed，0 failed/skipped/todo；34 个 canonical scenarios 全部被 Playwright 挂载；MySQL/Redis 隔离自检通过。
- 本次不修改产品或 Journey observable，因此不重新运行付费/长链产品 Golden；上一阶段 model-stop Golden 的 1/1 结果仅作为触发本治理变更的历史证据。
- 盲区：自然语言治理不能静态证明所有未来开发者都正确识别语义影响；该风险通过 architecture impact、canonical scenario registry、真实入口、独立 oracle、实际命令和 fail-closed 交付纪律降低，不能诚实地宣称数学意义的“百分百自动识别”。

## 历史回归矩阵

| 历史症状 | 根因 | 旧修复/防线 | 复发形式 | 本次防线 |
| --- | --- | --- | --- | --- |
| 大量测试存在但真实 Assistant 组合链失败 | mock、自证断言和目录覆盖率替代真实入口 | test-system reset，确立 Golden 为最高产品证据 | 主线 Journey 通过被误读为真实 LLM 提示词已验证 | 明确 deterministic provider 只证明系统链，不证明外部模型选择 |
| `confirm_bible` 后 AI 正常停止却被标记失败 | runtime 把 capability 当 obligation | 删除硬失败并修 prompt | 旧 model-stop Journey 仍要求失败终态 | 权威流程/终态改变时必须同步现有 contract、驱动路径和 oracle，并运行 canonical command |
| 旧治理要求每个行为变化都新增测试 | 文件/目录启发式制造大量低价值测试 | 删除 changed-file、覆盖率和机械测试规则 | 容易因“不能机械加测试”而完全不审计已有关键场景 | 只约束已经承担权威证据职责的适用 Golden/Critical，不恢复文件启发式 |
| 场景存在但没有真正执行 | 文件存在、名称或 ledger 被当作覆盖 | harness fail-closed、required suite 报告 | 流程变更后场景可能 skip/todo 或命令未运行 | canonical command 必须实际发现且 0 skipped/todo；否则只能报告未验证 |
