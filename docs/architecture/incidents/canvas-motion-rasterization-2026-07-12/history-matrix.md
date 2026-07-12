# Canvas Motion Rasterization 历史回归矩阵

| 历史症状 | 根因 | 当时修复 | 当时防线 | 本次复发形式 | 防线失效原因 |
| --- | --- | --- | --- | --- | --- |
| 展开/折叠内容跳变 | 内容高度没有共享 transition | 引入 Motion Presence 与 grid-row 动画 | layout runtime 源码结构检查 | 不适用；本次保留该能力 | 旧防线只确认 wrapper 存在 |
| 折叠时宽度与测量竞争 | 宽度变化节点仍等待退出动画 | `exit=false` 即时卸载宽度变化内容 | profile/layout logic | 不适用；本次不改变宽度协议 | 没有覆盖稳定态浏览器合成 |
| `Maximum update depth exceeded` (`BUG-CN-002`) | visible children 被镜像进 React state | transition authority + ref 保存退出内容 | logic + guard + CN-12 | visible 内容不再循环，但稳定 DOM 仍在 transform layer | 防线只约束 state writer，不约束 CSS compositor state |
| 放大后节点标题清晰、展开详情模糊 (`BUG-CN-003`) | entered animation `both` + 永久 `will-change`，并与 React Flow scale 嵌套 | active-only 动画与 hint；settled 恢复普通 DOM | Golden computed-style oracle + CSS guard + CN-12 | 当前事故 | 修复前没有真实浏览器稳定态 oracle |
