<!-- architecture-incident: style-preview-projection-regression-2026-07-12 -->

# 视觉风格生成与 Style Bible 投影回归

## 分类与目标

本事故属于 D 类 Architecture Incident。`generate_edit_style_previews` 的领域写入、Task、Wait 与最终 Choice 均已存在唯一 owner，但 2026-07-11 的 Assistant/Task 生命周期收敛删除了原视觉风格生成卡，并留下了两个未被真实 Journey 观察的投影缺口：Task 已提交时正式 Bible Query 不刷新；`confirm_edit_style_preview` 已写入 `styleBibleJson` 时同步 Operation 结果没有被资源影响 authority 识别。

本阶段目标：

1. 右侧 Assistant 恢复 Git 中最后一个只读版本的三候选生成卡视觉与行为；候选标题、文案、图片、独立运行/失败/完成状态和预览交互保持原样。
2. Canvas 不再投影三个 `editStylePreview` 候选节点，只投影一个稳定身份的 `editStyleBible:${editBible.id}` 节点。
3. Style Bible 节点在候选 Task 活跃时显示运行中，在候选完成后显示等待用户选择，确认后以相同 node identity 原地显示正式 Style Bible。
4. Task/Operation 写入只通过现有 `workspace-resource` 影响 authority 通知正式 Query 重读；不新增局部 invalidate、轮询或 Cache writer。
5. 现有持久 Choice 与 `confirm_edit_style_preview` 继续分别作为用户决定和领域写入的唯一入口。

## 非目标与禁止范围

- 不恢复旧生成卡中的 `useConfirmProjectEditStylePreview`、专用 PATCH route、空 interruption 续跑或任何客户端领域写入。
- 不恢复 `refetchInterval`、承担正确性的 timer、历史 message 扫描、DOM/文案推断或 Session 的 `activeStylePreviewGeneration` 特例。原 UI 使用的共享 `useEstimatedTaskProgress` 秒级 tick 只估算环形进度，不决定候选生命周期或 Query 刷新，可继续复用。
- 不改变计费、Approval、Task 创建、Wait、Choice Offer/Decision 或 provider 调用协议。
- 不把三个候选图片作为 Canvas 节点；Canvas 只承载整体 Style Bible 生命周期和最终持久内容。
- 不修改其他媒体节点、其他 Operation 的 UI 或当前并行的 Canvas motion / chapter plan 任务文件。
- 不通过 optimistic `setQueryData` 构造 Style Bible；正式 Bible Query 是内容的唯一 Cache writer。

## 并行任务边界与文件所有权

当前 worktree 已存在其他任务的 staged/untracked 改动。本事故只拥有视觉风格投影相关 hunk。`docs/architecture/modules/canvas-node.md` 与 `docs/architecture/modules.json` 是共享文件，只允许追加本事故独立不变量/映射，提交前必须按 hunk 隔离；不得带入已有 Canvas motion 改动。`tests/golden-journey/contracts/scenarios.ts` 与 `structured-stream-preview.spec.ts` 已被并行任务占用，本事故不得修改。

## 全部入口与交接

| 入口/阶段 | 当前 owner | 本阶段结果 |
| --- | --- | --- |
| 视觉风格计划与报价 | `generate_edit_style_previews.plan` | 不变；候选行仍由计划阶段持久化 |
| Approval 与批准执行 | Operation Approval/Execution | 不变 |
| 三个图片 Task 创建 | `submitApprovedOperationPlanTasks` | 不变；提交结果必须由资源影响 authority 通知 Bible 重读 |
| Task queued/processing/terminal | Task DB、worker、Terminal Service | 不变；共享 View 只消费 target runtime |
| Assistant 运行中展示 | presentation registry → shared Style Preview Set View → 原只读 renderer | 恢复，禁止写入和轮询 |
| Canvas 运行中展示 | `useWorkspaceNodeCanvasProjection` → `workspace-node-runtime` | 单一 `editStyleBible` 节点聚合三个 Task target |
| 用户选择 | 持久 style Choice | 不变 |
| Style Bible 写入 | `confirm_edit_style_preview` / `confirmProjectEditStylePreview` | 不变；Operation 输出必须被资源影响 authority 识别 |
| 刷新/断线恢复 | Session snapshot、正式 Bible Query、Task target Query、SSE replay | 不从历史消息重建候选卡；重读相同事实得到相同 View |
| 调试入口 | Golden 只读 oracle、Task/Operation/Run/Wait 数据 | 不新增写入入口 |

## 状态与实体所有权

| 事实 | canonical identity / scope | 唯一 owner / writer | 消费者 |
| --- | --- | --- | --- |
| 候选定义、文案、图片与持久状态 | `ProjectEditStylePreview.id`，project + episode + editBible | `prepareProjectEditStylePreviewCandidates`、对应 image worker/terminal projector | Shared View、Assistant |
| 候选运行状态 | `Task.targetType=ProjectEditStylePreview + targetId` | Task lifecycle | Shared View、Canvas/Assistant |
| 整体 Style Bible Canvas identity | `editStyleBible:${ProjectEditBible.id}` | Canvas node-id contract；无持久写入 | Canvas |
| 最终 Style Bible 内容 | `ProjectEditBible.id/styleBibleJson` | `confirm_edit_style_preview` | Shared View、Canvas、后续生成链 |
| 用户选择 | style ChoiceDecision 的 `stylePreviewId` | Choice canonicalizer | `confirm_edit_style_preview` |
| Query 失效通知 | `WorkspaceResourceRef` | `workspace-resource/resource-impact.ts` | SSE resource sync |

## 生命周期与时序

| 时序 | Assistant | Canvas `editStyleBible` | 权威事实 |
| --- | --- | --- | --- |
| 未报价/未批准 | 无候选生成卡 | 无节点 | 无已提交候选 Task |
| Approval pending/rejected/canceled | Approval 或拒绝结果 | 无运行节点 | 无 committed Task |
| 提交成功、queued/processing | 原三候选生成卡；每项独立状态 | 同一 node id，整体 running | 候选行 + 三个 target Task |
| 部分成功/部分仍运行 | 已完成项展示图片，其余保持原运行 UI | 仍 running | item Task 状态 |
| 某项 attempt 失败但仍可重试 | 保持运行，不写最终失败 | 仍 running | Task 尚未最终失败 |
| 全部终态且有失败/取消 | 原失败 UI | 同一 node id failed/canceled | 最终 Task + preview status |
| 全部成功、Choice 尚未提交 | 持久 Choice 卡展示三候选 | 同一 node id 等待选择 | previews completed、无 styleBibleJson |
| 重复/晚到/replay | target identity/watermark 拒绝旧覆盖 | 不新增节点、不退回 running | Task/SSE identity |
| 用户确认 | Choice 消费后由 AI 调用唯一 Operation | 同一 node id 原地转为 succeeded | preview confirmed + styleBibleJson |
| 刷新/断线 | 正式 Query/Session/Task snapshot 重建相同 View | 相同 identity、phase、内容 | durable facts |

超时只界定测试失败，不写业务状态。用户取消 Approval 不创建 Task；生成 Task 的取消按 Task terminal contract 投影。确认 Operation 失败时 Choice/Run 按现有协议显式失败，Canvas 保持正式 Query 中的最后事实，不构造 Style Bible。

## 事务、幂等与恢复

- 三个 Task、billing、Created Event、enqueue Outbox、OperationExecution 与 preview `taskId/status=generating` 保持现有单事务。
- Task 提交结果和同步 Style Bible 确认结果必须通过现有 `extractWorkspaceResourceRefsFromWriteResult` 的显式 target 语义生成 `WorkspaceResourceRef`；通知失败不写假 Cache，刷新/重连从正式 Query 恢复。
- Task 终态仍先持久化 preview/Bible 业务事实，再携带 `affectedResources`。
- 候选 Task 的 dedupe、provider invocation、retry、late terminal 与 Wait 聚合不改变 owner。
- Assistant renderer 不持久化候选快照；首屏和 reload 都从正式 Query 与 target runtime 投影。

## 删除项与数量变化

必须删除：Canvas `editStylePreview` kind、node-id、registry definition、renderer、presentation profile、conformance fixture与候选 node/edge 分支；`data-edit-style-preview-generation` 的隐藏历史协议残留在新 active presentation 接管后删除。

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| Style Bible 领域 writer | 1 | 1 |
| Style Choice 写入入口 | 1 | 1 |
| Canvas 风格节点 kind | 2（preview + bible） | 1（bible） |
| 同一 Style Bible 生命周期 Canvas identity | 候选 3 个 + 最终 1 个 | 1 |
| Assistant 候选状态解释 | 通用运行行且无候选 View | 1 个 shared resolver |
| Canvas 候选状态解释 | 每候选 node runtime | 同一 shared resolver 的 aggregate |
| 正确性轮询/timer/fallback | 0 | 0 |
| 纯展示进度估算入口 | 0（卡片被删除） | 1（共享 `useEstimatedTaskProgress`） |

## 原 UI 参照物

视觉与行为参照为提交 `90acd022846b60ad4e0826025c4c5f2f29733c31` 之后、`a4aed5ba47af15788109094c74bac07a9b9cb516` 删除前的 `EditStylePreviewGenerationDataCard`。仅复用其 DOM 层级、className、标题/计数/失败文案、焦点候选、小行候选、进度环、加载面、图片预览行为；数据查询、轮询和选择写入不得恢复。

## 测试计划与盲区

1. Logic Specification：共享 resolver 覆盖 queued、partial complete、retrying、failed/canceled、ready-for-choice、confirmed、晚到旧状态优先级。
2. Canvas Registry Conformance：从生产 registry 穷尽证明删除 `editStylePreview` 后 definition/renderer/fixture 仍一一对应，`editStyleBible` 声明 task runtime capability。
3. 既有 Golden 主链扩展：真实 Approval 后在 provider Task 尚运行时，Assistant 必须显示三候选原 UI，Canvas 必须只有一个运行中的 Style Bible 且不存在候选节点；Choice 后同一 node identity 显示正式 Style Bible；reload 后一致。
   Workflow Lab 的 `bible_ready_for_review`、`style_preview_generating` 与 `needs_style_choice` checkpoint 必须清除未来的 `ProjectEditBible.styleBibleJson`，否则测试会把已确认内容泄漏到待生成/待选择阶段，无法作为独立 oracle。
4. fail-before：当前代码会在“Assistant 三候选生成卡可见”和“确认后同一 Style Bible 节点出现”断言失败。
5. 未验证盲区：真实付费 provider 的进度粒度和外部生成质量不在本地零成本 provider 证明范围；若 Golden 基础设施不可用，必须报告未验证，不得宣称阶段完成。

## 完成级别门禁

- 实现完成：代码、Logic/Conformance 与结构检查通过，Golden 未运行时明确标注组合盲区。
- 阶段完成：Incident、模块文档、共享契约、唯一 View、删除项和适用 Golden red/green 齐备。
- 架构完成：仅在 writer/入口/identity 数量符合上表、无残余候选 Canvas kind、无轮询/特殊 Session projector、真实生成中与确认后 reload 场景通过时成立。

## 本次验证记录

- `npm run test:logic`：93 个文件、422 个断言通过，0 skipped/todo。
- `npm run test:conformance`：3 个文件、92 个断言通过，0 skipped/todo。
- `npm run test:golden:self`：7 个文件、35 个断言通过；mount 与独立 MySQL/Redis scope 自检通过。
- `npm run test:golden:discovery` 第二次执行中，完整 mainline、`STEP-SCRIPT`、新增 `STEP-BIBLE` processing UI oracle 与 `STEP-STYLE` 确认/reload oracle 均通过；它真实观察了三候选 Assistant 卡、单一运行中 Style Bible、零候选 Canvas 节点和确认后同 identity 的正式内容。
- 同一 discovery 执行在后续、非本事故触点的 `STEP-ASSET-APPROVAL-RECOVERY` 因 context API 404 超时，随后 stage probes 因登录态 401 级联失败；因此本次只能记为视觉风格阶段实现完成，不能把整条 discovery 或全系统宣称为阶段完成。失败 artifact 保留在 `artifacts/golden-journey/test-output`。
