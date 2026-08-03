<!-- architecture-module: billing-approval -->

# 计费与审批

## 设计理念

所有收费 Operation 先形成不可变 PlanSnapshot 和 quote，再由用户逐次批准或预算授权，最后才创建 Task/扣费。Web、Wao MCP 与未来 CLI 都调用同一 planning/submit service；渠道不拥有价格、余额、冻结或重试语义。

## 不变量

- **BA-01 — 价格唯一。** 价格目录、模型/参数和输入数量经 billing policy 计算；模型、UI、MCP schema 与客户端不得自行估价。价格只有一份表示：各 provider `models.ts` 的 catalog 条目经 `catalog-bootstrap` 注册，不存在第二份 JSON、文档或脚本副本。
- **BA-01A — 成本与零售是同一条目的两面。** 每个 catalog 条目同时声明 `cost`（CNY，付给供应商）与 `retail`（credits，向用户收取）；省略 `retail` 时按 apiType 加价率从 `cost` 派生，手写 `retail` 必须与 `cost` 同 mode、同 unit、同 tier 顺序与条件。计费只解析 `retail`，`cost` 只服务毛利报表与保险丝，永不进入用户可见金额。注册期必须校验每个价格点在最深套餐折扣下仍高于最低毛利线，不满足即启动失败。
- **BA-01B — 同一产品能力跨 provider 同价。** 同一模型经不同 provider 提供时，`cost` 可以不同，`retail` 必须由共享声明拥有并完全一致；provider route set 的价格等价校验比较 `retail`。
- **BA-01C — 可选模型必须有价。** 模型 identity 分布在 capability、pricing、API config 与 platform preset 四张数组，靠 `(type, provider, modelId)` 联接且无类型约束。注册末尾必须穷尽校验「用户可选的模型都有价格」，缺价在注册期失败，不得留到用户选中后才在计费时报 `BILLING_UNKNOWN_MODEL`。
- **BA-01D — 计价单位必须是真实计价基准。** 供应商按 token 计价的媒体模型不得把「每百万 token 单价」注册成 `per_call` 金额。价格档位的 `unit` 与 `when` 必须能由报价时已冻结的输入穷尽解析；无法由输出秒数表达的计价基准（如按输入视频长度计费的 video-to-video）不得声明近似档位，必须缺档并 fail closed。
- **BA-02 — 计划先于副作用。** 付费前完成权限、模型、参数、WorkspaceResource 引用、Placement、输出数量与路径冲突校验；PlanSnapshot 创建前不得提交 Provider 或创建 pending Resource。
- **BA-03 — 冻结同一输入。** Snapshot 冻结实际读取的 `resourceId + contentVersion + workspacePath`、Operation revision、模型参数、输出 Placement 和 quote。Production Manifest 的执行快照就是该 Snapshot，不建立第二份冻结。
- **BA-04 — Project scope。** 收费 Project Operation 只以 `userId + projectId` 授权；资源身份来自冻结引用，不存在 Episode/Chapter/scopeRef 推断。
- **BA-05 — 授权精确。** ApprovalGrant 只授权一个 Snapshot 或明确金额/范围/期限的预算；Codex shell/patch 审批不能授权消费，普通 request_user_input 也不能。
- **BA-06 — 提交幂等。** 同一 API/MCP request identity、Snapshot 与 execution identity 重放返回同一 Task/Batch；输入或 contract revision 不同则 typed conflict，不能再扣费。
- **BA-07 — 账本唯一。** Billing ledger 是冻结、扣减、退回和展示的唯一 writer；Task、Provider webhook、UI 和 Agent 都不能直接改余额。
- **BA-08 — attempt 与业务收费分离。** Provider attempt 可重试，但同一业务执行只持有一份授权和费用。未提交 Provider 的失败释放冻结；已经产生不可撤销成本的结算遵循 ledger policy。
- **BA-09 — 批量仍是一次计划。** `submit_production_manifest` 对整个批次一次校验/报价/授权，然后以稳定 item identity 扇出。每项结果独立，失败项续跑复用原 Snapshot，不重新收费成功项。
- **BA-10 — 审批结果可审计。** 用户、Project、Snapshot、Grant、Task/Batch、金额、币种、catalog revision 和时间均持久化；UI 只消费服务端 View。
- **BA-11 — 报价消费 canonical Task 字段。** Production planner、billing policy 与 Task handler 必须消费同一冻结 payload；视频/音频时长以 `durationSeconds` 为唯一 Task 字段，billing 和执行只能在各自边界把它映射成价格/provider 所需的 `duration`，不能从自由 `generationOptions` 或旧字段另行解释。
- **BA-12 — 破坏性审批冻结精确输入。** 非计费删除在展示审批卡前先按 Operation schema 规范化输入；approval identity 必须包含 canonical input hash，卡片展示精确目标，执行只消费同一份规范化输入。只绑定 Turn/call/operation 的通用“确认删除”不能授权另一组目标。
- **BA-13 — 取消或清空先到则不得开始副作用。** 浏览器 Turn cancel 与 pending/decided interaction 在 Project 锁下原子关闭；浏览器审批证明要求同 Turn 未取消且 Thread 未进入 clear。同步写、approved-plan 提交和 direct durable execution 在业务事务内按 Project→Thread→Turn 获取同一 effect fence，先取消或 clear 则不能创建 Task、扣费或删除资源。
- **BA-14 — 图片能力参数只有一个编译入口。** 所有项目图片 producer 在 Plan 阶段通过 `buildImageBillingPayload` 取得当前模型已配置的分辨率、质量与业务画幅，再把同一 `generationOptions` 同时交给 quote 和 Task。新 Resource producer 不得只传模型和画幅、另行猜测价格档位或绕过 capability catalog。

## 权威入口

| 事实或动作 | 唯一入口 |
| --- | --- |
| 价格与 quote | `src/lib/billing/**`、pricing catalog |
| 价格条目 shape、派生与保险丝 | `src/lib/ai-registry/pricing-catalog.ts`、`pricing-retail.ts` |
| 可选模型价格覆盖校验 | `src/lib/ai-registry/pricing-coverage.ts`（由 `catalog-bootstrap` 注册末尾调用） |
| 跨 provider 同能力零售价 | `src/lib/ai-providers/shared/*-pricing.ts` |
| credit 单位与整数化边界 | `src/lib/billing/credits.ts` |
| 套餐档位、发放额度、最低有效 credit 单价 | `src/lib/billing/subscription-plans.ts` |
| PlanSnapshot 与 request identity | `src/lib/operations/planning.ts`、`operation-plan-snapshot.ts`、`api-request-identity.ts` |
| Grant 与执行重验证 | operation approval routes + `operation-plan-revalidation.ts` |
| Task/Batch 原子提交 | `src/lib/task/approved-plan-submitter.ts`、`transactional-create.ts`、Wao MCP production executor |
| 余额与交易 | `src/lib/billing/ledger.ts` / `service.ts` |
| 用户 View | billing reporting + profile/assistant UI |

## 失败与恢复

报价过期不会静默重算；contract/model/资源版本变化要求新 Snapshot。提交 ACK 不明时按 request/execution identity 查询同一结果。Task 创建与 Temporal dispatch 之间必须原子或显式补偿；Provider 结果晚到只由当前 attempt/terminal CAS 接受。取消只停止未承诺的后续执行，不能伪造退款。

## 验证

真实 MySQL/Redis/Temporal critical suites 覆盖余额不足、重复 plan/execute、并发提交、冻结释放、Provider retry、晚到终态、批量部分失败和续跑不重复收费。Operation registry conformance 穷尽验证所有 Resource-producing/收费能力都声明 Placement、Plan 与计费 policy。

## 修改检查表

- 新收费入口是否仍只调用共享 plan/submit/ledger？
- Snapshot 是否冻结实际版本、Placement 和 quote，而不是只保存 prompt？
- MCP/Web/CLI 是否共享 request identity 与幂等执行？
- 批量重试是否只处理失败 item，且不会重新扣成功 item？

## 历史回归

- WorkspaceResource clean cutover 首版把 Manifest 的 `durationSeconds` 正确冻结到 Task payload，但通用视频计费与新视频 handler 仍读取旧 `generationOptions.duration`；四段 15 秒 Manifest 因而在审批前被误判为“缺时长”，即使绕过报价也会在执行时丢失时长。当前 Task schema 的 `durationSeconds` 是唯一事实，billing 与 provider 调用分别显式映射；视频/音频计划缺时长在 planner 原地失败。
- 同一批次修复时，通用 planning policy 已向含图片/视频的 Plan metadata 冻结 `projectVideoRatio`，但 WorkspaceResource commit 的严格领域 metadata schema 未组合这份共享字段；批准后的 OperationExecution 因此在 Task/Resource 事务前连续失败。当前比例快照 schema 与 key 由 ratio policy 导出，领域 commit 显式组合它，严格解析仍拒绝所有未知 metadata。
- Codex Runtime 与 Wao MCP 首次接通时把短期 bearer 同时当作“可调用能力”和“用户已批准”的证明；容器内代码若取得该 bearer，可自行建立 MCP session 并伪造 elicitation accept。当前 bearer 只授予传输能力；每次计费或破坏性执行的 elicitation 带稳定 approval identity，Grant/执行 writer 必须再验证由 Wao 登录态交互 route 已持久化的同 Turn 浏览器决定。Runtime 返回值本身永远不能签发用户授权。
- 浏览器审批证明首次只绑定 Turn、call 与 Operation，删除客户端可复用同一 request identity 替换目标输入。当前破坏性审批先规范化输入，将 canonical input hash 纳入 approval identity 并把精确目标展示给用户；执行路径复用该规范化值，不能在批准后重新解释原始参数。
- Interrupt 首版只在 MCP 入口检查易失 AbortSignal；等待审批期间持久 cancel 已提交后，晚到 accept 仍可经过 browser proof 创建执行。当前 interaction、approval proof 与所有 effect transaction 都检查同一 `cancelRequestId`，并用 Project 锁确定 cancel/effect 的先后关系。
- Thread clear 首版没有进入 approval/effect fence；清空已 claim 后，旧 Turn 的晚到 MCP 调用仍能签发 Grant 或提交 Task。当前浏览器证明、MCP binding 与事务 effect fence 都检查 `clearRequestId`，并共享 Project→Thread→Turn 锁序。
- Ark 按「每百万 token」为 Seedance 2.0 计价，价格目录却把 ¥46/¥37 这两个每百万 token 单价注册成 `unit: 'per_call'` 的整次金额，因此每条视频无论 4 秒还是 15 秒都收 ¥46。项目同时实现了完整的 token 估算契约（分辨率×画幅×24fps 的像素公式与最小 token 下限表），但它从未被任何计费路径调用——`calcVideoByTokens` 显式丢弃传入的 token 数并回落到同一 per_call 金额，`resolveAiVideoTokenPricingContract` 零消费者。真实 720p 10 秒成本约 ¥9.94，实收 ¥46，超收约 4.6 倍；5 秒时超收 9 倍。旧防线只断言「calc 函数返回目录里的数」，与目录本身同源，无法反证单位语义错误。当前 Seedance 2.0 按输出秒数计价（由同一 token 公式在 16:9 下换算为每秒成本），整套 token 估算机器连同 `calcVideoByTokens` 一并删除，不保留第二条价格解释；video-to-video 因计价基准依赖输入片长而不声明档位，命中即 fail closed。同一修复顺带纠正了结算把 provider 返回的 token 数写进 `unit: 'video'` 的 `actualQuantity` 字段。
- 价格长期存在两份表示：生产运行时读 TypeScript catalog，`check:pricing-catalog` 只读 `standards/pricing/**` 的 JSON 镜像。镜像停在 52 条而运行时已有 70 条，缺失 gpt-image-2、mureka、Lyria、Seedance、Kling O3、Claude 5 系列与 GPT-5.x，还保留了运行时已删除的 `fal-sora2`；脚本却始终报 OK。「校验通过」因此完全不能说明用户被收了多少钱。当前 JSON 镜像与 `.mjs` 脚本删除，`scripts/check-pricing-catalog.ts` 加载与计费同一个运行时 catalog 并输出毛利报表。
- 四张模型数组（capability / pricing / API config / platform preset）只靠字符串三元组联接，没有任何类型或运行时校验。漂移因此可以长期存在：`fal::fal-sora2` 出现在 API 配置目录却既无能力也无价格，`openrouter::openai/gpt-5.4` 与 `google/gemini-3.1-flash-lite-preview` 可被用户选中但 `pricingUsdPerMillion: null`。用户选完模型后才在计费时撞 `BILLING_UNKNOWN_MODEL`，与历史上 ElevenLabs 幽灵目录项导致整笔配置保存被拒是同一根因的换形式复发。当前注册末尾穷尽校验价格覆盖：flash-lite 从本仓库 Google 目录同模型价格补齐，无可溯源价格的 gpt-5.4 保留声明但退出可选集合，幽灵 `fal-sora2` 目录项删除。
- WorkspaceResource 图片生成首版绕过既有图片能力编译器，只把 `aspectRatio` 写进 Task；OpenRouter GPT Image 价格目录按 `resolution + quality + aspectRatio` 匹配，因此请求在 Provider 前被误报为 `BILLING_CAPABILITY_PRICE_NOT_FOUND`。当前该 producer 复用 `buildImageBillingPayload`，项目已配置的 1K/high/16:9 同时进入报价和执行 payload，显式请求只在同一 schema 内覆盖配置值。
