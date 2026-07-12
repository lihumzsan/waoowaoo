# Canvas 展开内容缩放模糊事故（2026-07-12）

## 分类与目标

本次是 `BUG-CN-003` 的 D 类 Architecture Incident。`WorkspaceCanvasMotionPresence`
在 30 天内已经历多次与展开、折叠、测量和稳定渲染相关的纠正性修改；本次真实
Canvas 再次暴露同一共享动效边界的另一种失败：进入动画结束后，展开内容仍保留
`will-change: transform` 和由 `animation-fill-mode: both` 固化的
`transform: translateY(0)`。React Flow 放大 viewport 时，稳定文字因此处于嵌套合成
层中并被作为纹理放大，二级详情因再次嵌套 Presence 而更明显。

目标：保留现有进入、退出、重入取消、宽度变化即时隐藏、减弱动效和 React Flow
测量时序，同时让所有稳定可见内容回到 `transform: none`、无永久 `will-change` 的
普通 DOM 文本渲染。

非目标：不改变业务 lifecycle、Task/stream/Query、节点 identity、布局持久化、节点
尺寸 profile、制作规划数据或字体；不为 `editBible`、`ShotGrid` 或某种浏览器增加
局部清晰度补丁。

禁止范围：禁止第二套 Presence、永久 `translateZ(0)`、字体平滑私有属性、按 zoom
补偿字号、延时重绘、重新挂载文本、Canvas 位图渲染或关闭 React Flow 缩放。

并行任务边界：本阶段只修改共享 Motion Presence、其 CSS 合成契约、Canvas 模块
文档和适用验证证据；其他 Canvas lifecycle、streaming 与布局任务不在本阶段内。

## 历史分诊

- `340c33f603` 首次引入共享 enter/exit Motion Presence。
- `baa9336952` 增加 grid-row wrapper，并把调用方 class 放入 inner wrapper。
- `704b438f4a` 增加永久 `will-change` 与 `motionActive` 标识，但 CSS 从未消费该标识；
  同时 entered 动画继续使用 `both`，使稳定态保留 transform。
- `7b298d67e5` 修复 `children -> state -> render` 循环并登记 `BUG-CN-002`，但其防线只
  约束状态 writer，没有检查稳定态合成层。
- `ed839979fd` 让制作规划和剧本创作复用 `ShotGrid`；一级内容位于一层 Presence 下，
  二级详情再次经过同一个 Presence，使此前未验证的缩放组合更容易被用户观察到。

历史分类：共享动效不变量的换形式复发。上一版防线证明“稳定 visible 不写 React
state”，没有证明“稳定 visible 不保留动画 transform/compositor hint”；既有结构测试
和逻辑测试不运行真实浏览器排版，因此未覆盖该路径。

## 权威入口与全部触点

| 触点 | 权威入口 | 本阶段处理 |
| --- | --- | --- |
| Presence 生命周期 | `workspace-node-motion.tsx` + `workspace-canvas-motion-presence.ts` | 保持唯一 transition 和 timer writer |
| 动效与合成 | `src/styles/animations.css` | active 期间才允许动画/`will-change`；settled 必须清空 |
| 节点展开 | `ProductionPlanningView.tsx`、`SourceScriptStructureView.tsx`、`WorkspaceNodeRenderers.tsx` | 继续复用共享入口，不加特判 |
| 卡片详情 | `shot-grid.tsx` | 继续复用共享入口，嵌套稳定态同样清空 |
| Canvas 缩放 | `ProjectWorkspaceCanvas.tsx` / React Flow viewport | 不变；仍是唯一 viewport 缩放入口 |
| 调试入口 | DOM `data-workspace-canvas-motion-active` / `data-motion-state` | 作为显式 presentation 协议供 CSS 与浏览器 oracle 使用 |
| 用户入口 | 展开节点、切换分区、展开卡片、缩放画布 | 全部通过上述同一共享链路 |

仓库当前共有 27 个 `WorkspaceCanvasMotionPresence` 调用点，分布在四个 renderer 文件；
它们不得各自解释稳定态或复制 CSS。

## 所有权、事实与数量变化

此事故不涉及持久实体或业务事实。presentation 事实只有：

| 事实 | scope / identity | 唯一 owner / writer | 消费者 |
| --- | --- | --- | --- |
| 是否应渲染 | 单个 Presence 实例；`visible + exit + rendered` | `WorkspaceCanvasMotionPresence` | React renderer |
| 当前是否处于动效窗口 | 单个 Presence 实例；`motionKey + visible` | 同组件的 effect/timer | 共享 CSS、React Flow 测量、浏览器 oracle |
| 进入/退出方向 | 单个 Presence 实例；`data-motion-state` | 同组件 render | 共享 CSS |

修改前后 writer 数量均为 1，执行入口均为 1；不会新增持久化、恢复入口或第二状态机。
稳定态竞争解释从 2 个降为 1 个：修改前 `motionActive=false` 表示已结束，但 entered
animation 的 fill state 仍表示 transform 活跃；修改后只有显式 active 属性决定动画和
compositor hint。永久合成促进项从 2 个（`will-change`、filled transform）降为 0。

## 正常、失败与并发时序

1. **进入**：rendered 内容挂载，active=true；CSS 执行一次 reveal。
2. **进入结算**：180ms timer 把 active=false；DOM 保留，稳定 CSS 明确恢复
   `animation: none`、`transform: none`、`opacity: 1`、`will-change: auto`。
3. **退出**：`exit=true` 时 active=true 且 state=exiting；保留 ref 中最后一次内容，
   130ms 后唯一 writer 设 `rendered=false`。
4. **即时隐藏**：`exit=false` 原地卸载，不等待动画，也不留下合成层。
5. **重入/重复**：effect cleanup 取消旧 timer，新 visible/motionKey 只启动当前窗口；
   旧 timer 不得晚到覆盖新状态。
6. **减弱动效**：不启动 active 动画，稳定 CSS 从首次渲染起生效。
7. **刷新/断线/业务失败/取消/拒绝/重试/部分成功**：这些只改变上游最终 View，
   Presence 不解释业务结果；重新产生的 View 仍走同一个 presentation 协议。
8. **并发 React render**：children identity 不参与 state transition；保持 `BUG-CN-002`
   的零稳定态写入约束。

没有事务、持久化、补偿或跨系统幂等边界。崩溃结果是浏览器丢失纯 UI 动效；刷新从
最终 View 重建，不恢复未完成的 180ms 动画。

## 删除项与验证计划

删除：稳定 entered 状态的 filled animation、永久 `will-change`，以及
`motionActive=false` 与 CSS 实际行为之间的双轨解释。保留进入/退出 keyframes，但只
允许 active 窗口消费。

验证证据：

- 扩展现有真实 `GJ-CANVAS-STRUCTURED-PREVIEW`：通过生产 Canvas 展开制作规划，等待
  active 属性结算，再用浏览器 computed style 断言稳定 Presence 的 animation、transform
  和 will-change。权威 oracle 来自本事故目标和 `CN-12`；它会拒绝修复前仍保留
  `workspaceCanvasGlideReveal`、matrix transform 与永久 will-change 的实现。
- 扩展 `canvas-motion-presence-contract-guard.mjs`：拒绝把 entered animation 或
  `will-change` 恢复为不受 active 属性约束的共享 CSS。该 guard 只证明结构契约，不替代
  浏览器行为。
- 运行 Motion Presence logic、Canvas architecture checks、typecheck，以及上述 Golden
  canonical command。

未验证盲区：不同操作系统的字体抗锯齿结果不做像素快照；浏览器 oracle 验证造成该
事故的合成状态已消失，而非把某一台机器的截图当作跨平台字体标准。

## 实际 red / green 证据

- Pre-fix：`npm run test:golden:variant:structured-preview` 失败；真实 Chromium 在
  `active=false` 后仍返回 `animationName=workspaceCanvasGlideReveal`、
  `transform=matrix(1, 0, 0, 1, 0, 0)`、
  `willChange=grid-template-rows, opacity, transform`。
- Post-fix：同一 canonical command 在点击真实“放大”控件并观察 React Flow viewport
  transform 已变化后，返回 `animationName=none`、`transform=none`、
  `willChange=auto`，两个场景均通过且无 skip/todo。
- `npm run typecheck`：通过。
- `npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/project-workspace/workspace-canvas-motion-presence.test.ts tests/contracts/canvas-node-conformance.test.ts`：
  2 files、89 tests 全部通过，无 skip/todo。
- `npm run check:architecture`：通过。
