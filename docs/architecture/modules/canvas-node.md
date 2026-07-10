<!-- architecture-module: canvas-node -->

# Canvas 节点与流式状态

## 设计理念

Canvas 节点是业务资源与任务生命周期的投影，不是独立的状态来源。新增节点必须继承同类节点的完整行为：稳定身份、范围、流式输出、展开态、focus-follow、失败与重试、事件重放和防旧状态覆盖。

节点“能显示”不等于节点已经完成。任何缺失都属于同类实例架构不一致。

## 不变量

- **CN-01 — 稳定身份与范围。** 节点 ID 必须由持久业务资源和明确 scope 派生；禁止用名称、数组下标、渲染顺序或临时 stream id 作为身份。
- **CN-02 — 业务状态单一。** DB/Task 的终态与明确 runtime 状态才是节点业务状态来源；不得从历史消息、DOM 或文案反推流程是否运行。
- **CN-02A — 运行目标按产物隔离。** 源剧本、制作规划、视觉风格候选必须分别订阅 `ProjectEditSourceScript/EDIT_SOURCE_SCRIPT_GENERATE`、`ProjectEditBible/EDIT_BIBLE_GENERATE`、`ProjectEditBible/EDIT_STYLE_PREVIEWS_GENERATE`；共享数据库主记录不等于共享运行状态。视觉风格父任务在候选记录出现前必须有独立占位节点，候选记录出现后由候选节点接管展示。
- **CN-03 — 流式协议显式。** 每种流式 payload 必须有 schema、adapter、稳定 item key 和归并规则。新节点不得自行解析未声明的 stream 形状。
- **CN-04 — 乱序与重放安全。** patch 可在节点挂载前到达、可重复到达、可晚于终态到达；这些合法时序不得导致崩溃、重复节点或用旧运行态覆盖终态。
- **CN-05 — 展开态一致。** 展开/折叠与布局必须使用统一 disclosure/profile 机制；节点不能各自发明局部状态协议。
- **CN-06 — 同类触点对齐。** 新节点必须先选权威参照物，覆盖其 route、task、worker、stream、projection、presentation、focus、i18n、失败和测试触点，或记录不适用原因。
- **CN-07 — 生命周期单一写入者。** Resource、Task、structured stream、submission 与 UI 只提供事实快照；`workspace-node-runtime.ts` 调用纯生命周期 resolver 生成最终 `lifecycle`。节点数据不得保存 `artifactPhase`、`isRunning`、`statusLabel`、`taskProgress` 或独立 stream 状态，renderer 不得读取 Task/stream runtime 或从内容推断阶段。
- **CN-08 — 原子终态资源交接。** Canvas Task 完成前必须从已持久化数据读取画布实际消费的 Query DTO，并随 completed SSE 发送 `materializedResources`。客户端必须先同步写 Query Cache，再写 Task 终态，最后清除 structured runtime；`affectedResources` 只负责后续一致性校验。必需信封缺失必须显式呈现 `CANVAS_TERMINAL_RESOURCE_HANDOFF_MISSING`，禁止 timer 或 refetch fallback。
- **CN-09 — Registry 与 conformance 穷尽。** 每个 `WorkspaceCanvasNodeKind` 必须同时存在 definition、renderer 和 conformance fixture，三个 registry 都以 `satisfies Record<WorkspaceCanvasNodeKind, ...>` 穷尽。新增 kind 缺任一层必须在 TypeScript 或 CI 失败。
- **CN-10 — 源剧本场景级单一事实。** Prompt 输出仅允许 `{ version, title, summary, segments }`；scene segment 的稳定 key 是 `episodeIndex:actIndex:sceneIndex`。共享 normalizer 同时派生 `normalizedText` 与现有嵌套 `scriptStructureJson`，并拒绝重复/跳号索引和父级元数据冲突。不得恢复重复的 `scriptText + structure` 输出。

## 权威入口

- 节点稳定 ID：`src/features/project-workspace/canvas/workspace-canvas-node-ids.ts`。
- 节点能力总契约：`src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts`。
- 生命周期状态机：`src/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle.ts`；最终节点解析：`src/features/project-workspace/canvas/workspace-node-runtime.ts`。
- 流式 schema 与 adapter：`src/features/project-workspace/canvas/structured-stream/structured-stream-adapters.ts`。
- 流式事实收集：`src/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime.ts`；该模块无权合并最终节点生命周期。
- DB 到节点的内容投影：`src/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection.ts`。
- 原子终态接力：`src/lib/workspace-resource/materialized-resource.ts` 与 `src/lib/query/materialized-resource-cache.ts`。
- SSE 去重、replay cursor 与 Task 终态水位：`src/lib/query/workspace-sse-event-sequence.ts`；同一 Task 到达终态后拒绝晚到 lifecycle/stream，只有被接受的事件才进入 Cache 与 runtime。
- 源剧本单一 normalizer：`src/lib/edit-bible/source-script-segments.ts`。
- 展开态与布局 profile：`src/features/project-workspace/canvas/node-presentation-profiles.ts`。
- 共享节点 shell：`src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx`；穷尽 renderer registry：`src/features/project-workspace/canvas/nodes/workspace-node-renderer-registry.tsx`；kind renderer：`src/features/project-workspace/canvas/nodes/renderers/`。renderer 只消费最终 View，不参与生命周期判定。

## 验证

- `tests/unit/project-workspace/structured-stream-adapters.test.ts` 验证 stream adapter 契约。
- `tests/unit/project-workspace/structured-stream-runtime.test.ts` 验证 runtime 合并与重放语义。
- `tests/unit/project-workspace/workspace-canvas-lifecycle.test.ts` 穷尽验证唯一 resolver 的身份、进度、stream、终态交接、取消和派生投影。
- `tests/regression/project-canvas-task-backed-running.test.ts` 验证运行态来自任务权威状态。
- `tests/regression/project-canvas-long-form-node-identity.test.ts` 验证节点身份稳定。
- `tests/contracts/canvas-node-conformance.test.ts` 对所有 definition 自动执行生命周期与能力声明契约。
- `tests/unit/edit-bible/source-script-segments.test.ts` 与 `tests/integration/provider/source-script-scene-stream.contract.test.ts` 验证 scene-level 单一输出及逐场增量。
- `tests/unit/optimistic/sse-task-terminal.test.ts` 与 `sse-event-ordering.test.ts` 验证 Query Cache materialization 早于 runtime clear，并拒绝重复/乱序覆盖。
- `tests/unit/optimistic/workspace-sse-event-sequence.test.ts` 验证重复、晚到与 replay 事件不能越过 Task 终态水位。
- `scripts/guards/canvas-node-lifecycle-contract-guard.mjs` 阻止旧字段、第二生命周期构造边界和 registry 缺项重新出现。
- `scripts/guards/no-history-state-inference.mjs` 与 `scripts/guards/no-server-mirror-state.mjs` 阻止从错误状态来源推断业务状态。

## 历史回归

- Soundscape 新实例曾先后补齐 structured stream adapter、展开态和防旧 patch 覆盖；这说明仅实现主路径会漏掉同类节点的生命周期触点。
- `6ef1a201e` 修复 SSE replay 的重复刷新；事件 cursor、快照和 replay 必须视为节点协议的一部分。
- `931ab59c3` 曾用终态后保留 stream 8 秒掩盖 Query refetch 空窗；`d31a5615b` 按 TL-06A 删除 timer 后空窗重新暴露。正确修复是 CN-08 的原子 Query DTO 交接，而不是恢复延迟清理。

## 修改检查表

1. 参照物是哪一个已有节点？为什么最接近？
2. 节点的 canonical ID 和 scope 是什么？
3. stream schema、adapter、item key、乱序合并和终态优先级在哪里定义？
4. 展开态、focus-follow、失败/重试、重放是否逐项对齐？
5. 是否新增真实时序测试，而非只断言静态完整节点？
