<!-- architecture-module: canvas-node -->

# Canvas 节点与投影

## 设计理念

Canvas 是 WorkspaceResource 文件树的空间化投影，不是第二套文件系统或业务状态机。一个文件夹对应一个 Canvas；画布只展示该文件夹的直接子项。节点 identity、存在性、生命周期、动作能力和内容来自生产 registry、正式 Query、WorkspaceResource、Lineage 与 Task owner，Canvas 只拥有位置、视口、选择和临时创建草稿等纯展示状态。

## 不变量

- **CN-01 — 节点种类穷尽注册。** 生产 registry 只声明 `resourceCard` 与 `folder`，并为每种 kind 穷尽 identity、layout、renderer、Task target、动作能力与 conformance fixture。新增同类实例不得通过分散 switch 或文件存在性接入。
- **CN-02 — 一个文件夹就是一个 Canvas。** 持久 folder Resource 以自身 `resourceId` 作为 `folderKey`；项目根使用唯一虚拟 identity `@root`，永不创建伪 Resource。Canvas 不再按 Episode、Chapter、工作流阶段或媒体类别分区。
- **CN-02A — 节点 canonical identity 只来自 Resource。** file 节点和 folder 节点都使用各自的 `resourceId`；不得使用路径、数组位置、最近记录、Prompt、DOM、历史消息或 Task 到达顺序推导 identity。路径变化不改变节点 identity。
- **CN-02B — 当前 Canvas 只投影直接子项。** root 只显示根目录直接子项，folder Canvas 只显示 `workspacePath` 的直接子项；服务端从同一 Catalog 路径关系解析父目录，不能持久化第二份 parent 字段。后代必须进入对应文件夹后才显示。搜索可以跨项目返回结果，但选中结果前必须导航到其父文件夹，不能把后代临时混入当前 Canvas。
- **CN-02C — folder 是正式 Resource 与导航入口。** folder 节点消费服务端投影的名称、路径和 ancestors，双击进入、面包屑返回；folder 不携带媒体、Task target、生成动作或 Lineage handle。Canvas 不维护第二份目录结构。
- **CN-02D — 布局不改变文件归属。** 普通节点拖拽只写当前 `folderKey` 下的位置，绝不修改 `workspacePath`；移动文件或文件夹只能走 WorkspaceResource 的显式 move 能力。路径移动后由目标文件夹的正式 Query 决定节点出现位置。
- **CN-02E — 批次、alternatives 与当前选择不改变节点事实。** 每个 Resource 始终按自己的 identity 形成节点；Prompt Set、多角色音色和 Manifest 多资产等领域批次只用 `memberIndex` 保持稳定展示顺序，不合并成候选节点。只有一次 generation request 实际创建两个以上结果时，Resource View 才下发 opaque alternatives group identity 与完整有序成员；单结果不伪造组。组也不合并节点、不产生同组 edge、不保存 selected/current/adopt；预览左右浏览的 index 只是 modal UI 状态。当前项仍只来自服务端 typed current selection，renderer 不得通过数组位置、当前 head 或本地选中态覆盖它。
- **CN-03 — 运行展示无裁决权。** Task runtime 只能覆盖已由正式 WorkspaceResource 物化的 file 节点运行展示，不能凭 Task、Creative reasoning 或本地 optimistic 结果创建 Canvas 节点或写业务状态。
- **CN-04 — 生命周期只有一个 resolver。** 持久 Resource、Task runtime 与纯 UI disclosure 是独立输入；projector/renderer 不得自行根据文案、有无字段、timer 或 refetch 推断 succeeded/failed。
- **CN-05 — UI 不展示领域 ID。** raw preview 展示名称/短引用，正式 View 展示服务端按 canonical identity 投影的当前名称。缺少 View 必须显式失败，不得 `name ?? id`。
- **CN-06 — 视频只作为 Resource 或真实 Task 投影。** Canvas 不存在 Storyboard、Panel、VideoGroup、EditScript stage 或专用 `videoPlan` 流程节点。每个生成结果是独立 video Resource；分集/镜头等用户目录语义不能改变 lifecycle 或建立第二生成入口。
- **CN-07 — 专业文字结果仍是 Resource。** 剧本、连续性、资产/视频提示词与音乐方向都通过普通文本/结构化 Resource renderer 展示；不得恢复独立 Canon、连续性分析或专用制作阶段卡。
- **CN-08 — 同步与异步写入都精确交接 Query。** 同步 Operation、异步 Resource 的提交事务和 Task Terminal 只通过注册的 `affectedResources` 发布可 replay 事实；提交事件只公布已经持久化的 pending Resource，终态事件只公布 Terminal 已结算事实。客户端只 invalidate/refetch 正式 Query，禁止从 TaskType、target、operation output 或本地 baseline 猜更新。
- **CN-09 — 最终成片仍是普通视频。** 完成的章节视频与最终渲染都投影为普通 video ResourceCard，只由名称、schemaId 或 typed current-selection kind 表达用途；不得注册 `finalTimeline/finalOutput/finalArtifact` 专用节点或 renderer。渲染中的 Task 由通用 Task/Assistant 生命周期展示，成功媒体到达后才作为普通 VideoCard 进入 Canvas。
- **CN-10 — 连线只表达当前文件夹内的真实 Lineage。** Resource edge 必须来自持久 `inputResourceId → outputResourceId` Lineage，且 source 与 target 都已作为当前文件夹的直接子节点出现；推荐顺序、Canvas 邻近、Workflow step、同批成员、跨文件夹引用或共享 Episode 都不能产生可见边。
- **CN-11 — 文件夹化不得降级原卡片能力。** file 节点继续复用既有 text/image/audio/video 卡片、媒体 profile、详情卡、alternatives 预览、上传、创建、直接动作、拖拽和视口行为。媒体尺寸仍按“冻结 aspectRatio → 已完成媒体尺寸 → Asset Format Policy → 项目 videoRatio”解析；folder 只增加导航，不得另造简化文件列表替代 ReactFlow Canvas。
- **CN-12 — 详情卡是唯一展开机制。** 选中节点在其正下方渲染唯一详情卡（ReactFlow viewport 层，跟随画布坐标），内容只消费该卡 View 的 prompt provenance 与服务端一次性下发的 `inputSummaries`；UI 不得按 resourceId 零散请求或推断引用。取消选中或点击空白关闭。不存在第二种展开/收起或 disclosure 状态。
- **CN-13 — 新批次只调整一次整体视口。** Assistant Session 投影的持久 Task batch identity 是自动定位的唯一请求身份；批次至少一个 durable target 物化成 Canvas 节点后，只对当前整个 Canvas 执行一次 `fitView`。同批成员的 queued/running/terminal 变化、查询刷新和节点顺序变化都不得再次移动视口；用户拖拽、平移或缩放立即终止本次动画并把该批次标记为已处理。禁止按第一个 running 节点轮换、单节点放大、timer 恢复跟随或从 Operation 名称推断焦点。
- **CN-14 — Canvas 直接动作只复用正式 Operation。** 卡片 retry、variant、edit、创建与上传必须从最终 Card/Action View 构造 exact Resource scope，经同一个 plan/snapshot/grant/execute 或 direct Operation adapter 写入；UI 不插入假 Resource、不改本地生命周期，只把成功 execute ACK、mutation receipt 或 SSE 作为正式 Query 失效信号。付费动作一次用户意图持有稳定 `Idempotency-Key/operationRequestId`，并只批准当前展示的完整计划。
- **CN-14A — Canvas 表单只消费服务端能力边界。** 新建菜单与基础表单只消费生产 Operation registry 投影的 capability catalog，包括候选数量、时长与 Voice 文本上限；catalog 失败必须显式提供重试，不得静默表现为只剩上传。表单校验只改善即时反馈，最终业务输入仍由同一个 Operation schema 与 planner 裁决。
- **CN-14B — 创建与上传显式落在当前文件夹。** Canvas 在用户提交意图时冻结完整 `outputPath`；异步上传重试沿用同一 outputPath，切换文件夹不能把进行中的任务移到新目录。文件名冲突与路径合法性仍由 WorkspaceResource 唯一写入口裁决。
- **CN-15 — 选择与 Assistant 草稿各有唯一 UI owner。** `ProjectWorkspace` 持有唯一 Canvas selection，Canvas、Context Chip 与 send context 都消费同一值；清除 Chip 必须清除 Canvas 选中。快捷语义动作只发送一次性受控 draft-prefill/focus 命令，不创建全局事件总线或第二份 selection。
- **CN-16 — Canvas 没有可见性覆盖层。** 节点隐藏与 Resource 归档不是 Canvas 状态；canvas-layout 契约与 clean-cutover schema 均不携带 `hidden`，Canvas 只按 WorkspaceResource 投影结果渲染全部节点。渲染层不得重新引入第二可见性解释（本地 override、隐藏集合或按归档字段过滤）。
- **CN-17 — 布局按 project + folder 隔离。** `ProjectCanvasLayout` 的 canonical scope 是 `(projectId, folderKey)`；root 与每个 folder 分别拥有 viewport 和 node layouts。读写前必须验证非 root folder 是同项目、未删除的正式 folder Resource，禁止以路径、当前 Episode 或最近布局推断 scope。
- **CN-18 — 1,000–5,000 项必须保持 Canvas 语义。** Resource tree/search 使用稳定 cursor 分页，Canvas 逐页物化并启用 ReactFlow viewport virtualization；不得因规模退化为普通列表。完整替换布局只能在当前 folder 全部分页完成后执行，避免用前 200 项删除未加载节点布局。列表投影只消费 bounded summary，不能为 5,000 项读取对象存储全文。

## 权威入口

- 节点 registry：`src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts`。
- folder/root scope、面包屑与搜索定位：`ProjectWorkspaceCanvas.tsx`、`controls/CanvasFolderNavigation.tsx`；root identity 只来自 `WORKSPACE_RESOURCE_ROOT_FOLDER_KEY`。
- direct-child/search Query：`src/lib/query/hooks/useWorkspaceResources.ts` 与 `src/lib/workspace-resource/view-service.ts`；tree/search 返回 bounded summary，单资源读取才允许返回完整内容。
- 媒体 presentation 契约：`src/features/project-workspace/canvas/node-presentation-profiles.ts`（每媒体族 shell 声明与唯一尺寸 resolver）。
- 新批次整体视口定位：`src/features/project-workspace/canvas/hooks/useCanvasFocusFollow.ts`；批次身份与 durable target 只来自 Assistant Session View。
- 投影编排：`src/features/project-workspace/canvas/projection/workspace-node-canvas-projection.ts`。
- Resource 投影与通用 fallback renderer：`workspace-node-resource-projection.ts`、`nodes/renderers/resource-card.tsx`、`nodes/renderers/resource-media-shell.tsx`；Resource View 来自 `src/lib/workspace-resource/view-service.ts`。
- 选中详情卡：`src/features/project-workspace/canvas/details/WorkspaceNodeDetailsCard.tsx` 负责 viewport 定位与宽度，唯一展示实现在同目录 `WorkspaceNodeDetailsPanel.tsx`；数据只来自 card View（prompt provenance + `inputSummaries`）。详情卡提示词只读可复制；已有 Resource 的修改一律经 Assistant 通道产生新 Resource，Canvas 不提供人工改写历史输入的入口。
- 画布创建占位卡：`create/WorkspaceCanvasCreateDock.tsx`。双击空白产生的多实例纯 UI 草稿（不注册节点 kind、不写任何持久层），提交只走通用 Operation 通道（能力来自服务端 creation 声明），上传只走既有上传队列两段式协议；刷新丢弃未提交草稿属预期。
- Canvas 直接动作、创建、上传和 Assistant 预填：`src/features/project-workspace/canvas/actions/**`、`canvas/upload/**` 与 `ProjectWorkspace` 的受控 selection/draft bridge；服务端写入仍只走 Operation adapter。
- folder-scoped 节点位置与 viewport：`src/lib/project-canvas/layout/**` 与 `/api/projects/[projectId]/canvas-layout`；唯一 scope 是 `(projectId, folderKey)`，不存在第二隐藏集合或 Episode layout route。
- 可选领域事实投影必须先对齐 Resource origin/lineage；不存在 planning/asset-execution/video-stage projector。
- 音频与成片同样使用普通 Resource 投影，不得恢复声音或最终阶段节点。
- 唯一 lifecycle resolver：`src/features/project-workspace/canvas/lifecycle/**`。
- 资源通知契约：`src/lib/workspace-resource/resource-impact.ts`、`resource-change-publisher.ts`。

## 验证

- `tests/contracts/canvas-node-conformance.test.ts` 从生产 registry 穷尽校验 kind/capability/renderer/fixture，并校验媒体 presentation 契约对全部 media type 穷尽、frame shell 按画幅比解析。
- folder 进入/返回、项目搜索定位、direct children、folder-scoped layout、分页完成前禁止布局覆盖、卡片刷新与真实 Resource/Task/Lineage 组合没有稳定独立 oracle，使用 authenticated 产品人工复验。
- alternatives 左右浏览、多媒体 renderer、付费确认、当前目录创建/上传及上传重试同样属于 authenticated 产品人工复验；静态验证只能证明 registry、类型和唯一协议接线。

## 历史回归

- BGM/环境音曾以 planner stream、BgmDesign、MusicScore 和最终节点依次交接，任何 owner 字段或 Query 条件漂移都会制造空窗。当前音乐方向是普通 WorkspaceResource，生成音乐是普通 audio Resource，最终输出是普通 video Resource；同一 Task 的正式 Revision只接手自己的 presentation，不再跨阶段交接。
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
- Canvas 布局曾以 Episode 作为唯一 scope，无法表达普通目录，也会让同一项目的文件位置互相覆盖；当前一次性切换为 `(projectId, folderKey)`，root 固定为 `@root`，旧 Episode writer 与读取参数均已删除。
- Resource tree 曾在列表查询中读取每个文本/JSON 的对象存储全文，1,000–5,000 项时即使 ReactFlow 虚拟化也无法控制 I/O；当前 tree/search 只返回 bounded summary，完整内容只由单资源读取和 runtime projection 消费。

## 修改检查表

1. 当前 Canvas 是否只由 `@root` 或正式 folder `resourceId` 定义，并且只显示直接子项？
2. file/folder 节点 identity 是否只使用 `resourceId`，路径移动是否仍走唯一 WorkspaceResource move 入口？
3. folder-scoped layout 是否验证项目归属，并在分页完整前拒绝全量覆盖？
4. 是否保留原 Resource 卡片、详情、预览、上传、创建、动作、拖拽与视口能力，而没有退化成列表？
5. lifecycle、Task overlay、服务端 action input 和 UI 选中态是否仍为独立输入？
6. 是否用 Workflow、邻近、跨文件夹引用、同批关系或 fallback 伪造节点、可见性或 Lineage edge？
7. 是否明确了需要人工复验的 Canvas observable，而不是机械新增快照测试？
