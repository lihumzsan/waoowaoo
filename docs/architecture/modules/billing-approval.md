<!-- architecture-module: billing-approval -->

# 计费与审批

## 设计理念

确认不是“调用了 AI 就询问用户”的通用开关。只有执行前可以确定具体媒体输入与价格的收费媒体，才需要媒体报价确认。LLM 文本规划默认无需媒体确认；删除或不可逆覆盖属于破坏性确认，不伪装成媒体报价。

收费媒体的正确顺序是：先生成最终计划，再准确报价，再由用户批准，最后只提交同一计划中的任务。用户批准的是具体工作，不是一个未来可能发生的最大额度。

## 不变量

- **BA-01 — 审批分类唯一。** `none`、`billable_media`、`destructive` 是 operation confirmation 的唯一分类；LLM 文本任务必须显式属于 `none`，不是漏配后的默认值。
- **BA-02 — 精确计划先于媒体审批。** `billable_media` 的审批前必须确定真实 Task、目标、模型、输入、数量和准确报价。不得先批准、再让 LLM 或 worker 决定实际收费内容。
- **BA-03 — 批准必须有来源。** 最终收费任务不得靠写死的 `operationConfirmed: true` 获得权限；批准状态必须来自已确认 operation 或已批准父计划，并可追溯到具体计划。
- **BA-04 — 统一最终门禁。** 未批准的收费媒体不得创建 Task、入队或调用供应商；UI、Agent、route、worker 的任何遗漏都不能绕过提交边界。
- **BA-05 — 免费确认不得隐含媒体授权。** 制作规划等免费 LLM 结果的审核只确认该结果及其业务字段，不得同时授权下一阶段收费媒体。视觉风格初次生成与后续重生成都必须独立经过同一个 `plan → quote → approval → commit` operation；UI 必须展示该次图片任务的数量与 credits，用户批准后才可提交。
- **BA-06 — 父子计划不可扩大。** 父操作只能提交其已报价且获批准计划中的子任务；文本任务不得自动派生新的收费子任务。

## 权威入口

- 媒体类型和是否属于收费媒体：`src/lib/billing/media-approval-policy.ts`。
- operation confirmation 分类：`src/lib/operations/types.ts` 和 `src/lib/operations/registry.ts`。
- 计划、报价、确认额度校验：`src/lib/operations/planning.ts`。
- operation 的统一任务提交：`src/lib/operations/submit-operation-task.ts` 与 `src/lib/task/submitter.ts`。

调用层不得自行维护媒体类型名单、确认布尔值或报价任务的平行集合。

## 验证

- `tests/unit/billing/media-approval-policy.test.ts` 覆盖统一媒体分类。
- `tests/unit/operations/planning.test.ts` 覆盖计划报价与确认额度边界。
- `tests/unit/worker/soundscape-worker.test.ts` 覆盖 Soundscape 任务链路。
- `scripts/guards/no-hardcoded-operation-confirmed.mjs` 阻止在生产源码中写死批准状态。
- `scripts/guards/no-media-provider-bypass.mjs` 阻止绕过统一媒体供应商入口。
- `scripts/guards/no-project-agent-direct-task-submit.mjs` 阻止 Assistant choice/runtime 绕过 operation registry 直接提交任务。

后续演进目标：对所有 `billable_media` operation 建立同一套 `OperationPlan → Quote → ApprovalGrant → Commit` 契约测试；任何计划外 Task 都必须在最终提交边界失败。

## 历史回归

- Soundscape 曾使用“最多 12 个音源”的上限授权：审批时真实音效 Prompt、数量和最终 Task 尚未确定。这类测试即使通过，也是在固化错误策略。
- `d8a1685dc` 收敛了 edit-first 的审批与任务生命周期契约，说明确认语义不能分散在 UI、operation 和 worker 中。
- 制作规划确认曾在 `bible_review` 副作用中直接提交视觉风格任务：后端虽持有报价，UI 未清楚展示 credits，且 Task 未绑定 Agent Wait。免费结果确认与收费媒体授权必须保持两个显式边沿。

## 修改检查表

1. 该 operation 是 `none`、`billable_media` 还是 `destructive`？理由是什么？
2. 若收费媒体，审批时最终输入和价格是否已经确定？
3. 是否复用统一 plan、报价和提交入口，而非新增局部确认逻辑？
4. 是否新增“未批准、计划变化、重复提交、父子任务扩大”的负向测试？
