<!-- architecture-module: ai-prompt-output-contract -->

# AI Prompt 与模型输出契约

## 设计理念

Prompt 只告诉 Primary 如何判断、如何使用 Skill/Subagent 与注册式 Operation；它不实现工作流。专业创作输出由 Creative Worker 的严格 outputKind schema 裁决并物化为 Resource Revision。执行层只验证结构、scope、精确引用和 provider capability，不从自然语言内容猜业务状态。

## 不变量

- **AP-01 — Primary 没有固定主链。** 系统 Prompt 不包含 stage、next action、剧本确认、风格专用卡、短/中/长视频配方或固定工具顺序。Primary 根据目标与当前 Resource 自由组合能力。
- **AP-02 — 专业判断只有 Skill + Creative Worker。** screenplay 创作/修改、Bible、continuity、Chapter plan、Style Bible、asset/video prompt、music direction 与 review 只能由 `creative_work` 产生。通用 `create_text` 只写 `generic.text`；其中 `current_user_text` 分支只允许保存当前用户消息的精确连续原文，是来源捕获而不是第二专业 writer。用户已提供剧本时不得为了保存、确认或建立正式副本自动委派 canonicalization；只有当前消费者明确需要实体、场景范围与引用等结构化分析时才请求 `canonical_screenplay`。
- **AP-03 — outputKind 严格穷尽。** 每个 outputKind 在生产 output registry 声明 schema、适用 Skill 与 Resource schema；未知字段、缺失字段或错误引用原地失败，不容忍兼容 JSON。
- **AP-04 — 结果与过程分离。** reasoning/stream 只用于运行展示，不拥有领域事实；Task terminal 的 strict result 才能物化正式 Revision。UI 不从 reasoning、markdown 标题或文案推断完成状态。
- **AP-05 — Choice 完全由模型填写。** Primary 自行填写当前问题、说明、options、labels 与精确 subject；通用 Choice 不包含业务类型、固定按钮或未来步骤。原子 commitment 只能调用 registry 明示的当前非收费事务 Operation。
- **AP-06 — `>180s` 只是规划信号。** Prompt 可要求 Primary 评估并行、上下文、恢复与连续性；服务端不得把时长变成 Chapter/Bible/continuity 分支。Primary 若需要 Chapter，先委派 `chapter_plan`，再显式采用；每单元 180 秒仅是采用时的局部校验。
- **AP-07 — Style Bible 默认纯文本/结构化 Resource。** 只有用户明确要求预览时才调用普通图片 Operation；Style Choice 不隐式生成图片。
- **AP-08 — 输入只用精确 Revision。** Creative Work request 与媒体 Operation 对 Resource 输入只传全局唯一 revisionId 及显式用途；服务端回库解析 Resource、schema、owner、scope 和真实内容。禁止附带调用方文本，或从最近记录、数组位置、历史消息与模型输出 offset 推断。
- **AP-09 — Provider 约束不升级为创作流程。** 允许时长、画幅、参考数量与模型能力来自 capability registry；Prompt 可据此规划一次请求，但不能据此写固定产品阶段。
- **AP-10 — 双语语义一致。** System Prompt 与每个 Skill 的中英文版本必须具有相同契约变量、输出语义与禁止项；用户可见内容走 i18n。

## 权威入口

- Prompt catalog：`src/lib/ai-prompts/registry.ts`、`ids.ts`。
- Primary Prompt：`src/lib/ai-prompts/templates/project-agent/system/**`。
- Skill catalog：`src/lib/creative-skills/**`。
- Creative output registry：`src/lib/creative-worker/output-registry.ts`、`task-contract.ts`。
- Resource schema/materialization：`src/lib/creative-resource/schema-registry.ts`、`creative-work-materialization.ts`、`task-materializer.ts`。
- 通用 Choice：`src/lib/project-agent/choice-offer.ts`、`choice-result.ts`。

## 验证

- `scripts/guards/prompt-i18n-guard.mjs` 验证 catalog、locale 与变量；`prompt-semantic-regression.mjs` 拒绝固定 mainline、确认剧本、时长配方和专用 Style Choice 回流。
- `tests/contracts/project-agent-toolset-conformance.test.ts` 从生产 registry 验证 Primary toolset。
- `tests/contracts/creative-result-resource-conformance.test.ts`、`tests/unit/creative-resource/creative-work-materialization.test.ts` 验证 strict outputKind 到 Resource 的唯一映射。
- `tests/golden-journey/self-tests/model-provider.test.ts` 验证模型替身协议 fail closed；`freeform-resources.spec.ts` 通过自然语言目标验证真实 Tool/Task/Resource 组合。

## 历史回归

- Prompt 曾先被过度缩短而遗漏 Choice/Approval/Task 规则，随后又把 `allowedOperationIds`、固定下一步、唯一视频配方和 15/180 秒阈值写回系统 Prompt。当前只保留判断标准与运行协议，semantic guard 拒绝固定编排回流。
- 旧 script intake、Bible、核心剪辑、镜头计划、风格预览与 BGM 各有 prompt/schema/worker，和 Creative Skill 形成竞争 writer。当前删除专用模板与 worker，专业结果只经 output registry 物化。
- 旧结构化 stream projector 把 token 增量当正式领域内容，刷新和并发会造成空窗或串流。当前 stream 只展示运行状态，正式 Revision 在 Task terminal 一次接手。
- 旧 source script/Bible schema 要求模型回传系统 identity、版本标记或重复 persistent facts，服务端再用启发式校验，形成第二事实来源。当前 identity/fingerprint/lineage 由服务端构造，模型只输出创作内容。
- 风格选择曾默认生成九宫格预览并进入专用 Choice；当前 Style Bible 是普通 Resource，预览图是用户明确要求时的独立图片 Operation。
- 一分钟内容曾因 Beat 数量被固定估时扩大到数分钟。当前时长只作为用户目标与 Primary 判断输入，模型必须从真实对白/动作/停顿估算，服务端不建立时长状态机；真实模型服从度仍需 Golden/抽样验证。

## 修改检查表

1. 是否新增了专业输出却绕过 Creative output registry？
2. 是否让 `create_text`、UI、route 或 worker 成为第二专业 writer？
3. Prompt 是否恢复固定阶段、next action、确认门或时长配方？
4. Choice 是否只描述当前决定，Style 预览是否仍需用户明确请求？
5. Resource 输入是否只使用精确 revisionId 并回库校验，结果是否保留真实 lineage？
6. 双语 Prompt/Skill 与适用 Conformance/Golden 是否同步？
