<!-- architecture-module: canvas-node -->

# Canvas 节点与流式状态

## 设计理念

Canvas 节点是业务资源与任务生命周期的投影，不是独立的状态来源。新增节点必须继承同类节点的完整行为：稳定身份、范围、流式输出、展开态、focus-follow、失败与重试、事件重放和防旧状态覆盖。

节点“能显示”不等于节点已经完成。任何缺失都属于同类实例架构不一致。

## 不变量

- **CN-01 — 稳定身份与范围。** 节点 ID 必须由持久业务资源和明确 scope 派生；禁止用名称、数组下标、渲染顺序或临时 stream id 作为身份。
- **CN-02 — 业务状态单一。** DB/Task 的终态与明确 runtime 状态才是节点业务状态来源；不得从历史消息、DOM 或文案反推流程是否运行。
- **CN-02A — 运行目标按产物隔离。** 源剧本、制作规划、视觉风格候选必须分别订阅 `ProjectEditSourceScript/EDIT_SOURCE_SCRIPT_GENERATE`、`ProjectEditBible/EDIT_BIBLE_GENERATE`、`ProjectEditStylePreview/EDIT_STYLE_PREVIEW_IMAGE`；共享数据库主记录不等于共享运行状态。视觉风格候选记录与 direct image Task 在计划事务中一一对应，不再存在父 Task 或以 Bible id 伪造的占位运行目标。
- **CN-03 — 流式协议显式。** 每种流式 payload 必须有 schema、adapter、稳定 item key 和归并规则。预览 adapter 必须直接复用 worker 接收的 raw model schema；浏览器不得拿持久化后的 final schema 校验 raw stream，也不得自行补造只有服务端 normalizer 才能推导的字段。新节点不得自行解析未声明的 stream 形状。
- **CN-04 — 乱序与重放安全。** patch 可在节点挂载前到达、可重复到达、可晚于终态到达；这些合法时序不得导致崩溃、重复节点或用旧运行态覆盖终态。
- **CN-05 — 展开态一致。** 展开/折叠与布局必须使用统一 disclosure/profile 机制；节点不能各自发明局部状态协议。
- **CN-06 — 同类触点对齐。** 新节点必须先选权威参照物，覆盖其 route、task、worker、stream、projection、presentation、focus、i18n、失败和测试触点，或记录不适用原因。
- **CN-07 — 生命周期单一写入者。** Resource、Task、structured stream、submission 与 UI 只提供事实快照；`workspace-node-runtime.ts` 调用纯生命周期 resolver 生成最终 `lifecycle`。structured stream 只提供可丢弃的 presentation/content，预览解析失败只能跳过该预览项，绝不能写入节点业务失败；运行中的失败只来自真实 Task `failed` 终态，持久资源失败只来自正式 Query。节点数据不得保存 `artifactPhase`、`isRunning`、`statusLabel`、`taskProgress` 或独立 stream 状态，renderer 不得读取 Task/stream runtime 或从内容推断阶段。
- **CN-08 — 终态通知后读取正式资源。** Canvas Task 必须先持久化业务资源，再由 Terminal Service 提交 completed/failed/canceled Event。终态 Event 只通过显式 `affectedResources` 通知客户端；客户端不得从 Task payload 直接写业务 Query Cache，而应由 `resource-change-sync.ts` invalidate 并 refetch active Query。Query fetch 是 Canvas 内容的唯一 Cache writer；Task Event 只负责清除 Task/structured runtime。缺少 `affectedResources` 时不得按 TaskType 猜测资源。网络失败保持 Query stale/invalidated 并交给正常重试或刷新，不得伪造成 Task 失败。
- **CN-09 — Registry 与 conformance 穷尽。** 每个 `WorkspaceCanvasNodeKind` 必须同时存在 definition、renderer 和 conformance fixture，三个 registry 都以 `satisfies Record<WorkspaceCanvasNodeKind, ...>` 穷尽。新增 kind 缺任一层必须在 TypeScript 或 CI 失败。
- **CN-10 — 源剧本场景级单一事实。** Prompt 输出仅允许 `{ version, title, summary, segments }`；scene segment 的稳定 key 是 `episodeIndex:actIndex:sceneIndex`。共享 normalizer 同时派生 `normalizedText` 与现有嵌套 `scriptStructureJson`，并拒绝重复/跳号索引和父级元数据冲突。不得恢复重复的 `scriptText + structure` 输出。
- **CN-11 — Stream identity 与 UI 瞬时事实有界。** Structured stream chunk 必须携带 `streamRunId + stepAttempt + seq`；consumer 只接受当前 attempt 的连续 seq，拒绝重复、缺口和旧 attempt。Task 终态只封锁已经结束的 streamRunId，新 retry 的 streamRunId 不得被旧 taskId 永久屏蔽。accumulator、terminal run 与 SSE `identity → canonical fingerprint` 均须显式有界；同 identity 不同 fingerprint 不是 duplicate，必须 conflict 并重建 snapshot。Optimistic overlay 只能由 created/processing 建立并由 completed/failed/canceled 清除，不得依赖 TTL；mutation settle 后必须使正式 Query 失效，不得把 optimistic snapshot 当作长期内容权威。
- **CN-12 — Renderer 本地动效不得驱动渲染。** `WorkspaceCanvasMotionPresence` 只可通过 `visible + exit + rendered` 的共享 transition authority 结算自身的短暂存在状态；稳定可见的 React children identity 不是生命周期事实，绝不复制为 React state 或触发 state setter。退出内容只能保存在不会 render 的 ref；所有节点 renderer 必须复用这一入口，不得按 kind 建立第二个 Presence 状态机。
- **CN-13 — ReactFlow 测量单向。** `useWorkspaceNodeCanvasProjection` 只从领域事实和持久 layout 产生节点 View；`ProjectWorkspaceCanvas` 只把明确的用户拖拽写入本地/持久 position layout。ReactFlow 的 `dimensions`、ResizeObserver 或 DOM 尺寸只属于 ReactFlow 内部测量，绝不得回写 `WorkspaceCanvasNodeData.width/height`、projection node 或受控 business node state。streaming 重投影、用户 layout 与 transient measurement 必须是三个单向输入，不能构成 render feedback loop。

## 权威入口

- 节点稳定 ID：`src/features/project-workspace/canvas/workspace-canvas-node-ids.ts`。
- 节点能力总契约：`src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts`。
- 生命周期状态机：`src/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle.ts`；最终节点解析：`src/features/project-workspace/canvas/workspace-node-runtime.ts`。
- 流式 schema 与 adapter：`src/features/project-workspace/canvas/structured-stream/structured-stream-adapters.ts`。
- 流式事实收集：`src/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime.ts`；该模块无权合并最终节点生命周期。
- renderer 运行态只读取最终 `data.lifecycle`；禁止恢复 `__running`、operationId pending switch 或把 DB `generating` 本地改写为 `ready`。
- DB 到节点的内容投影：`src/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection.ts`。
- Task/Mutation 受影响资源契约：`src/lib/workspace-resource/resource-impact.ts`；禁止从 TaskType 或 target 文案猜测 Query。
- 终态通知到正式 Query：`src/lib/query/workspace-sse-event-sync.ts` 与 `src/lib/query/resource-change-sync.ts`；SSE 不直接调用 `setQueryData` 写业务资源。
- SSE 去重、replay cursor 与 Task 终态水位：`src/lib/query/workspace-sse-event-sequence.ts`；同一 Task 到达终态后拒绝晚到 lifecycle/stream，只有被接受的事件才进入 Cache 与 runtime。
- 源剧本单一 normalizer：`src/lib/edit-bible/source-script-segments.ts`。
- 展开态与布局 profile：`src/features/project-workspace/canvas/node-presentation-profiles.ts`。
- Canvas composition 与用户 position overlay：`src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx`；它不得订阅或写回 ReactFlow measurement。
- 共享节点 shell：`src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx`；穷尽 renderer registry：`src/features/project-workspace/canvas/nodes/workspace-node-renderer-registry.tsx`；kind renderer：`src/features/project-workspace/canvas/nodes/renderers/`。renderer 只消费最终 View，不参与生命周期判定。
- 本地 Presence transition：`src/features/project-workspace/canvas/nodes/workspace-canvas-motion-presence.ts`；唯一 renderer host：`src/features/project-workspace/canvas/nodes/workspace-node-motion.tsx`。

## 验证

- `tests/golden-journey/**` 在真实 ReactFlow、streaming、Task terminal、SSE 和刷新组合中观察 Canvas；console/page error、重复 identity、终态缺口或 reload divergence 都是场景失败。
- `tests/unit/project-workspace/{structured-stream-runtime,workspace-canvas-lifecycle,workspace-canvas-motion-presence,canvas-projection-signature}.test.ts` 只验证纯 runtime merge、lifecycle resolver、Presence transition 和 canonical projection signature。
- `tests/contracts/canvas-node-conformance.test.ts` 从生产 node registry 穷尽验证 definition、renderer、fixture、capability 与统一生命周期。
- `tests/unit/edit-bible/source-script-segments.test.ts` 与 `tests/integration/provider/source-script-scene-stream.contract.test.ts` 验证 scene-level 单一输出及逐场增量协议。
- Canvas guards 阻止旧 lifecycle 字段、第二 resolver、history inference、server mirror 和 children-state Presence 回流；它们不替代真实浏览器渲染与交互。
## 历史回归

- Soundscape 新实例曾先后补齐 structured stream adapter、展开态和防旧 patch 覆盖；这说明仅实现主路径会漏掉同类节点的生命周期触点。
- `6ef1a201e` 修复 SSE replay 的重复刷新；事件 cursor、快照和 replay 必须视为节点协议的一部分。
- `931ab59c3` 曾用终态后保留 stream 8 秒掩盖 Query 刷新空窗；`d31a5615b` 删除 timer 后暴露生命周期与内容读取竞争。本阶段选择明确的最终一致性语义：终态立即清 runtime，内容只从正式 Query 重新读取；不得恢复 timer 或 terminal payload Cache writer。
- `931ab59c3` 引入制作规划 structured preview 时误用持久化 final schema；`ac3708a9b` 又把 ledger raw 输出切换为 `beatId`，浏览器 adapter 没有同步，导致真实 Task 仍在 processing 时 Canvas 短暂显示失败。修复后 preview 与 worker 共用 `rawEditBible*Schema`，且 preview diagnostics 不再进入业务 lifecycle；详见 [2026-07-12 structured-stream preview 事故](../incidents/canvas-structured-stream-preview-2026-07-12/README.md)。
- `BUG-CN-002` 证明 renderer 的本地动画也不能把 React children identity 当作状态变化；`WorkspaceCanvasMotionPresence` 必须在稳定可见时零 state write，详见 [动效 Presence 收敛](../canvas-motion-presence-convergence.md)。

## 修改检查表

1. 参照物是哪一个已有节点？为什么最接近？
2. 节点的 canonical ID 和 scope 是什么？
3. stream schema、adapter、item key、乱序合并和终态优先级在哪里定义？
4. 展开态、focus-follow、失败/重试、重放是否逐项对齐？
5. 是否新增真实时序测试，而非只断言静态完整节点？
