# 历史回归矩阵

| 历史症状 | 根因 | 当时修复 | 当前防线 | 本次复发形式 | 防线失效原因 |
| --- | --- | --- | --- | --- | --- |
| `d14404a5c8` 初建章节 plan validator，防止模型声明 ledger 外事实 | 模型可写 `persistentFactsIntroduced`，需要另一个解释者判断合法性 | exact、substring、字符 token overlap 接受“保守改写” | `validateChapterPlan` + Unit | 中文同源事实被改写并合并上下文后 overlap 仅 0.56/0.67 | 自然语言不是 canonical identity；阈值既会误拒同源事实，也无法证明镜头未发明事实 |
| `95254ae71b` 统一 AI/Task retry，声明 output validation 可修复 | AI 内部 retry 与 Task retry 曾多层并存 | Task 内 structured step 只调用一次，output validation 交给队列 attempt | Task maxAttempts=3 + durable provider fence | 三次 worker attempt 只有一次模型请求，后两次重放相同 completion | provider 成功结果必须 at-most-once 重放；Task attempt 不是新 invocation identity，故“重试”没有生成新候选 |
| `0ad107b247` 修复 long-form E2E 并把 validator 错误规范为 `PLAN_VALIDATION_FAILED` | 失败需要进入统一错误分类与 Task follow-up | 明确 AppError、结构化校验、Task 终态 | 结构测试与 verify:push | 真实两章批次一章成功、一章因事实改写失败 | 防线证明错误被显式 surface，但没有消除模型与 ledger 的双 writer，也没有真实中文组合 oracle |

## 本次定性

- 类型：同根因复发 + 真实组合路径逃过现有防线。
- 上一版未覆盖真实路径的原因：Unit 只验证英文句号式“保守改写”，没有覆盖中文分词、跨 event 事实合并和 durable provider completion replay。
- 收敛策略：不再扩充相似度或增加例外；删除模型事实写入和语义 validator，由 ledger 唯一投影。
