<!-- architecture-module: test-governance -->

# 测试治理

## 设计理念

测试数量、测试文件存在和代码覆盖率都不是行为正确性的权威证据。测试治理必须把产品与架构不变量、历史缺陷、可执行场景和 CI 实际运行结果连接成一条可验证链路；任何必跑测试未收集、被跳过或因基础设施不可用而未执行，都必须原地失败。

## 不变量

- **TG-01 — CI fail-closed。** MySQL、Redis、队列或测试服务不可用时，完整验证必须失败；禁止跳过 integration、system 或 regression 后继续成功。
- **TG-02 — 历史缺陷单一目录。** 自动 Git 扫描只生成候选报告，人工确认的根因、架构不变量与场景映射只写入 `HistoricalDefectCatalog`。
- **TG-03 — 行为覆盖必须可执行。** route、task type 与需求只能映射到实际执行的 scenario id；测试文件存在或字符串声明不能充当行为覆盖证据。
- **TG-04 — 影响范围显式。** CI 必须使用明确 base/head Git range；缺失 range 必须失败。非 CI 环境只允许明确文件列表、range 或本地 staged diff。
- **TG-05 — 必跑测试零跳过。** required-suite verifier 必须比较发现文件与 Vitest JSON 实际结果，并拒绝缺失文件、重复文件、跨 suite 文件及 skipped/todo case。
- **TG-06 — 测试能力可反证。** P0/P1 历史缺陷必须有错误实现失败、修复实现通过的证据；关键纯逻辑使用增量 mutation testing 检查测试是否能识别小错误。
- **TG-07 — 测试代码保持单一职责。** 新测试文件不得超过仓库约定的职责和规模边界；删除旧测试必须先提供替代 scenario id 与 CI 收集证据。

## 权威入口

- 历史缺陷：`tests/history/catalog.ts`。
- 实施中发现但不得在测试阶段修生产代码的缺口：`tests/history/discovered-gaps.ts`。
- 可执行场景与实际执行证据：`tests/harness/behavior-scenario.ts`。
- 生命周期事实序列：`tests/harness/lifecycle-sequence.ts`。
- 历史错误反证：`tests/harness/historical-regression.ts` 与 `tests/history/scenarios/**`。
- Task type 行为契约：`tests/contracts/tasktype-scenario-registry.ts`。
- Route identity 与访问边界：`tests/contracts/route-catalog.ts`；可执行契约：`tests/contracts/route-scenario-registry.ts`。
- Git 候选报告：`scripts/test-history/candidate-report.mjs`。
- 必跑测试收集证明：`scripts/test-verification/verify-vitest-report.mjs`。
- 必跑 suite 执行器：`scripts/test-verification/run-required-suite.mjs`，统一生成 Vitest JSON 并立即核对发现文件、实际文件、case 与 skip 数。
- P0 System Journey：`tests/system/p0-journeys.json` 是十条旅程的 identity/status Registry；`verify-system-journeys.mjs` 只接受 Vitest JSON 中实际通过的 `[P0:<id>]` 作为执行证据。
- Mutation：`stryker.incremental.config.mjs`、`vitest.mutation.config.ts` 与 `scripts/mutation/verify-baseline.mjs`。
- 统一完整验证：`scripts/verify-push.sh`。

## 验证

- `tests/unit/test-history/catalog.test.ts` 验证缺陷目录唯一性与完整字段。
- `tests/unit/test-history/candidate-report.test.ts` 验证 Git 候选、测试层和热点统计。
- `tests/unit/test-harness/behavior-scenario.test.ts` 与 `lifecycle-sequence.test.ts` 验证执行证据和显式事实序列。
- `tests/unit/test-verification/verify-vitest-report.test.ts` 验证未收集与 skipped case 原地失败。
- `tests/unit/guards/verify-push-fail-closed.test.ts` 验证测试服务不可用不会跳过高价值 suite。
- `tests/unit/guards/changed-file-test-impact-guard.test.ts` 验证 CI base/head range 与测试影响规则。
- `tests/contracts/tasktype-scenario-conformance.test.ts` 逐项执行生产队列归属与任务意图入口，并核对场景执行账本。
- `tests/integration/api/contract/route-scenario-conformance.test.ts` 动态调用每个 Route 的真实导出方法，并拒绝未执行、重复执行和 5xx。
- `tests/regression/historical-defect-scenarios.test.ts` 对全部 P0/P1 历史场景先验证语义故障会被业务断言击中，再验证当前生产入口通过。
- `scripts/guards/test-size-guard.mjs` 穷尽扫描全仓测试，任何超过 350 行或 10 个 case 的测试文件都会失败；历史超限豁免已删除。

## 历史回归

- 90 天 Git 候选报告显示纠正性提交绝大多数同时修改测试，但主要集中在 unit 层；测试与实现同步变化不能证明历史问题已被独立保护。
- 旧 `verify:push` 在测试服务准备失败时跳过 integration、system 和 regression，仍可能成功结束。
- 旧 changed-file guard 在 CI checkout 没有 staged diff 时输出 `SKIP no changed files detected`，没有检查真实 PR 影响范围。
- 旧 route/task behavior matrix 主要验证测试文件存在，不能证明每个 route 或 task scenario 实际执行。
- Task type 的旧文件名 catalog、behavior matrix 与文本 guard 已由穷尽型可执行 Registry 一次性替换。
- Route 的旧文件名 behavior matrix 与文本 guard 已删除；源文件发现 guard、唯一 identity catalog 和执行账本共同保证新增 Route 必须实际运行。

## 修改检查表

1. 该测试保护哪个需求、架构不变量或历史缺陷？
2. 错误实现下是否能证明失败，而不是只在当前实现上通过？
3. CI 是否实际收集并执行该场景，且 skipped 数为零？
4. 是否新增了文件名映射、字符串 guard 或 mock 自证作为第二套覆盖解释？
5. 删除旧测试或 guard 时，替代 scenario id 和必跑命令是什么？
