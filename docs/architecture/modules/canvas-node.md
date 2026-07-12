<!-- architecture-module: canvas-node -->

# Canvas 节点与流式状态

## 设计理念

Canvas 节点是业务资源与任务生命周期的投影，不是独立的状态来源。新增节点必须继承同类节点的完整行为：稳定身份、范围、流式输出、展开态、focus-follow、失败与重试、事件重放和防旧状态覆盖。

节点“能显示”不等于节点已经完成。任何缺失都属于同类实例架构不一致。

## 不变量

- **CN-01 — 稳定身份与范围。** 节点 ID 必须由持久业务资源和明确 scope 派生；禁止用名称、数组下标、渲染顺序或临时 stream id 作为身份。
- **CN-02 — 业务状态单一。** DB/Task 的终态与明确 runtime 状态才是节点业务状态来源；不得从历史消息、DOM 或文案反推流程是否运行。
- **CN-02A — 运行目标按产物隔离。** 源剧本、制作规划、视觉风格方案、视觉风格候选图必须分别订阅 `ProjectEditSourceScript/EDIT_SOURCE_SCRIPT_GENERATE`、`ProjectEditBible/EDIT_BIBLE_GENERATE`、`ProjectEditBible/EDIT_STYLE_PREVIEW_OPTIONS_GENERATE`、`ProjectEditStylePreview/EDIT_STYLE_PREVIEW_IMAGE`；共享数据库主记录不等于共享运行状态。方案文本 Task 原子创建 pending 候选并保留来源 taskId；媒体批准事务再把每个候选一一切换到 direct image Task，不存在父媒体 Task 或以 Bible id 伪造图片运行目标。Canvas 可把这些明确 target 聚合进同一个业务节点，但不得丢失任一 target 的失败、重试或终态。
- **CN-02B — Style Bible 单一 Canvas 身份。** 视觉风格候选图片只在 Assistant 中展示，不是 Canvas 业务节点。Task 提交后 Canvas 只投影 `editStyleBible:${ProjectEditBible.id}`：任一候选运行时为运行中，全部成功且未确认时为等待选择，确认后同一 identity 原地消费正式 `styleBibleJson`。禁止恢复 `editStylePreview` node kind、候选 node/edge、数组位置 identity 或确认后另建最终节点。
- **CN-02C — 规划资产节点身份稳定。** 制作规划确认后，Canvas 立即从正式 ProjectCharacter/ProjectLocation Query 投影 episode 级 `edit-asset-group:${episodeId}`，即使图片为空、核心剪辑尚未生成也必须可见。核心剪辑生成后只把 requirement 的镜头绑定信息合并进同一节点，不得改用 editScriptId 创建替代节点或让布局跳变；图片、空间档案、错误和运行中状态仍分别来自正式资产 Query 与 Task target View。
- **CN-03 — 流式协议显式。** 每种流式 payload 必须有 schema、adapter、稳定 item key 和归并规则。预览 adapter 必须直接复用 worker 接收的 raw model schema；浏览器不得拿持久化后的 final schema 校验 raw stream，也不得自行补造只有服务端 normalizer 才能推导的字段。新节点不得自行解析未声明的 stream 形状。
- **CN-03A — Canvas 不解释或展示领域 ID。** Structured preview 只能展示 raw 协议中的名称、短 ref 对应的顺序或 clip order；正式节点只消费服务端已投影的 current-name View。renderer 不得维护资产映射、按名称反查 identity，也不得用 characterId/locationId/shotId/sourceId 等内部标识作为缺失文案 fallback。引用缺失必须由 projector 明确拒绝。
- **CN-04 — 乱序与重放安全。** patch 可在节点挂载前到达、可重复到达、可晚于终态到达；这些合法时序不得导致崩溃、重复节点或用旧运行态覆盖终态。
- **CN-05 — 展开态一致。** 展开/折叠与布局必须使用统一 disclosure/profile 机制；节点不能各自发明局部状态协议。
- **CN-06 — 同类触点对齐。** 新节点必须先选权威参照物，覆盖其 route、task、worker、stream、projection、presentation、focus、i18n、失败和测试触点，或记录不适用原因。
- **CN-07 — 生命周期单一写入者。** Resource、Task、structured stream、submission 与 UI 只提供事实快照；`workspace-node-runtime.ts` 调用纯生命周期 resolver 生成最终 `lifecycle`。structured stream 只提供可丢弃的 presentation/content，预览解析失败只能跳过该预览项，绝不能写入节点业务失败；运行中的失败只来自真实 Task `failed` 终态，持久资源失败只来自正式 Query。组合节点必须由同一个 runtime target collector 穷尽收集父节点和子项声明的 target，再由同一个 resolver 同时投影组与子项；projection 不得把 `generating`、`taskRunning` 或缺少预览图解释成失败。节点数据不得保存 `artifactPhase`、`isRunning`、`statusLabel`、`taskProgress` 或独立 stream 状态，renderer 不得读取 Task/stream runtime 或从内容推断阶段。
- **CN-08 — 终态通知后读取正式资源。** Canvas Task 必须先持久化业务资源，再由 Terminal Service 提交 completed/failed/canceled Event。终态 Event 只通过显式 `affectedResources` 通知客户端；客户端不得从 Task payload 直接写业务 Query Cache，而应由 `resource-change-sync.ts` invalidate 并 refetch active Query。Query fetch 是 Canvas 内容的唯一 Cache writer；Task Event 只负责清除 Task/structured runtime。缺少 `affectedResources` 时不得按 TaskType 猜测资源。网络失败保持 Query stale/invalidated 并交给正常重试或刷新，不得伪造成 Task 失败。
- **CN-09 — Registry 与 conformance 穷尽。** 每个 `WorkspaceCanvasNodeKind` 必须同时存在 definition、renderer 和 conformance fixture，三个 registry 都以 `satisfies Record<WorkspaceCanvasNodeKind, ...>` 穷尽。新增 kind 缺任一层必须在 TypeScript 或 CI 失败。
- **CN-10 — 源剧本场景级单一事实。** Prompt 输出仅允许 `{ title, summary, segments }`；scene segment 的稳定 key 是 `episodeIndex:actIndex:sceneIndex`。共享 normalizer 同时派生 `normalizedText` 与现有嵌套 `scriptStructureJson`，并拒绝重复/跳号索引和父级元数据冲突。单一 raw/final 形状不得携带没有 parser 分流语义的固定版本标记；不得恢复重复的 `scriptText + structure` 输出。
- **CN-11 — Stream identity 与 UI 瞬时事实有界。** Structured stream chunk 必须携带 `streamRunId + stepAttempt + seq`；consumer 只接受当前 attempt 的连续 seq，拒绝重复、缺口和旧 attempt。Task 终态只封锁已经结束的 streamRunId，新 retry 的 streamRunId 不得被旧 taskId 永久屏蔽。accumulator、terminal run 与 SSE `identity → canonical fingerprint` 均须显式有界；同 identity 不同 fingerprint 不是 duplicate，必须 conflict 并重建 snapshot。Optimistic overlay 只能由 created/processing 建立并由 completed/failed/canceled 清除，不得依赖 TTL；mutation settle 后必须使正式 Query 失效，不得把 optimistic snapshot 当作长期内容权威。
- **CN-12 — Renderer 本地动效不得驱动渲染或永久合成。** `WorkspaceCanvasMotionPresence` 只可通过 `visible + exit + rendered` 的共享 transition authority 结算自身的短暂存在状态；稳定可见的 React children identity 不是生命周期事实，绝不复制为 React state 或触发 state setter。`data-workspace-canvas-motion-active` 是动画窗口的唯一事实；窗口结算后必须恢复 `animation: none`、`transform: none` 和 `will-change: auto`，不得让 React Flow viewport scale 再放大内部持久 compositor layer。退出内容只能保存在不会 render 的 ref；所有节点 renderer 必须复用这一入口，不得按 kind 建立第二个 Presence 状态机。
- **CN-13 — ReactFlow 测量单向。** `useWorkspaceNodeCanvasProjection` 只从领域事实和持久 layout 产生节点 View；`ProjectWorkspaceCanvas` 只把明确的用户拖拽写入本地/持久 position layout。ReactFlow 的 `dimensions`、ResizeObserver 或 DOM 尺寸只属于 ReactFlow 内部测量，绝不得回写 `WorkspaceCanvasNodeData.width/height`、projection node 或受控 business node state。streaming 重投影、用户 layout 与 transient measurement 必须是三个单向输入，不能构成 render feedback loop。

## 权威入口

- 节点稳定 ID：`src/features/project-workspace/canvas/workspace-canvas-node-ids.ts`。
- 节点能力总契约：`src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts`。
- 生命周期状态机：`src/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle.ts`；最终节点解析：`src/features/project-workspace/canvas/workspace-node-runtime.ts`。
- 流式 schema 与 adapter：`src/features/project-workspace/canvas/structured-stream/structured-stream-adapters.ts`。
- 增量 JSON 边界：`src/lib/structured-stream/incremental-json.ts` 只提取完整 raw item，字段合法性仍由 adapter 复用的生产 raw schema 裁决。
- 流式事实收集：`src/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime.ts`；该模块无权合并最终节点生命周期。
- renderer 运行态只读取最终 `data.lifecycle`；禁止恢复 `__running`、operationId pending switch 或把 DB `generating` 本地改写为 `ready`。
- DB 到节点的内容投影：`src/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection.ts`。
- Task/Mutation 受影响资源契约：`src/lib/workspace-resource/resource-impact.ts`；禁止从 TaskType 或 target 文案猜测 Query。
- 视觉风格候选集合的共享纯 View：`src/lib/edit-script/style-preview-set-view.ts`；Assistant 与 Canvas 不得各自重新解释候选可见性、生成、完成、确认和失败语义。
- 终态通知到正式 Query：`src/lib/query/workspace-sse-event-sync.ts` 与 `src/lib/query/resource-change-sync.ts`；SSE 不直接调用 `setQueryData` 写业务资源。
- SSE 去重、replay cursor 与 Task 终态水位：`src/lib/query/workspace-sse-event-sequence.ts`；同一 Task 到达终态后拒绝晚到 lifecycle/stream，只有被接受的事件才进入 Cache 与 runtime。
- 源剧本单一 normalizer：`src/lib/edit-bible/source-script-segments.ts`。
- 展开态与布局 profile：`src/features/project-workspace/canvas/node-presentation-profiles.ts`。
- Canvas composition 与用户 position overlay：`src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx`；它不得订阅或写回 ReactFlow measurement。
- 共享节点 shell：`src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx`；穷尽 renderer registry：`src/features/project-workspace/canvas/nodes/workspace-node-renderer-registry.tsx`；kind renderer：`src/features/project-workspace/canvas/nodes/renderers/`。renderer 只消费最终 View，不参与生命周期判定。
- 本地 Presence transition：`src/features/project-workspace/canvas/nodes/workspace-canvas-motion-presence.ts`；唯一 renderer host：`src/features/project-workspace/canvas/nodes/workspace-node-motion.tsx`。

## 验证

- `tests/golden-journey/**` 在真实 ReactFlow、streaming、Task terminal、SSE 和刷新组合中观察 Canvas；console/page error、重复 identity、终态缺口、reload divergence 或稳定展开内容仍持有 animation/transform/will-change 都是场景失败。
- `tests/golden-journey/journeys/mainline-downstream-continuation.spec.ts` 的并行批准场景必须在真实核心剪辑 Task 仍运行时观察 `edit-script` 节点进入 `streaming`，并证明该节点不再含媒体 loading surface；同场景还验证资产审核只保留整组确认动作。
- `GJ-CANVAS-STRUCTURED-PREVIEW` 必须让本地 provider 受控分块输出，并在 Task 仍为 processing 时观察制作规划 raw item 卡片；只检查终态正式 Query 不构成 structured preview 覆盖。
- `tests/unit/project-workspace/{structured-stream-runtime,workspace-canvas-lifecycle,workspace-canvas-motion-presence,canvas-projection-signature}.test.ts` 只验证纯 runtime merge、lifecycle resolver、Presence transition 和 canonical projection signature。
- `tests/contracts/canvas-node-conformance.test.ts` 从生产 node registry 穷尽验证 definition、renderer、fixture、capability 与统一生命周期。
- `tests/unit/edit-bible/source-script-segments.test.ts` 与 `tests/integration/provider/source-script-scene-stream.contract.test.ts` 验证 scene-level 单一输出及逐场增量协议。
- Canvas guards 阻止旧 lifecycle 字段、第二 resolver、history inference、server mirror 和 children-state Presence 回流；它们不替代真实浏览器渲染与交互。
- 视觉风格主链必须先在真实文本 Task processing 窗口观察 Assistant 通用运行卡，再在 direct image Task processing 窗口观察单一运行中 Style Bible 节点，并在 Choice 确认与 reload 后观察相同 node identity 的正式内容；只验证终态 workflow stage 或 registry 完整性不构成覆盖。
## 历史回归

- Soundscape 新实例曾先后补齐 structured stream adapter、展开态和防旧 patch 覆盖；这说明仅实现主路径会漏掉同类节点的生命周期触点。
- `6ef1a201e` 修复 SSE replay 的重复刷新；事件 cursor、快照和 replay 必须视为节点协议的一部分。
- `931ab59c3` 曾用终态后保留 stream 8 秒掩盖 Query 刷新空窗；`d31a5615b` 删除 timer 后暴露生命周期与内容读取竞争。本阶段选择明确的最终一致性语义：终态立即清 runtime，内容只从正式 Query 重新读取；不得恢复 timer 或 terminal payload Cache writer。
- `931ab59c3` 引入制作规划 structured preview 时误用持久化 final schema；`ac3708a9b` 又把 ledger raw 输出切换为 `beatId`，浏览器 adapter 没有同步，导致真实 Task 仍在 processing 时 Canvas 短暂显示失败。修复后 preview 与 worker 共用 `rawEditBible*Schema`，且 preview diagnostics 不再进入业务 lifecycle。
- `BUG-CN-002` 证明 renderer 的本地动画也不能把 React children identity 当作状态变化；`WorkspaceCanvasMotionPresence` 必须在稳定可见时零 state write。
- `BUG-CN-003` 证明零 state write 仍不足以保证清晰渲染：entered animation 的 fill state 与永久 `will-change` 会在 React Flow zoom 下把展开文字留在嵌套合成层；修复后 active window 是唯一动画事实，稳定态不得持有 compositor hint。
- 视觉风格生成曾同时存在三个候选节点和最终 Style Bible 节点；Assistant 生成卡删除后真实 Journey 仍绿色，确认写入又因资源影响缺口不刷新 Canvas。现收敛为单节点身份与共享 View，Golden 必须观察 processing UI、确认后相同 identity 和 reload。
- 核心剪辑 structured preview 曾在名称缺失时回显 locationId/characterId，正式对白、最终时间线与 Soundscape 展开详情也各自回显内部 ID；这些分散 fallback 让坏引用看似可用并把 UUID 暴露给用户。现在 preview 直接消费名称/短引用 raw schema，正式 View 由服务端/projector 用 canonical identity 解析为当前名称或顺序，renderer 不再显示 identity。
- 并行生成资产与核心剪辑后，资产组 projection 曾把 `taskRunning/generating` 直接映射为 `failed`，同时 runtime target collector 又只收集父节点 target，导致组卡误报失败、子卡始终“待生成”；核心剪辑 renderer 还在没有 structured preview 时显示媒体式大灰块。旧防线只验证单节点 lifecycle resolver，没有覆盖组合节点子项 target。现由唯一 collector 穷尽父/子 target，父组和子项共用 resolver；projection 只消费正式资源成功/失败，剪辑节点无 details 时只保留文字内容，不再创建媒体 fallback。
- `BUG-CN-004`：多章节镜头执行计划 Task 已按 editScript target 提交，但全章节 Canvas 仍把 `editScript=null` 传给只接受单实例的 projector，因此 Assistant 显示整批运行而 Canvas 没有任何对应节点；同时 owner-fenced worker 写入的 `generating + {}` 行被 episode 正式读取当作完整 ready payload 解析，reload 触发 `shots/generationSegmentExecutions` schema 失败。旧 mocked episode 测试把计划列表固定为空，Golden 也只验证终态 stage，没有观察真实 processing + reload。当前防线是正式计划 Query 只暴露 ready materialization、Canvas 从全部 editScripts 穷尽投影稳定节点并只把 Task target 交给统一 lifecycle resolver，纯投影规格反证单实例 gate。真实 processing + reload 浏览器组合仍未验证：对应 Golden stage probe 当前被缺失的 Workflow Lab checkpoint 阻塞，未通过前不得宣称该盲区关闭。

## 修改检查表

1. 参照物是哪一个已有节点？为什么最接近？
2. 节点的 canonical ID 和 scope 是什么？
3. stream schema、adapter、item key、乱序合并和终态优先级在哪里定义？
4. 展开态、focus-follow、失败/重试、重放是否逐项对齐？
5. 是否新增真实时序测试，而非只断言静态完整节点？
