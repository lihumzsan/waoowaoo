<!-- architecture-module: canvas-node -->

# Canvas 节点与投影

## 设计理念

Canvas 是正式领域 View 与持久 Resource View 的可视化投影，不是业务状态机。节点 identity、存在性、生命周期、内在动作能力和内容都必须来自生产 registry、正式 Query、Resource、Lineage 与 Task owner；UI 只消费最终 View。主链 recommendation 可以帮助布局或提示，但不决定节点是否存在、Operation 是否可调用。

## 不变量

- **CN-01 — 节点种类穷尽注册。** 每种 kind 的 identity、layout、renderer、stream capability、Task-start materialization 与 conformance fixture 只由 `WORKSPACE_CANVAS_NODE_REGISTRY` 声明。新节点不得通过分散 switch 接入。
- **CN-02 — canonical identity 只来自领域事实。** 计划节点使用持久资源 identity；Video Segment 节点从 EditScript View 使用与 planner 相同的确定性 `ProjectVideoSegment.id`，即使资源行尚未创建也不得回退为临时组合字符串；其领域唯一性由 `(editScriptId, segmentId)` 保证。禁止使用数组位置、最近记录、Prompt、DOM 或历史消息推导 identity。
- **CN-02A — Task 启动只提供物化与运行事实。** active Task target 已携带稳定资源 ID 时，projector 在正式 Query 到达前也必须物化同一节点。Task target 不得替代最终内容或领域成功事实。
- **CN-02B — 节点物化单调。** canonical identity 一旦由持久记录、Task target 或 structured stream 建立，不得因 stream/Task 先于 Query 消失而撤销节点。交接只能由相同 owner task identity 的正式资源完成。
- **CN-02C — 节点与动作不受 Workflow gating。** 任一持久专业资源、CreativeResource、active Task 或 structured stream 事实都可按自身 canonical identity 物化；不得用 Workflow step、stage rank、`allowedOperationIds` 或推荐位置隐藏。卡片动作只来自节点 registry、Operation channel、显式 scope/input 与计费计划；主链 recommendation 只用于非约束性引导。
- **CN-02D — ResourceCard 优先复用专业节点。** `CreativeResource.origin(sourceType, sourceId)` 能与已有专业节点 identity 对齐时，Resource provenance、Lineage、Prompt 和模型信息必须附加到该专业节点，不得再生成一个重复通用节点；无法匹配专业 renderer 时才创建通用 text/image/audio/video ResourceCard。`schemaId` 表达专业语义，`mediaType` 只选择 fallback。
- **CN-02E — 候选与采用不改变节点事实。** 同一 candidateSet 的多个 Resource 都保持独立 identity；选中项来自持久 Binding，未选候选仍可见且可继续被引用。renderer 不得通过数组位置、当前 head 或本地选中态覆盖 canonical Binding。
- **CN-03 — 流式预览无裁决权。** 每种 stream payload 必须复用 worker 接收的 production raw schema，并声明 stable item key 与 merge rule。stream parse 失败不写业务失败，completed stream 只是可丢弃 presentation handoff。声音阶段只有 `bgm_design_plan` 一个 planning stream 和一个 BGM 节点，并以同一个 BgmDesign taskId 完成正式 Query 交接。生成 Task 只提供 MusicScore lifecycle，不得重新解释 plan。
- **CN-04 — 生命周期只有一个 resolver。** 持久资源、Task runtime、stream presentation 与纯 UI disclosure 是独立输入；projector/renderer 不得自行根据 `generating`、有无字段、timer 或 refetch 推断 succeeded/failed。
- **CN-05 — UI 不展示领域 ID。** raw preview 展示名称/短引用，正式 View 展示服务端按 canonical identity 投影的当前名称。缺少 View 必须显式失败，不得 `name ?? id`。
- **CN-06 — 视频节点只有 Segment。** Canvas 不存在 Storyboard、Panel Image、Shot Image、VideoGroup 或单镜头/连续/全能参考模式分支。每个 `videoPlan` 节点只投影一个 `ProjectVideoSegment`，展示时长、所属镜头、continuity 和成品视频；其收费 action 必须原样携带该节点的 `chapterId + editScriptId + segmentId`，报价与执行不得退化为 episode 批量 scope。
- **CN-07 — 镜头执行节点只展示三项决策。** 只有景别、运镜方式与运镜稳定性。机位、焦段、构图、灯光、blocking、站位、物体与空间档案不得投影。
- **CN-08 — 同步与异步写入都精确交接 Query。** Task Terminal 与同步 Operation 只通过注册的 `affectedResources` 发布可 replay 事实；客户端只 invalidate/refetch 正式 Query，禁止从 TaskType、target、operation output 或本地 baseline 猜更新。
- **CN-09 — 最终成片仍是普通视频。** 完成的章节视频与最终渲染都投影为普通 video ResourceCard，只由名称、schemaId 或 Binding role 表达用途；不得注册 `finalTimeline/finalOutput/finalArtifact` 专用节点或 renderer。渲染中的 Task 由通用 Task/Assistant 生命周期展示，成功媒体到达后才作为普通 VideoCard 进入 Canvas。
- **CN-10 — 连线只表达真实 Lineage。** Resource edge 必须来自持久 `inputRevisionId → outputRevisionId` Lineage；推荐顺序、Canvas 邻近、Workflow step、同批候选或共享 episode 都不能产生边。没有实际引用的两个独立节点保持不连接。

## 权威入口

- 节点 registry：`src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts`。
- 投影编排：`src/features/project-workspace/canvas/projection/workspace-node-canvas-projection.ts`。
- Resource 投影与通用 fallback renderer：`workspace-node-resource-projection.ts`、`nodes/renderers/resource-card.tsx`；Resource View 来自 `src/lib/creative-resource/view-service.ts`。
- 计划/资产/执行投影：`workspace-node-{planning,asset-execution}-projection.ts`。
- Segment 投影：`workspace-node-video-segment-projection.ts`；音频/成片：`workspace-node-audio-final-projection.ts`。
- 唯一 lifecycle resolver：`src/features/project-workspace/canvas/lifecycle/**`。
- structured stream：`src/features/project-workspace/canvas/structured-stream/**`。
- 资源通知契约：`src/lib/workspace-resource/resource-impact.ts`、`resource-change-events.ts`。

## 验证

- `tests/contracts/canvas-node-conformance.test.ts` 从生产 registry 穷尽校验 kind/capability/renderer/fixture。
- `tests/unit/project-workspace/**` 验证纯 projection、lifecycle、stream handoff 与多章节 Segment 物化。
- `tests/golden-journey/journeys/mainline-complete.spec.ts` 在真实主链中对齐 `ProjectVideoSegment` 数量、节点/播放器数量、BGM、普通最终 VideoCard 和刷新后 identity，并断言旧环境音节点与完成态专用最终卡始终为零。
- `tests/golden-journey/journeys/freeform-resources.spec.ts` 从空项目验证通用媒体卡片、多候选、专业/通用 renderer 选择、Prompt/引用展示、Lineage edge、Binding 与刷新恢复。

## 历史回归

- BGM/环境音的生成 Task 曾覆盖资源 `taskId`，Canvas 又把该字段当作规划 stream 的终态 owner，导致正式资源虽已成功，规划 presentation 仍会在交接时短暂清空。第一次修正为两个资源分别增加 `planTaskId`，随后虽统一为 AudioDesign stream，仍保留两个节点。当前只剩 `bgm_design_plan` adapter、BGM 节点和 BgmDesign taskId 交接；主 Journey 的同一 observer 对 Task identity、presentation 与正式资源交接连续性 fail closed，并拒绝旧节点回流。
- 环境音链删除后，BGM 节点仍顺序承载 BgmDesign 与 MusicScore；主 Golden 首次暴露 BGM 空窗，完整 canonical suite 又稳定复现源剧本同类空窗。第一次根因是共享 release effect 用尚未合并 Task runtime 的原始投影判断可释放，DOM 却消费唯一 resolver 的最终 View；当前 release 只读取 `resolvedProjectedNodes`。解除 Workflow 占位后又暴露第二个同根因：Episode API 把 BgmDesign/MusicScore 错误包在必须先存在 FinalOutput 的汇总里，真实 BGM 已成功却没有正式 View 接手 stream。当前 Episode media View 在 BgmDesign、MusicScore 或 FinalOutput 任一真实资源存在时成立，BGM identity 仍为 episode，FinalOutput identity 只在真实渲染记录存在时出现；主 Golden observer 同时反证两种提前消失。

- Storyboard/Panel 曾把“文本镜头记录存在”误解释为“图片已成功”，18 个未提交图片 Task 的节点因此同时显示成功。首次修正只分离 Panel 与媒体 lifecycle，仍保留了不再需要的分镜图阶段。当前防线直接删除 Panel/图片节点与全部入口。
- 多章节“全部”范围曾因 nullable 单实例 `editScript` 而不投影任何 VideoGroup，最终时间线却另外统计到视频；后续修复又依赖 `segmentIndex/gridMode`。当前投影从正式 `ProjectVideoSegment` 集合展平，identity 不再来自位置或生成模式。
- BGM 节点曾早于真实音频能力阶段出现；后续加入独立环境音时复用了旧可见性阈值。当前 Workflow 只有 `bgmScore` capability，Canvas registry、node identity、renderer、action policy 和 layout 已删除环境音实例。
- 正式 View 曾在名称缺失时回显 locationId/characterId/shotId/sourceId；当前 projector 必须从 canonical identity 投影当前名称或显式拒绝，renderer 永不显示领域 ID。
- Segment 收敛后，Canvas 每张视频卡曾复用无目标的 episode 级 action，导致全部卡片得到同一总价，单卡点击也真实提交全部 Segment；本地 `submittingNodeIds` 只标记点击卡片，无法纠正服务端批量事实。当前 projection 从同一卡片 View 构造精确 scope，计费 request 的 cache identity 包含该 scope，服务端 planner 决定唯一 Task 集合。
- Workflow 曾同时裁决节点可见性与 Operation 可用性，Canvas 还维护独立 stage rank；新增 `render_chapters` 时漏接一个分支就隐藏真实产物。当前 projector 只读取领域/Resource/Task/stream 事实，主链 View 只提供 recommendation，不参与 materialization、action policy 或 edge。
- Canvas 收费按钮曾在依赖资源尚未完成时缓存 plan preflight 的 `NOT_READY`；Task 终态虽然通过显式 `affectedResources` 刷新了正式领域 Query，却没有让由这些资源派生的 operation plan preview 失效，执行计划已 `ready` 后按钮仍保持旧错误。当前统一资源变更同步会按 project 同时 invalidate 全部 plan preview；服务端 plan/execute 的内容重验证仍是审批正确性的唯一裁判，客户端失效只负责展示最新报价 View。
- Workflow action gating 删除后，Video Segment 卡片曾在资产审核或镜头执行计划尚未完成时就预取付费 plan，并在同输入视频完成后继续展示实际不可执行的“重新生成”；前者制造预期中的 500，后者与 planner 的幂等 `skip_completed` 冲突。当前专业卡片只用自身显式领域事实判断这一条内在 action 是否具备输入：资产已批准、执行计划 `ready`、没有 active Task 且没有同输入成品；这不影响 Agent registry 中 Operation 全量开放，新的自由变体由显式新输入或通用 `create_video` 表达。

## 修改检查表

1. 新节点是否完整注册且 identity 来自正式领域资源或 CreativeResource？
2. materialization、lifecycle、stream presentation 和 UI disclosure 是否仍为独立输入？
3. 是否重新引入 Panel/Image/VideoGroup、历史推断、timer/refetch 正确性或 ID fallback？
4. 专业 origin 是否复用专业 renderer，通用 fallback 是否避免重复节点？
5. 是否用 Workflow、布局或同批关系伪造了可见性或 Lineage edge？
6. 受影响的 Golden observable 是否已同步？
