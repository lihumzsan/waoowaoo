<!-- architecture-module: canvas-node -->

# Canvas 节点与投影

## 设计理念

Canvas 是正式领域 View 与持久 Resource View 的可视化投影，不是业务状态机。节点 identity、存在性、生命周期、内在动作能力和内容都必须来自生产 registry、正式 Query、Resource、Lineage 与 Task owner；系统不存在供 Canvas 消费的主链、阶段或下一步。

## 不变量

- **CN-01 — 节点种类穷尽注册。** 每种 kind 的 identity、layout、renderer、Task-start materialization 与 conformance fixture 只由 `WORKSPACE_CANVAS_NODE_REGISTRY` 声明。新节点不得通过分散 switch 接入。
- **CN-02 — canonical identity 只来自持久事实。** Creative 结果和媒体只使用 `resourceId`；可选 Chapter 使用其领域 identity；active Task 只按声明的稳定 target 提前物化同一节点。禁止使用数组位置、最近记录、Prompt、DOM、历史消息或旧 EditScript bridge 推导 identity。
- **CN-02A — Task 启动只提供物化与运行事实。** active Task target 已携带稳定资源 ID 时，projector 在正式 Query 到达前也必须物化同一节点。Task target 不得替代最终内容或领域成功事实。
- **CN-02B — 节点物化单调。** canonical identity 一旦由持久 Resource 或 Task target 建立，不得因 Task 先于 Query 消失而撤销节点。交接只能由相同 owner Task identity 的正式 Resource materialization 完成。
- **CN-02C — 节点与动作不受流程解释。** 任一持久 CreativeResource 或 active Resource Task 都可按自身 canonical identity 物化；不得恢复 Workflow step、stage rank、`allowedOperationIds`、时长分支或推荐位置。卡片能力只来自节点 registry、Operation channel 与显式 scope/input。
- **CN-02D — ResourceCard 优先复用专业节点。** `CreativeResource.origin(sourceType, sourceId)` 能与已有专业节点 identity 对齐时，Resource provenance、Lineage、Prompt 和模型信息必须附加到该专业节点，不得再生成一个重复通用节点；无法匹配专业 renderer 时才创建通用 text/image/audio/video ResourceCard。`schemaId` 表达专业语义，`mediaType` 只选择 fallback。
- **CN-02E — 批次、alternatives 与当前选择不改变节点事实。** 每个 Resource 始终按自己的 identity 形成节点；Prompt Set、多角色音色和 Manifest 多资产等领域批次只用 `memberIndex` 保持稳定展示顺序，不合并成候选节点。只有一次 generation request 实际创建两个以上结果时，Resource View 才下发 opaque alternatives group identity 与完整有序成员；单结果不伪造组。组也不合并节点、不产生同组 edge、不保存 selected/current/adopt；预览左右浏览的 index 只是 modal UI 状态。当前项仍只来自服务端 typed current selection，renderer 不得通过数组位置、当前 head 或本地选中态覆盖它。
- **CN-03 — 运行展示无裁决权。** Creative reasoning 与 Task progress 只在 Assistant/Task 运行视图展示，不能创建 Canvas 领域节点或写业务状态；正式物化 Resource 才能接手结果。
- **CN-04 — 生命周期只有一个 resolver。** 持久 Resource、Task runtime 与纯 UI disclosure 是独立输入；projector/renderer 不得自行根据文案、有无字段、timer 或 refetch 推断 succeeded/failed。
- **CN-05 — UI 不展示领域 ID。** raw preview 展示名称/短引用，正式 View 展示服务端按 canonical identity 投影的当前名称。缺少 View 必须显式失败，不得 `name ?? id`。
- **CN-06 — 视频只作为 Resource 或真实 Task 投影。** Canvas 不存在 Storyboard、Panel、VideoGroup、EditScript stage 或专用 `videoPlan` 流程节点。每个生成结果是独立 video Resource；需要表达 Chapter/镜头语义时由 schema 与真实 Lineage 附加，不能改变 lifecycle 或建立第二生成入口。
- **CN-07 — 专业文字结果仍是 Resource。** 剧本、Chapter Continuity Plan、asset/video prompt 与 music direction 通过 schema-aware Resource renderer 展示；不得恢复独立 Story Canon、continuity analysis、制作规划、镜头执行或风格预览专用阶段卡。
- **CN-08 — 同步与异步写入都精确交接 Query。** 同步 Operation、异步 Resource 的提交事务和 Task Terminal 只通过注册的 `affectedResources` 发布可 replay 事实；提交事件只公布已经持久化的 pending Resource，终态事件只公布 Terminal 已结算事实。客户端只 invalidate/refetch 正式 Query，禁止从 TaskType、target、operation output 或本地 baseline 猜更新。
- **CN-09 — 最终成片仍是普通视频。** 完成的章节视频与最终渲染都投影为普通 video ResourceCard，只由名称、schemaId 或 typed current-selection kind 表达用途；不得注册 `finalTimeline/finalOutput/finalArtifact` 专用节点或 renderer。渲染中的 Task 由通用 Task/Assistant 生命周期展示，成功媒体到达后才作为普通 VideoCard 进入 Canvas。
- **CN-10 — 连线只表达真实 Lineage。** Resource edge 必须来自持久 `inputResourceId → outputResourceId` Lineage；推荐顺序、Canvas 邻近、Workflow step、同批成员或共享 episode 都不能产生边。没有实际引用的两个独立节点保持不连接。
- **CN-11 — 媒体 presentation 只来自 profile 契约。** 卡片形态与尺寸由 `node-presentation-profiles.ts` 按媒体族穷尽声明：image/video 为 `frame`，其画幅只按“生成时冻结的 aspectRatio → 已完成媒体 width/height → Asset Format Policy → 项目 videoRatio”解析；audio 为 `bar` 矮条、text 为固定 `card`。pending 生成外壳与就绪媒体共用同一 shell，完成时不跳变；资产图由同一 shell 声明 `contain`，不得裁切人物、场景或道具。projector 与 renderer 只消费解析后的 shell，禁止各自按媒体类型分支尺寸。折叠卡只显示标题、状态与媒体本体（或生成外壳），不显示提示词、引用列表、进度条或任何领域 ID；生成中呈现为阶段文案（submitted/queued/generating，`saving` 为预留映射位）加模拟百分比，超时后只显示已等待时长，永不钉在 99%。
- **CN-12 — 详情卡是唯一展开机制。** 选中节点在其正下方渲染唯一详情卡（ReactFlow viewport 层，跟随画布坐标），内容只消费该卡 View 的 prompt provenance 与服务端一次性下发的 `inputSummaries`；UI 不得按 resourceId 零散请求或推断引用。取消选中或点击空白关闭。不存在第二种展开/收起或 disclosure 状态。
- **CN-13 — 新批次只调整一次整体视口。** Assistant Session 投影的持久 Task batch identity 是自动定位的唯一请求身份；批次至少一个 durable target 物化成 Canvas 节点后，只对当前整个 Canvas 执行一次 `fitView`。同批成员的 queued/running/terminal 变化、查询刷新和节点顺序变化都不得再次移动视口；用户拖拽、平移或缩放立即终止本次动画并把该批次标记为已处理。禁止按第一个 running 节点轮换、单节点放大、timer 恢复跟随或从 Operation 名称推断焦点。
- **CN-14 — Canvas 直接动作只复用正式 Operation。** 卡片 retry、variant、edit、创建与上传必须从最终 Card/Action View 构造 exact Resource scope，经同一个 plan/snapshot/grant/execute 或 direct Operation adapter 写入；UI 不插入假 Resource、不改本地生命周期，只把成功 execute ACK、mutation receipt 或 SSE 作为正式 Query 失效信号。付费动作一次用户意图持有稳定 `Idempotency-Key/operationRequestId`，并只批准当前展示的完整计划。
- **CN-14A — Canvas 表单只消费服务端能力边界。** 新建菜单与基础表单只消费生产 Operation registry 投影的 capability catalog，包括候选数量、时长与 Voice 文本上限；catalog 失败必须显式提供重试，不得静默表现为只剩上传。表单校验只改善即时反馈，最终业务输入仍由同一个 Operation schema 与 planner 裁决。
- **CN-15 — 选择与 Assistant 草稿各有唯一 UI owner。** `ProjectWorkspace` 持有唯一 Canvas selection，Canvas、Context Chip 与 send context 都消费同一值；清除 Chip 必须清除 Canvas 选中。快捷语义动作只发送一次性受控 draft-prefill/focus 命令，不创建全局事件总线或第二份 selection。
- **CN-16 — Canvas 没有可见性覆盖层。** 节点隐藏与 Resource 归档两个组织动作已整体删除:详情操作栏不再提供 hide/show/archive/restore，节点 action key 联合类型与 registry 声明同步收敛，canvas-layout 契约不再携带 `hidden`，Canvas 只按投影结果渲染全部节点。渲染层不得重新引入第二可见性解释(本地 override、隐藏集合或按 `archivedAt` 过滤);`project_canvas_node_layouts.hidden` 列待独立授权 migration 清理前必须保持无 writer、无 reader。

## 权威入口

- 节点 registry：`src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts`。
- 媒体 presentation 契约：`src/features/project-workspace/canvas/node-presentation-profiles.ts`（每媒体族 shell 声明与唯一尺寸 resolver）。
- 新批次整体视口定位：`src/features/project-workspace/canvas/hooks/useCanvasFocusFollow.ts`；批次身份与 durable target 只来自 Assistant Session View。
- 投影编排：`src/features/project-workspace/canvas/projection/workspace-node-canvas-projection.ts`。
- Resource 投影与通用 fallback renderer：`workspace-node-resource-projection.ts`、`nodes/renderers/resource-card.tsx`、`nodes/renderers/resource-media-shell.tsx`；Resource View 来自 `src/lib/creative-resource/view-service.ts`。
- 选中详情卡：`src/features/project-workspace/canvas/details/WorkspaceNodeDetailsCard.tsx` 负责 viewport 定位与宽度，唯一展示实现在同目录 `WorkspaceNodeDetailsPanel.tsx`；数据只来自 card View（prompt provenance + `inputSummaries`）。详情卡提示词只读可复制；已有 Resource 的修改一律经 Assistant 通道产生新 Resource，Canvas 不提供人工改写历史输入的入口。
- 画布创建占位卡：`create/WorkspaceCanvasCreateDock.tsx`。双击空白产生的多实例纯 UI 草稿（不注册节点 kind、不写任何持久层），提交只走通用 Operation 通道（能力来自服务端 creation 声明），上传只走既有上传队列两段式协议；刷新丢弃未提交草稿属预期。
- Canvas 直接动作、创建、上传和 Assistant 预填：`src/features/project-workspace/canvas/actions/**`、`canvas/upload/**` 与 `ProjectWorkspace` 的受控 selection/draft bridge；服务端写入仍只走 Operation adapter。
- 节点位置与隐藏：`src/lib/project-canvas/layout/**` 与 `/api/projects/[projectId]/canvas-layout`；不存在第二隐藏集合或 route。
- 可选领域事实投影必须先对齐 Resource origin/lineage；不存在 planning/asset-execution/video-stage projector。
- 音频与成片同样使用普通 Resource 投影，不得恢复声音或最终阶段节点。
- 唯一 lifecycle resolver：`src/features/project-workspace/canvas/lifecycle/**`。
- 资源通知契约：`src/lib/workspace-resource/resource-impact.ts`、`resource-change-publisher.ts`。

## 验证

- `tests/contracts/canvas-node-conformance.test.ts` 从生产 registry 穷尽校验 kind/capability/renderer/fixture，并校验媒体 presentation 契约对全部 media type 穷尽、frame shell 按画幅比解析。
- Canvas 的布局、卡片、刷新、媒体展示和真实 Resource/Task/Lineage 组合没有稳定独立 oracle，使用 authenticated 产品人工复验；不再维护 projection snapshot 或脚本创作 Journey。
- alternatives 的独立 Resource、左右浏览、多媒体 renderer、付费确认、上传两段恢复、归档/隐藏恢复同样属于 authenticated 产品人工复验；静态验证只能证明 registry、类型和唯一协议接线。

## 历史回归

- BGM/环境音曾以 planner stream、BgmDesign、MusicScore 和最终节点依次交接，任何 owner 字段或 Query 条件漂移都会制造空窗。当前音乐方向是普通 Creative Resource，生成音乐是普通 audio Resource，最终输出是普通 video Resource；同一 Task 的正式 Revision只接手自己的 presentation，不再跨阶段交接。
- 旧结构化 accumulator 只存在组件内存，刷新后镜头计划与 BGM presentation 会形成空窗；后续即使补上 stream checkpoint，仍让 Canvas 解释了第二份制作状态。当前结构化 stream 与制作规划节点整体删除：Task 只展示运行事实，持久 Resource 只通过正式 Query 与 `affectedResources` 接手内容，刷新不再依赖内存 delta 或阶段恢复。

- Storyboard/Panel 曾把“文本镜头记录存在”误解释为“图片已成功”，18 个未提交图片 Task 的节点因此同时显示成功。首次修正只分离 Panel 与媒体 lifecycle，仍保留了不再需要的分镜图阶段。当前防线直接删除 Panel/图片节点与全部入口。
- 多章节“全部”范围曾因 nullable 单实例 `editScript` 而不投影任何 VideoGroup，最终时间线却另外统计到视频；后续修复又依赖 `segmentIndex/gridMode`。当前每个 Chapter/媒体 Resource 都按自身 identity 投影，Canvas 不维护 episode 级 VideoGroup。
- BGM 节点曾早于真实音频事实出现；后续加入独立环境音时复用了旧阶段阈值。当前音频节点只来自实际 Resource/Task，Canvas registry、renderer 与 layout 不再解释声音工作流。
- 正式 View 曾在名称缺失时回显 locationId/characterId/shotId/sourceId；当前 projector 必须从 canonical identity 投影当前名称或显式拒绝，renderer 永不显示领域 ID。
- Segment 收敛后，Canvas 每张视频卡曾复用无目标的 episode 级 action，导致全部卡片得到同一总价，单卡点击也真实提交全部 Segment；本地 `submittingNodeIds` 只标记点击卡片，无法纠正服务端批量事实。当前 projection 从同一卡片 View 构造精确 scope，计费 request 的 cache identity 包含该 scope，服务端 planner 决定唯一 Task 集合。
- Workflow 曾同时裁决节点可见性与 Operation 可用性，Canvas 还维护独立 stage rank；首次修正只把主链降级为 recommendation，仍保留第二解释源。当前 WorkflowView 整体删除，projector 只读取领域、Resource 与 Task 事实。
- Canvas 收费按钮曾在依赖资源尚未完成时缓存 plan preflight 的 `NOT_READY`；Task 终态虽然通过显式 `affectedResources` 刷新了正式领域 Query，却没有让由这些资源派生的 operation plan preview 失效，执行计划已 `ready` 后按钮仍保持旧错误。当前统一资源变更同步会按 project 同时 invalidate 全部 plan preview；服务端 plan/execute 的内容重验证仍是审批正确性的唯一裁判，客户端失效只负责展示最新报价 View。
- Resource 提交曾只显示 Assistant 回执，Canvas 要等媒体终态才看见节点和 prompt；专业源剧本 origin 匹配错误又生成 raw JSON 重复卡，规划 projector 还会凭来源种类创建空制作规划和主链假连线。当前 pending Resource 提交事务立即触发正式 Query，renderer 从冻结 Task payload 展示 prompt；专业 origin 只匹配真实专业 identity，所有非 Lineage 连线已删除。
- Workflow action gating 删除后，旧 Video Segment 卡仍按资产审核/镜头计划状态预取付费 plan，说明删除 gate 没有删除固定链。当前该专用 action policy 和 projector 一并删除；新的生成或重试只由显式 Resource 输入调用通用 Operation。
- Canvas 自动跟随最初为串行阶段设计：它持续选择“第一个 running 节点”，同批并发成员逐个终态时选择结果随之变化，并由 3 秒 timer 在用户操作后重新抢回视口。媒体卡同时把所有图片强塞进项目 `videoRatio` 外壳并使用 `object-cover`，4:3 资产图因此上下裁切。当前批次 identity 只触发一次全画布 `fitView`，用户操作立即终止；媒体 shell 由冻结执行事实、真实媒体尺寸和 Asset Format Policy 依次解析，资产完整显示。
- 通用 candidate/adoption 协议曾把 candidate set、selected binding 与整个组节点混在一起，但没有真实产品消费者；`494dacbc7` 因此删除全部死协议。当前 Canvas 的真实需求只恢复“同一次显式 generation request 的 alternatives”这一事实：组 owner 是初始 OperationExecution，成员仍是独立 Resource，View 只提供有序浏览；generic adopt、selected/current、组级 lifecycle 与组节点保持删除。
- Canvas 选中曾由 Canvas 本地 `selectedNodeId` 拥有、父级再保存一份派生 `assistantSelection`；Chip 即使清空父级也会被子级回写。当前父级是唯一 selection owner，Canvas 与 Assistant 都受控消费同一值。

## 修改检查表

1. 新节点是否完整注册且 identity 来自正式领域资源或 CreativeResource？
2. materialization、lifecycle、stream presentation 和 UI 选中态是否仍为独立输入？卡片尺寸/形态是否只来自 presentation 契约？
3. 是否重新引入 Panel/Image/VideoGroup、历史推断、timer/refetch 正确性或 ID fallback？
4. 专业 origin 是否复用专业 renderer，通用 fallback 是否避免重复节点？
5. 是否用 Workflow、布局或同批关系伪造了可见性或 Lineage edge？
6. 是否明确了需要人工复验的 Canvas observable，而不是机械新增快照测试？
