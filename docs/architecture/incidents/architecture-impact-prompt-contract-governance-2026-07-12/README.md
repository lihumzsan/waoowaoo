# 架构影响路由与 Prompt 输出契约治理（2026-07-12）

## 任务分类与历史结论

本次为 D 类 Architecture Incident。`architecture:impact` 自建立起只把所有输入路径聚合后做手工 `sourcePaths` 前缀匹配，无法说明单个文件命中了哪个模块，也无法在实现扩展修改范围后复核全部工作区变化。与此同时，历史上已经出现 Prompt、生产 raw schema、Canvas stream adapter 与 Golden provider fixture 漂移，而关键 Journey 通过仍未覆盖真实 processing-time 或模型协议失败。

既有 test-system reset 正确删除了 changed-file-test-impact 和目录覆盖率启发式。本次不恢复“改了某文件就必须改某测试”的第二套测试裁判；`--changed` 只枚举实际 Git 变化并逐文件执行既有架构路由，Journey 适用性仍由模块不变量和 `TG-11` 决定。

## 目标、非目标与禁止范围

目标：

- `architecture:impact` 对每个输入文件分别报告命中模块、匹配 `sourcePath`、文档和验证入口。
- 增加修改后使用的 `--changed` 模式，读取 tracked modified、staged、untracked、renamed 与 deleted 路径；修改前仍使用显式目标路径。
- 建立全仓 AI Prompt 与模型输出契约，要求结构化输出变更审计 raw schema、parser/normalizer、stream adapter、stable item identity、projector、UI consumer 与 provider fixture。
- 把 Prompt、pricing、capability 与 prompt canary 等已知标准入口路由到适用模块，并增强 manifest 的确定性结构校验。

非目标：

- 不新增 `--staged`，不把 `--changed` 作为修改前路由的替代。
- 不让未映射文件失败；未映射可能是合法局部实现，只要求显式显示。
- 不根据 changed files 自动选择、要求或修改 Journey。
- 不把所有源码机械映射到模块，不从目录名推断业务 owner。
- 不修改 Prompt 生产行为、模型输出 schema、Canvas runtime、provider、billing 或 capability 运行时。
- 不在本阶段收敛 standards JSON 与运行时代码 catalog 的双表示。

禁止范围：

- 禁止恢复 changed-file-test-impact、测试文件覆盖率或“生产文件必须有测试文件”的启发式。
- 禁止让 Prompt 文案成为结构化输出字段的第二权威；生产 raw schema 仍是接受边界。
- 禁止把跨模块共享路径判为错误；一个权威入口可合法命中多个模块。
- 禁止接管、暂存或回退 `--changed` 报告中的其他任务文件。

## 入口、所有权与作用域

| 事实/入口 | canonical identity / scope | 唯一 owner / writer | 消费者 |
| --- | --- | --- | --- |
| 架构模块身份 | `modules.json.modules[].id` | `docs/architecture/modules.json` | impact router、docs guard |
| 文件到模块路由 | normalized repo-relative path + declared `sourcePath` | `architecture:impact` 纯匹配器 | 执行者 |
| 当前工作区变化 | Git index/worktree/untracked snapshot | Git | `architecture:impact --changed` 只读消费者 |
| Prompt identity 与变量 | `AiPromptId` | `AI_PROMPT_CATALOG` | prompt builder、guards |
| 结构化 raw 输出接受边界 | 具体生成链的生产 raw schema | 对应领域 schema module | worker parser、stream adapter、fixture |
| 最终领域投影 | 领域资源 identity | 对应 service/projector | DB、Query、UI |
| Journey observable | `GoldenScenarioContract.id` | Golden scenario registry | Playwright、报告器 |

`architecture:impact` 不获得业务语义解释权。它只展示 manifest 已声明的路径关系；真实影响仍由执行者沿 registry、类型、import、parser、projector 和用户 observable 探索。

## 正常、失败与变更时序

- 修改前：执行者把预计修改文件/目录显式传给 `architecture:impact`，逐文件阅读命中模块；关键生产路径未命中时先判断是否缺少映射。
- 修改中：范围可以因真实调用链扩展，但不得把新文件默认为无架构影响。
- 修改后：`--changed` 从 Git 状态读取实际 changed paths，逐文件复核；它只报告，不暂存、不写文件、不决定当前任务所有权。
- 无变化：`--changed` 明确报告没有 changed paths 并成功退出。
- 未映射：逐文件报告未命中并成功退出；执行者决定“不适用”或补充映射。
- rename/delete：rename 使用新旧路径共同路由，delete 使用旧路径，防止移动权威入口时丢失原模块。
- dirty worktree：报告可能包含其他任务文件；提交前仍按 hunk 审核，不能把报告当授权。
- 重复运行：Git snapshot 和 manifest 相同则输出确定；不存在持久化、重试、补偿或并发 writer。

## 删除项与前后数量

| 项目 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 架构路由执行入口 | 1 | 1 |
| changed-file 测试适用性裁判 | 0 | 0 |
| Prompt 输出通用架构契约 | 0 | 1 |
| 路由输出归属 | 所有路径聚合 | 每个路径独立 |
| 未映射默认失败入口 | 0 | 0 |
| `--staged` 模式 | 0 | 0 |

旧的聚合输出将被删除；手工路径模式继续由同一脚本承载，不建立第二个 router。`--changed` 只负责构造同一 router 的输入集合。

## 标准目录调查结论

- `standards/pricing/**` 由 `scripts/check-pricing-catalog.mjs` 校验，并与 capability options 交叉检查；生产计费通过 `src/lib/ai-registry/pricing-*` 与 provider code catalog 运行。该目录变更必须同时路由 billing 与 provider 模块以暴露双表示审计义务，但本阶段不宣布 standards JSON 是运行时唯一 writer。
- `standards/capabilities/**` 由 `scripts/check-capability-catalog.mjs` 校验，并被 pricing catalog 校验读取；运行时 capability catalog 仍来自 provider code catalog。该目录路由 provider 模块。
- `standards/prompt-canary/**` 当前没有生产或测试消费者。它路由 Prompt 契约以防修改时被误认为已执行证据；未挂载状态记录为盲区，不在本任务中伪造 guard 或测试。
- `src/lib/structured-stream` 明确属于 Canvas raw preview 协议；`src/lib/project-projection` 与 Assistant phase 消费属于 Assistant Run 模块。Task status、ApprovalGrant、payments 与 Assistant text-attachment routes 也已按真实 service 调用链补入既有模块。
- `src/lib/edit-ledger` 同时服务 production planning 与 chapter input，当前没有覆盖完整所有权的通用 edit-bible 模块；`src/lib/storage` 横跨 assets、workers、provider shared utilities 与 public media route。两者不应被强塞进单一现有模块，保留为需要独立所有权设计的路由盲区。

## 验证计划与盲区

- 直接运行显式多路径模式，验证单模块、多模块和未映射逐文件输出及匹配依据。
- 用当前真实 worktree 验证 modified/untracked 的逐文件报告；用纯 Git porcelain parser 规格验证 staged、rename、copy、delete 与空 snapshot，不为测试改写用户文件。
- 运行 `check:architecture-docs` 与完整 `check:architecture`，证明 manifest、文档和 guard 挂载仍有效。
- 运行 prompt i18n/semantic guards、Golden provider self-test 和适用 structured preview canonical Journey。产品 observable 不变，因此 Journey scenario contract 不适用修改；原场景必须实际通过才可声明验证。
- 盲区：路径路由不能自动理解 import 或业务语义；manifest 覆盖仍需维护。standards pricing/capability 与运行时代码 catalog 的双表示不是本阶段解决的问题。真实外部模型对 Prompt 的服从程度仍不由 deterministic fixture 证明。

## 验证结果

- `npm run architecture:impact -- <代表路径...>`：逐文件正确显示单模块、多模块、模块文档自身、pricing/capability/prompt-canary 与未映射结果；未映射正常退出。
- `npm run architecture:impact -- --changed`：从当前真实 Git worktree 逐文件列出 tracked 与 untracked 变化；rename/copy/delete 与空 snapshot 由同一纯 parser 规格覆盖。
- `npm run typecheck`：passed。
- `npm run test:logic`：94 files、424 tests passed，0 failed/skipped；包含 architecture impact 2 tests。
- `npm run check:prompt-i18n`、`check:prompt-i18n-regression`、`check:capability-catalog`、`check:pricing-catalog`：passed。
- `npm run check:architecture`：passed；10 个架构模块、53 个 mandatory guards 全部有效。
- `npm run test:golden:self`：7 files、36 tests passed，0 failed/skipped；34 个 canonical scenarios 全部挂载，MySQL/Redis scope isolation passed。
- `npm run test:golden:variant:structured-preview`：2 Playwright scenarios passed，0 failed/skipped。产品 observable 未改变，因此 scenario contract 不适用修改；原 canonical source setup 与 processing-time structured preview 均通过。
