<!-- architecture-module: canvas-node -->

# Canvas 节点与投影

## 设计理念

Canvas 是正式领域 View 的可视化投影，不是业务状态机。节点 identity、存在性、生命周期、动作许可和内容都必须来自生产 registry、正式 Query、WorkflowView 与 Task owner；UI 只消费最终 View。

## 不变量

- **CN-01 — 节点种类穷尽注册。** 每种 kind 的 identity、layout、renderer、stream capability、Task-start materialization 与 conformance fixture 只由 `WORKSPACE_CANVAS_NODE_REGISTRY` 声明。新节点不得通过分散 switch 接入。
- **CN-02 — canonical identity 只来自领域事实。** 计划节点使用持久资源 identity；Video Segment 节点从 EditScript View 使用与 planner 相同的确定性 `ProjectVideoSegment.id`，即使资源行尚未创建也不得回退为临时组合字符串；其领域唯一性由 `(editScriptId, segmentId)` 保证。禁止使用数组位置、最近记录、Prompt、DOM 或历史消息推导 identity。
- **CN-02A — Task 启动只提供物化与运行事实。** active Task target 已携带稳定资源 ID 时，projector 在正式 Query 到达前也必须物化同一节点。Task target 不得替代最终内容或领域成功事实。
- **CN-02B — 节点物化单调。** canonical identity 一旦由持久记录、Task target 或 structured stream 建立，不得因 stream/Task 先于 Query 消失而撤销节点。交接只能由相同 owner task identity 的正式资源完成。
- **CN-02C — 下游节点只消费 Workflow 能力。** 普通投影中，BGM/Ambient Sound 只在 `audio_plan`，最终时间线只在 `final_render`。历史资源或 active Task 可以稳定物化节点，但动作必须仍来自 `WorkflowView.operationPolicy.allowedOperationIds`。
- **CN-03 — 流式预览无裁决权。** 每种 stream payload 必须复用 worker 接收的 production raw schema，并声明 stable item key 与 merge rule。stream parse 失败不写业务失败，completed stream 只是可丢弃 presentation handoff。声音阶段只有 `audio_design_plan` 一个 planning stream；BGM 与 Ambient Sound 两个节点可投影同一 AudioDesign 的不同 View，并以同一个 AudioDesign taskId 完成正式 Query 交接。生成 Task 只提供各自产物 lifecycle，不得重新解释 plan。
- **CN-04 — 生命周期只有一个 resolver。** 持久资源、Task runtime、stream presentation 与纯 UI disclosure 是独立输入；projector/renderer 不得自行根据 `generating`、有无字段、timer 或 refetch 推断 succeeded/failed。
- **CN-05 — UI 不展示领域 ID。** raw preview 展示名称/短引用，正式 View 展示服务端按 canonical identity 投影的当前名称。缺少 View 必须显式失败，不得 `name ?? id`。
- **CN-06 — 视频节点只有 Segment。** Canvas 不存在 Storyboard、Panel Image、Shot Image、VideoGroup 或单镜头/连续/全能参考模式分支。每个 `videoPlan` 节点只投影一个 `ProjectVideoSegment`，展示时长、所属镜头、continuity 和成品视频；其收费 action 必须原样携带该节点的 `chapterId + editScriptId + segmentId`，报价与执行不得退化为 episode 批量 scope。
- **CN-07 — 镜头执行节点只展示三项决策。** 只有景别、运镜方式与运镜稳定性。机位、焦段、构图、灯光、blocking、站位、物体与空间档案不得投影。
- **CN-08 — 同步与异步写入都精确交接 Query。** Task Terminal 与同步 Operation 只通过注册的 `affectedResources` 发布可 replay 事实；客户端只 invalidate/refetch 正式 Query，禁止从 TaskType、target、operation output 或本地 baseline 猜更新。

## 权威入口

- 节点 registry：`src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts`。
- 投影编排：`src/features/project-workspace/canvas/projection/workspace-node-canvas-projection.ts`。
- 计划/资产/执行投影：`workspace-node-{planning,asset-execution}-projection.ts`。
- Segment 投影：`workspace-node-video-segment-projection.ts`；音频/成片：`workspace-node-audio-final-projection.ts`。
- 唯一 lifecycle resolver：`src/features/project-workspace/canvas/lifecycle/**`。
- structured stream：`src/features/project-workspace/canvas/structured-stream/**`。
- 资源通知契约：`src/lib/workspace-resource/resource-impact.ts`、`resource-change-events.ts`。

## 验证

- `tests/contracts/canvas-node-conformance.test.ts` 从生产 registry 穷尽校验 kind/capability/renderer/fixture。
- `tests/unit/project-workspace/**` 验证纯 projection、lifecycle、stream handoff 与多章节 Segment 物化。
- `tests/golden-journey/journeys/mainline-complete.spec.ts` 在真实主链中对齐 `ProjectVideoSegment` 数量、节点/播放器数量、Ambient Sound/BGM/最终时间线和刷新后 identity。

## 历史回归

- BGM/Ambient Sound 的生成 Task 曾覆盖资源 `taskId`，Canvas 又把该字段当作规划 stream 的终态 owner，导致正式资源虽已成功，规划 presentation 仍会在交接时短暂清空。第一次修正为两个资源分别增加 `planTaskId`，只修复交接，却固化了两个规划流。当前删除两套旧 adapter 和 `planTaskId`，一个 `audio_design_plan` stream 同时投影 score cue、ambience source 与 SoundWorld；两个节点以同一 AudioDesign taskId 交接，生成 runtime 仍保持各自产物 lifecycle。主 Journey 的同一 observer 对 Task identity、presentation 与正式资源交接连续性 fail closed。

- Storyboard/Panel 曾把“文本镜头记录存在”误解释为“图片已成功”，18 个未提交图片 Task 的节点因此同时显示成功。首次修正只分离 Panel 与媒体 lifecycle，仍保留了不再需要的分镜图阶段。当前防线直接删除 Panel/图片节点与全部入口。
- 多章节“全部”范围曾因 nullable 单实例 `editScript` 而不投影任何 VideoGroup，最终时间线却另外统计到视频；后续修复又依赖 `segmentIndex/gridMode`。当前投影从正式 `ProjectVideoSegment` 集合展平，identity 不再来自位置或生成模式。
- BGM 节点曾早于真实音频能力阶段出现；后续加入独立环境音时复用了旧可见性阈值。当前 BGM 与 Ambient Sound 统一只消费 Workflow `audio_plan` capability，两者保持独立节点与生命周期。
- 正式 View 曾在名称缺失时回显 locationId/characterId/shotId/sourceId；当前 projector 必须从 canonical identity 投影当前名称或显式拒绝，renderer 永不显示领域 ID。
- Segment 收敛后，Canvas 每张视频卡曾复用无目标的 episode 级 action，导致全部卡片得到同一总价，单卡点击也真实提交全部 Segment；本地 `submittingNodeIds` 只标记点击卡片，无法纠正服务端批量事实。当前 projection 从同一卡片 View 构造精确 scope，计费 request 的 cache identity 包含该 scope，服务端 planner 决定唯一 Task 集合。

## 修改检查表

1. 新节点是否完整注册且 identity 来自正式资源？
2. materialization、lifecycle、stream presentation 和 UI disclosure 是否仍为独立输入？
3. 是否重新引入 Panel/Image/VideoGroup、历史推断、timer/refetch 正确性或 ID fallback？
4. 受影响的 Golden observable 是否已同步？
