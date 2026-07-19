<!-- architecture-module: creative-skill-worker -->

# Creative Skill 与无状态 Worker

## 设计理念

主 Agent 只拥有项目运行、事实读取、计划、业务 Operation 调度和用户沟通职责。剧本、连续性、导演、视觉、视频、音乐与质量审查等专业知识不常驻主 Agent System Prompt，而由一个通用、无状态 Creative Worker 按任务发现并读取 Creative Skill。Skill 是只读知识，不是工具权限、工作流、项目事实或第二套运行时。

第一版采用单层 Skill：每个 identity 只有 `SKILL.zh.md` 与 `SKILL.en.md`。当前知识量不足以证明需要 `references/` 或固定专业角色；只有单个 Skill 的真实内容规模和检索需求增长后，才可在后续架构变更中引入分层资源。

## 不变量

- **CS-01 — Skill registry 是唯一身份入口。** Skill id、版本、语言文件、标题、摘要、标签、关键词与 `skill://` URI 只由 `CREATIVE_SKILL_REGISTRY` 声明。发现、URI 解析与读取必须经过该 registry，禁止从 Operation 名、目录遍历、模型猜测或任意文件路径推断 Skill。
- **CS-02 — V1 Skill 保持单层。** 每个已注册 Skill 只有同目录下的 `SKILL.zh.md` 与 `SKILL.en.md`；V1 不建立 `references/`、角色目录或递归知识树。中英文 Skill 表达同一业务规则集合，不能把历史中文或英文独有规则静默丢弃。
- **CS-03 — Worker 无状态且隔离。** Creative Worker 每次调用独立创建，不能访问 Prisma、项目读取、Operation registry、Task、Resource、Approval、Choice、计费或任意业务工具。它唯一可见的工具是 `discover_skills` 与 `read_skill`；输入中的来源材料一律视为数据而非系统指令。
- **CS-04 — Worker 自主发现专业知识。** 所有输出只自动加载通用 `creative-core`；故事、连续性、导演、视觉、视频、音乐和质量 Skill 不按 output kind 在代码里硬绑定。Worker 必须真实执行发现并读取至少一个专业 Skill，服务端以真实读取 trace 验证，未探索时 fail closed。
- **CS-05 — 主 Agent 委派入口唯一。** `delegate_creative_work` 是主 Agent 获取专业创作推理的唯一 Operation。它不写项目、不创建 Task、不收费、不持久化领域产物。Worker 输出只是本次 Tool result 中的建议；任何真实项目变化仍必须由既有 Operation 的唯一入口完成。
- **CS-06 — 输出契约穷尽。** Worker output kind 与 strict schema 只由 `creativeWorkOutputRegistry` 声明。当前集合为 screenplay draft、story analysis、continuity analysis、asset prompt set、video prompt set、music direction 与 creative review；未知、缺失、错 kind 或超预算输出必须原地失败，禁止降级成自由文本或猜字段。
- **CS-07 — 失败与并发不产生第二状态。** 调用由 Run fence 的 abort signal 取消，并受 turn、发现、读取、内容与输出预算限制。Worker 没有持久状态、后台 Task、Wait、重试队列、补偿或幂等 writer；失败和重复调用只会产生独立的无副作用推理尝试，不能覆盖或伪造项目事实。
- **CS-08 — 迁移知识，不删除有效规则。** 主 Agent 的 loop、工具全开、Task/Wait、Approval、Choice、Resource identity、计费、失败、沟通和安全规则继续由 System Prompt 拥有；严格 JSON/schema/parser 规则继续由原 Prompt adapter 拥有；确定性 provider Prompt 继续由原 builder 拥有。只有完成调用者与替代证据审计并标为 obsolete 的内容才可删除。专业知识迁入 Skill 时以现有中英文规则并集为基线。
- **CS-09 — Subagent 展示是 Activity 的嵌套投影。** Worker 不创建第二个 Run、Thread、Task 或持久状态。Subagent identity 必须直接复用承载 `delegate_creative_work` 的 `ProjectAgentActivity.id`；开始、Skill 发现、Skill 读取和终态由 host 追加为带 Run fence 的 `subagent.progressed` 事实事件。SessionState 只投影当前开放 Activity 下仍运行的 Subagent；Activity 或 Worker 终态后标签自动消失。当前响应中的 `data-agent-subagent-event` 只是低延迟传输增量，必须与 Session 最终 View 经过同一个 resolver 合并，不能从历史文案或普通 Tool 卡猜测状态。

## 权威入口

- Skill identity、发现与读取：`src/lib/creative-skills/registry.ts`、`discovery.ts`、`uri.ts`、`loader.ts`。
- 单层 Skill 内容：`src/lib/creative-skills/skills/*/SKILL.zh.md` 与 `SKILL.en.md`。
- Worker 输出与运行边界：`src/lib/creative-worker/output-registry.ts`、`runtime.ts`、`tools.ts`、`skill-access.ts`。
- Worker 运行展示契约：`src/lib/project-agent/subagent-events.ts`；唯一事实写入仍经过 `appendProjectAgentEvents`，最终 View 由 `session-state.ts` 投影。
- 主 Agent 唯一委派 Operation：`src/lib/operations/domains/assistant/creative-ops.ts`，由完整 Operation registry 注入。
- 主 Agent 运行规则：`src/lib/ai-prompts/templates/project-agent/system/**`；它不复制 Skill 正文。
- 原结构化 Prompt、schema、parser 与执行 builder 继续服从 `ai-prompt-output-contract`，不是 Skill 的第二消费者协议。

“原 Prompt 继续存在”只适用于执行协议或确定性 builder，不代表旧创作推理可以永久双轨。若某个旧 Prompt 仍在决定角色、场景、视频或音乐的创意内容，而同一能力已经由 Skill + Worker 承担，它就是待迁移重叠：主 Agent 路径应直接把 Worker 的 final structured result 交给执行 Operation，不能再次调用另一个 LLM 重写；非 Agent UI/API 若仍需要同一创作能力，也必须复用 Creative Worker 这个唯一知识执行入口。迁移必须逐调用链审计 schema、计费与用户 observable，不能在本模块之外复制 Skill 正文。

## 生命周期

1. 主 Agent 从项目正式 View/Resource 读取完成当前任务所需事实。
2. 主 Agent 调用 `delegate_creative_work`，显式传入 output kind、目标、用户请求、来源材料与约束。
3. Operation 解析 strict input，使用当前 Assistant 模型启动一次无状态 Worker，并绑定当前 Run fence signal。
4. Worker 自动读取 `creative-core`，再自行调用发现与读取工具加载相关专业 Skill。
5. Worker 返回 strict output；host 校验 output kind、结构、预算和真实 Skill trace。
6. 主 Agent 检查结果，并按用户目标调用既有文字、图片、音频、视频或专业 Operation。Worker 本身不执行这一步。

步骤 3–5 中，host 会用同一 Operation Activity identity 记录 Worker 开始、Skill 发现、Skill 读取和终态；这些事件只用于运行展示与审计，不允许反向控制 Worker、Operation eligibility 或项目状态。刷新通过 SessionState 重放当前 Activity 的事实事件恢复展示，完成后不保留“仍在运行”的标签。

取消、断线、超 turn、超读取预算、Skill URI 非法、输出不合约或 provider 失败均在第 3–5 步原地失败，没有部分业务写入。刷新不会恢复 Worker，因为没有 Worker 持久状态；需要继续时由主 Agent 在新 Run 中基于正式项目事实重新委派。

## 验证

- `scripts/guards/prompt-semantic-regression.mjs` 同时验证主 Agent 运行闭环仍存在、详细专业视频知识已由单层 Skill 承接、双语关键语义存在且旧固定门禁没有回流。
- `tests/contracts/project-agent-toolset-conformance.test.ts` 从生产 Operation registry 证明唯一委派 Operation 进入完整 toolset，并验证其无写入、无审批和 strict tool schema。
- TypeScript 与 ESLint 验证 Worker/Skill registry 的类型和目录实现；它们不能证明真实外部模型必然正确选择 Skill 或服从 Skill，真实模型质量仍是未验证盲区。

## 历史回归

- 2026-07 的视频链路重构曾一次性缩短主 Agent Prompt，并连带删除 Choice、Task continuation、失败边界等仍有效运行规则；真实模型随后遗漏 Choice，deterministic provider 又无法反证。Creative Skill 迁移不得重演“删除大段 Prompt 等于迁移”：当前防线先分类 `KEEP_MAIN / MOVE_SKILL / KEEP_ADAPTER / KEEP_BUILDER / DELETE_OBSOLETE`，主 Prompt guard 保留运行闭环，Skill 侧承接专业知识。
- 后续为自由创作补充图片与视频方法时，详细专业知识全部常驻主 Prompt，使简单请求也支付整份上下文成本，并让主 Agent 同时承担编排与专业创作。当前防线以唯一无状态 Worker 分离职责；它没有项目写权，所以不会形成第二 Agent runtime 或第二 Workflow。

## 修改检查表

1. 新知识是否进入既有 Skill identity，而不是新增固定角色或第二 Worker？
2. 是否仍只有 `discover_skills` 与 `read_skill` 两个 Worker 工具？
3. output kind 是否来自穷尽 registry，并保持 strict/fail closed？
4. 被迁移的每条规则是否有明确新 owner；原 adapter/builder 的协议规则是否仍在？
5. 中英文是否使用规则并集，而不是延续历史删减版？
6. 是否让 Worker output 获得了项目事实、Task、Approval、Choice、Resource 或 Canvas 写权？若是，方案不合格。
7. 主 Agent 是否仍通过完整 Operation registry 执行真实动作，而没有根据 Skill 结果旁路写入？
8. Subagent UI 是否只消费 Activity + 事实事件的最终投影，并在终态后自动消失？
9. 旧领域 Prompt 是否只是协议/builder；若仍承担创作判断，是否已明确列为迁移重叠而非宣称“双轨合理”？
