# Canvas Motion Presence 收敛设计（2026-07-11）

## 目标与边界

本次是 `BUG-CN-002` 的 D 类 Architecture Incident：Canvas 上任何可见的节点详情不得因自身渲染而再次触发自身状态更新，进而使整个 `ReactFlow` 触发 `Maximum update depth exceeded`。

目标：保留现有进入、退出、重入取消、减弱动效和节点测量语义，同时把「是否暂时仍需渲染」收敛为一个可穷尽的本地 Presence 状态协议。

非目标：不改变节点生命周期 resolver、Task/stream/Query 事实、React Flow 节点投影、布局持久化或任何业务卡片内容；不以延时、跳过依赖、吞掉 React 错误或外层防抖掩盖问题。

## 历史分诊与根因

| 项目 | 事实 |
| --- | --- |
| 直接症状 | 用户打开包含可见详情的 Canvas 节点后，控制台报 `Maximum update depth exceeded`，栈在 `ReactFlow` 处暴露。 |
| 实际根因 | `WorkspaceCanvasMotionPresence` 在 `visible=true` 的 effect 中执行 `setCachedChildren(children)`；每次父/子渲染都会产生新的 React children identity，写状态又触发下一次渲染，形成闭环。 |
| 为什么 ReactFlow 在栈中 | Motion Presence 是 ReactFlow 自定义节点的子树；ReactFlow 只是被循环更新的祖先渲染边界，并不是状态写入者。 |
| 为什么旧测试漏过 | `canvas-layout-runtime-contract` 只检查动画包装器是否存在和源码结构；此前的 projection signature 测试只覆盖 ReactFlow 输入稳定性。两者都没有验证「稳定可见的 children 不产生下一次 Presence 状态写入」。 |
| 与旧 Canvas update-loop 修复的关系 | `830b14601`、`498a649fd` 处理的是 projection/measurement 输入反馈；本次是 renderer 内部把 ReactNode 镜像进 state。它们同属“渲染不应自我驱动”的不变量，但不是同一 writer 或同一根因。 |

## 唯一协议、所有权与入口

`workspace-canvas-motion-presence.ts` 是 Presence transition 的唯一裁判。输入只有 `visible`、`exit` 和当前 `rendered`；输出只能是：

| 输入状态 | action | 唯一 state writer |
| --- | --- | --- |
| 已显示且继续显示 | `idle` | 无写入 |
| 应重新显示但尚未渲染 | `show` | `WorkspaceCanvasMotionPresence` 写 `rendered=true` 一次 |
| 隐藏且不保留退出动画 | `hide` | `WorkspaceCanvasMotionPresence` 写 `rendered=false` 一次 |
| 隐藏且保留退出动画 | `schedule_exit` | 同组件的一个 timer 在退出结束时写 `rendered=false` 一次 |

当前可见内容直接由 props 渲染，绝不写入 React state。仅用于退出动画的“最后已提交内容”保存在 ref；更新 ref 不会触发 render。所有 Canvas renderer、shot grid、source-script 和 production-planning 都只消费这个共享组件，不能各自复制 Presence 状态机。

修改前：`children → effect → cachedChildren state → render → new children` 是闭环，`cachedChildren` 与当前 props 是重复状态。

修改后：`visible/exit/rendered → transition action → 必要时一次状态变更`；`children` 不参与状态变更决策。业务节点事实、React Flow 受控 nodes 和布局 writer 数量均不变。

## 正常、失败与时序

1. 初始可见或重新打开：若已 `rendered`，action 为 `idle`；否则只执行一次 `show`。
2. 可见期间任意父组件重渲染、翻译函数变化、ReactNode identity 变化：action 仍为 `idle`，不得调用 state setter。
3. 关闭且 `exit=true`：保留 ref 中最后提交的内容，启动一个退出 timer；重新打开时 cleanup 取消该 timer。
4. 关闭且 `exit=false`：立即不渲染，并只结算一次 `hide`。
5. 卸载：effect cleanup 取消退出 timer；不存在遗留 state writer。
6. 减弱动效只改变 animation flag，不改变 Presence 状态协议。

## 删除项与防回归

必须删除 `cachedChildren` React state 和任何由 `children` identity 触发的 Presence state setter。不得引入按节点 kind、renderer 名称、ReactFlow 状态或定时轮询的例外。

防线：

- 纯 transition 单元测试证明稳定可见、重入、立即隐藏和退出动画的动作穷尽。
- `BUG-CN-002` 历史场景以旧的“每次可见都缓存 children”故障模型反证，并以生产 transition 通过。
- Canvas guard 拒绝恢复 `useState<ReactNode>`、`setCachedChildren` 或跳过共享 transition authority 的实现。
- `canvas-node.md` 的 `CN-12` 将该规则列为 Canvas renderer 的模块不变量。

未验证盲区：本仓库 Vitest 运行在 node 环境且没有 DOM renderer；因此本阶段以生产 transition 的穷尽行为测试和源码 guard 防止递归 state write。真实浏览器交互仍应在正常人工 Canvas 验收中观察，但不能成为正确性的唯一来源。
