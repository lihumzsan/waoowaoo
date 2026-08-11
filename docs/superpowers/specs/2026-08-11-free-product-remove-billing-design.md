# Waoowaoo 彻底免费化与计费防回归设计

## 1. 决策摘要

Waoowaoo 切换为彻底免费产品。系统不再拥有积分、余额、报价、冻结、扣费、退费、
充值、套餐、支付、账本、使用成本或计费确认。AI 生成在完成权限、能力、参数、引用、
Placement 和输出数量校验后直接进入唯一的 Operation Plan 与 Task 执行链。

这是一次架构变更：删除 billing writer、pricing owner 和 payment lifecycle，同时保留与资金无关的
任务幂等、快照、权限和破坏性操作确认。

## 2. 目标与完成标准

### 目标

1. 删除所有用户计费、积分、订阅、支付、交易和价格相关的生产入口与展示。
2. 删除 Task/Operation/Provider 中仅为计费存在的 payload、状态、policy 和存储字段。
3. 保留并收敛唯一 Operation Plan/Task 执行链；免费不等于绕过规划、权限、幂等或破坏性确认。
4. 删除 Stripe 及只为支付存在的依赖、环境变量、route、service、UI 和运维脚本。
5. 建立可执行的“免费产品契约”，在未来合并中检测并拒绝计费能力被重新引入。

### 完成标准

- 生产代码不再存在 billing/payment/pricing/credit/subscription 的业务 owner 或 writer。
- 图片、视频、音乐、音效、语音和 LLM 不因余额、价格或计费配置失败。
- 旧 `/pricing` 地址服务端重定向到首页，导航和个人中心不再显示套餐、积分或交易。
- 免费契约检查接入常规 typecheck/build 验证入口，重新引入被检测时非零退出。
- Prisma 当前 schema 不再声明计费实体或字段；清理 migration 只创建、不执行。
- 历史 migration 保留，不改写 Git 历史，不在本任务删除任何真实数据。

## 3. 非目标与禁止范围

- 本阶段不修复 MOSS 音效重试、输出解析、workflow 参数或 HTTP 失败分类；它们作为后续独立任务串行处理。
- 不删除 Operation Plan、PlanSnapshot、OperationExecution、Task、Provider fence 或 WorkspaceResource terminal writer。
- 不删除破坏性操作的显式确认，不将“免费”解释为任意操作免确认。
- 不删除 Provider 自身账号不可用的错误识别；此类 upstream account failure 是运行故障，不是产品计费。
- 不执行 drop table/drop column，不清理、回填或覆盖本地、共享或生产数据。
- 不删除通用公告功能；仅删除与付费 beta 入场、支付和群权益绑定的部分。

## 4. 当前事实与移除范围

当前仓库至少包含 32 个 `src/lib/billing` 文件、11 个 `src/lib/payments` 文件、8 个
`src/app/api/payments` route，以及 pricing 页、profile billing 页、paid-beta 支付入场、Task 计费字段、
Operation quote/grant 字段和多个 Prisma 资金实体。

实施必须以真实 import/reference 图为准扩展下列清单，不得只删目录后留下无声 fallback。

### 必须删除的 owner 和入口

- `src/lib/billing/**`
- `src/lib/payments/**`
- 付费 beta 的 payment/admission/capacity/group-access owner
- `src/app/api/payments/**`
- 用户/project costs、transactions、balance 相关 API
- pricing/recharge/subscription/profile billing UI
- billing/pricing/paid-beta 支付运维脚本
- Stripe server/client 依赖和仅为 Stripe 存在的配置
- AI registry 的用户零售价、毛利、价格覆盖和可选模型必须有价检查
- Task billing policy、billingInfo、billedAt、freeze/settle/rollback 链
- Operation quote view、quote snapshot/hash/ceiling/currency 和 billable-media confirmation
- LLM balance gate、实时计费 settlement 和持久 cost reporting

### 必须保留的通用能力

- registry 中的 model identity、capability、provider route 和 option schema
- Operation 权限、canonical input、Placement、PlanSnapshot 和 request identity
- 非计费的用户决策，特别是删除、覆盖等破坏性确认
- Task 提交幂等、Temporal lifecycle、Provider fence、重试与 terminal materializer
- Provider 返回的原始 token/duration 等运行观测数据，但不派生价格、扣费或余额事实
- 通用 announcement 与非付费产品功能

## 5. 目标架构

### 5.1 唯一执行链

```text
request
  -> auth + canonical validation + provider preflight
  -> immutable Operation Plan / PlanSnapshot
  -> destructive confirmation only when operation policy requires it
  -> one transactional Task/Resource reservation
  -> Temporal / provider fence
  -> one terminal materializer
```

付费媒体的确认分支、quote 分支、balance gate 和 billing settlement 从链路中删除。生成操作不再通过
`billable: false` 或 `BILLING_MODE=OFF` 表示免费，而是根本不存在计费状态。

### 5.2 Operation Plan 与确认

- `OperationPlan` 只携带 Task、Resource、dependency、placement 和幂等身份。
- `OperationPlanView` 删除 quote/quoteHash/currency/cost，只展示任务和输出范围。
- `PlanSnapshot` 保留 normalized input/input hash/plan hash，删除 quote snapshot/hash。
- `ApprovalGrant` 仅服务于仍需确认的破坏性操作，身份绑定 plan snapshot + canonical input，删除金额上限和币种。
- 非破坏性生成在 Plan 完成后走同一交易提交 service，不新建“free submitter”第二入口。
- 原 `approved-plan-submitter` 补全/收敛为通用 operation-plan submitter；需确认时验证 grant，不需时明确禁止伪造 grant。

### 5.3 Task 与 Provider

- 删除 `TaskBillingInfo`、`TaskBillingPolicy`、`billingInfo`、`billedAt` 及 billing receipt projection。
- Task 创建交易不再 freeze 余额，仅写 Task/Resource/dependency/outbox 必要事实。
- Handler 不再构建 billing payload，但生成参数仍必须通过唯一 canonical generation payload 冻结。
- Provider model 删除 cost/retail pricing 声明。模型可用性只由身份、能力、凭证和 route 契约决定。
- Provider 账户自身的 payment-required/hard-limit 错误规范化为 upstream account unavailable，不建立本地计费事实。

### 5.4 UI 与 API

- 删除导航中的价格入口、充值/套餐卡片、积分余额、交易列表、计费设置和媒体报价确认。
- `/pricing` 保留最小服务端重定向至 locale-aware 首页，不保留隐藏价格页。
- 删除 payment/cost/transaction/balance API，不留返回零余额的兼容 route。
- API config 只展示 provider/model/capability/configuration，不返回 pricing display map。
- 删除对应 i18n 键；保留 Provider 运行错误的通用可读文案。

## 6. 数据所有权与 migration

### 6.1 删除的当前事实

当前 schema 中与用户计费相关的实体/字段将从当前 Prisma 模型删除，包括：

- `UsageCost`
- `UserBalance`
- `LlmBillingMeter`
- `Subscription`
- `SubscriptionGrant`
- `BalanceFreeze`
- `BalanceTransaction`
- 只为付费入场存在的 `PaidBetaCampaign` / `PaidBetaSeat` / `PaidBetaPaymentAttempt`
- `UserPreference.assistantBillingConfirmationRequired`
- `Task.billingInfo` / `Task.billedAt`
- `OperationPlanSnapshot.quoteSnapshot` / `quoteHash`
- `ApprovalGrant.quoteHash` / `quoteCeiling` / `currency`
- 对应 User/Project 反向 relation 与索引

实施时必须再以 Prisma schema 和 migration history 构建精确外键顺序，不从本清单猜测 SQL 顺序。

### 6.2 migration 边界

- 保留所有历史 migration，它们是旧数据库升级到当前版本的审计链。
- 新建一个显式 free-product cleanup migration，按外键依赖顺序 drop 字段和表。
- migration SQL 是本任务代码交付的一部分，但本任务不运行 migration。
- 将来若要应用，必须单独确认目标数据库、备份/导出策略和数据丢失授权。
- 不提供保留旧账本的运行兼容层；未应用 migration 的数据库只是尚未进入新 schema，不是一条支持的生产双轨。

## 7. 正常、失败和并发语义

- **正常：** Plan 通过后，非破坏性操作直接经唯一事务提交 Task/Resource，不读取价格或余额。
- **确认：** 破坏性操作继续使用绑定 canonical input/plan hash 的 grant；普通生成不创建 grant。
- **失败：** 权限、能力、Provider 配置、输入或资源冲突原地失败；不会映射成余额不足或计费不可用。
- **取消：** 仍由 Task/Operation lifecycle 所有，不再触发退费/解冻补偿。
- **重试：** 仍使用原 Task/Resource/Provider identity，不创建重新计费或免费特例。
- **重复/并发：** PlanSnapshot、OperationExecution 和 Task dedupe 继续拒绝重复提交；删除账本并不改变业务幂等。
- **部分成功：** 批量成员继续独立终态；不存在按成功项计费或失败项退费的第二解释。
- **刷新/断线：** 客户端只从 Operation/Task/Resource View 恢复，不从本地积分或支付状态推断执行结果。

## 8. 防止合并重新引入计费

文档只记录决策，不能单独阻止回归。实施必须同时建立以下可执行契约。

### 8.1 持久架构契约

- 用新的 `docs/architecture/modules/free-product.md` 替代 `billing-approval.md`。
- 它只记录长期不变的不变量：产品无用户计费 owner/writer；生成不依赖价格/余额；破坏性确认与计费分离。
- 更新 `docs/architecture/modules.json` 移除 billing owner 映射，加入 free-product 契约与检查脚本映射。

### 8.2 自动契约检查

新建 `scripts/check-free-product-contract.mjs`，扫描当前生产树和 package/schema 契约，发现下列任一情况即失败：

1. 重新出现 billing/payment/paid-payment 生产目录或 API route。
2. `stripe` / `@stripe/stripe-js` 重新出现在依赖或生产 import。
3. Prisma 当前 schema 重新声明已禁止的计费模型或 Task/Plan/Preference 计费字段。
4. package scripts 重新声明 billing/pricing 运维、清理、对账或测试套件。
5. model registry 重新引入用户零售价、毛利或价格覆盖要求。
6. 当前 UI/API 重新暴露 balance/credits/subscription/transaction/cost 产品事实。

检查明确忽略历史 migration、Git 历史和本架构文档，否则无法保留审计链。检查接入常规
`typecheck` 与验证流程，确保合并远程代码后不能静默带回计费。

### 8.3 合并处理规则

- 如果远程变更重新引入计费，以 free-product 契约为权威，不接受“先合进来再设为 OFF”。
- 保留远程中与计费无关的能力变更，将其 billing payload/policy/UI 部分在同一合并中去除。
- 契约检查失败必须解决后才能宣称合并完成；不得通过扩大 ignore 或改名绕过。
- 如果未来真实产品决策要恢复计费，必须由用户发起新的架构变更，同时修改契约文档和检查；不能被普通远程合并隐式恢复。

## 9. 删除项与计数收敛

| 类别 | 变更前 | 变更后 |
| --- | ---: | ---: |
| 用户计费 owner | `src/lib/billing` + pricing registry | 0 |
| 支付 lifecycle owner | `src/lib/payments` + Stripe routes | 0 |
| 余额/账本 writer | billing ledger | 0 |
| 媒体 quote/freeze/settle 路径 | 1 | 0 |
| LLM 后付 settlement 路径 | 1 | 0 |
| 生成执行入口 | Operation Plan -> Task | 仍为 1 |
| Task terminal writer | 每类 Task 的权威 handler/materializer | 不变 |
| 破坏性确认 owner | approval service | 仍为 1，删除 quote 语义 |
| 免费/计费运行模式 | OFF/SHADOW/ENFORCE 三态 | 0，不存在模式开关 |

不允许保留 `BILLING_MODE=OFF`、空 quote、零价格、`billable: false` 或 no-op ledger 作为兼容层。

## 10. 分阶段实施边界

### 阶段 A：免费执行核心

- 先从 Task/Operation/LLM 执行链删除计费依赖。
- 收敛 operation-plan submitter，保持幂等、事务和破坏性 grant 契约。
- 本阶段不留临时双轨；同类 Task 一次性切换。

### 阶段 B：删除支付、账本、价格与 UI

- 删除 billing/payment/pricing/paid-payment 生产模块、routes、UI、i18n、依赖和 scripts。
- 删除 pricing 对 model registry/API config 的反向约束。
- `/pricing` 切换为 locale-aware 首页重定向。

### 阶段 C：schema 与防回归契约

- 清理 Prisma 当前 schema，创建但不执行 destructive migration。
- 用 free-product 架构契约取代 billing-approval 契约。
- 加入自动检查并证明它能拒绝一个受控的重引入样例。
- 不运行 migration；数据库执行是未来单独授权的阶段 D。

## 11. 验证设计

验证优先使用生产契约、类型系统和真实入口，不为删除代码机械新增 mock 测试。

1. `check-free-product-contract` 通过，并用临时受控 fixture 证明重引入被拒绝。
2. Prisma format/validate/generate 通过；审查 migration SQL 只包含本次明确的 drop，不执行。
3. TypeScript typecheck 通过，证明不再存在 billing/pricing 消费者。
4. 模型配置与 capability catalog 检查通过，且不再依赖价格覆盖。
5. 从真实 Operation 入口至少验证一个非破坏性生成 plan/execute 不产生 quote/grant/billingInfo。
6. 验证一个破坏性操作仍需 canonical-input-bound grant，防止免费化误删安全边界。
7. 验证 `/pricing` 重定向、导航/profile 无计费入口、payment/cost API 不存在。
8. 运行适用的现有 Task/Temporal/provider 契约验证，不运行已删除语义的 billing tests。
9. `git diff --check`、定向 lint 与 build/typecheck 结果如实报告。

## 12. 交付报告必须包含

- 新的权威 Operation/Task 入口。
- 删除的 billing/payment/pricing owner、writer、route、UI 和 schema 事实。
- 变更前后 writer、执行入口和竞争状态解释数量。
- 破坏性确认如何保留。
- 防回归检查的实际运行结果。
- migration 文件已创建但未执行的明确声明。
- 仍未验证的真实环境盲区。

## 13. 后续任务边界

彻底免费化完成后，再串行处理音效审查中的其他问题：

1. 修复 music/sound retry 中 `audioKind` 的投影、冻结与 fingerprint。
2. 将 `create_audio` 能力声明收敛为穷尽的 music/sound variants。
3. 为 MOSS 实现精确 node 28 + 唯一 MP3 输出契约。
4. 恢复审计过的 workflow 布尔值与 prompt 原样传递。
5. 修正 `/prompt` 4xx 拒绝与提交结果未知的边界。
6. 补全 sound 的用户可见 i18n 与阶段投影。

这些修复不得重新引入 billingInfo、pricing catalog、零价格或 billable/free 分支。
