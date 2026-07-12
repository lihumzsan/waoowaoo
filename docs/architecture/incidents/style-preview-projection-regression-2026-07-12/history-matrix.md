# 历史回归矩阵

| 历史症状 | 根因 | 当时修复 | 当时防线 | 本次复发形式 | 防线失效原因 |
| --- | --- | --- | --- | --- | --- |
| Assistant 视觉风格候选卡在生成中丢失或停靠位置错误 | 卡片从 message/task 快照和局部活动状态重建 | `d6e52a7e5`、`9566666d5` 恢复 active card 和停靠 | Session/renderer 单测 | 生成卡被整体删除，只剩通用“3 个任务”行 | 防线随重构被改成断言卡片不存在，之后专项测试删除；没有真实生成中浏览器 oracle |
| 视觉风格任务生命周期与候选行脱节 | parent Task、preview `taskId` 和局部轮询多轨 | `b5bf73a77`、`d31a5615b` 绑定 Task 与 preview target、隔离 runtime target | Unit/回归测试 | Task 已提交但 Canvas/Assistant 正式 Query 未在提交边沿重读 | 测试只验证 Task/Wait/终态，不观察提交后、终态前的 UI |
| 旧生成卡直接确认风格 | renderer、Panel、route 和 Operation 多 writer | `90acd0228` 删除客户端确认写入，Choice/Operation 成为唯一入口 | Assistant lifecycle guards | 后续 `a4aed5ba47` 连只读生成 UI 一并删除 | 把“删除第二 writer”错误扩大为“删除整个 presentation” |
| Style Bible 确认后 Canvas 仍显示三候选 | 同步 Operation 写入成功但资源影响解析不识别 preview target result | 本次待修 | 现有 Journey 只验证 workflow/Choice 可继续 | `styleBibleJson` 已写 DB，客户端仍消费旧 editBible Query | `extractWorkspaceResourceRefsFromWriteResult` 未识别 `ProjectEditStylePreview` target；Journey 没断言 Canvas Style Bible |
| Canvas 风格占位与最终节点 identity 不同 | preview placeholder/candidate/final Bible 使用不同 node id | `d31a5615b` 曾恢复 parent placeholder | Canvas lifecycle unit/conformance | 当前三个 preview node 在确认后才应切换为 Bible，造成布局与职责混杂 | Conformance 只证明每个 kind 自洽，不证明产品只应有一个 Style Bible identity |
| Golden 主链绿色但生成中 UI 缺失 | Journey 把任务阶段读取为 workflow stage，DOM boundary 返回 waiting | 2026-07-12 Golden 建立真实全链 | 最终输出、reload、Choice/Approval、durable oracle | 真实任务完成后 Choice 可用，因此 Journey 通过或继续 | scenario contract 只写“Approval and Task complete”，没有生成中候选卡/Canvas placeholder oracle |
| Golden 恢复生成卡后把只读标题误判为 Choice | boundary 只按“选择视觉风格”文案识别，没有验证持久 Choice 的提交控件 | 本次待修 | 无独立 Choice DOM oracle | 生成卡在任务刚终态时合法显示同名标题，Journey 提前 reload/submit | 测试读取 UI 文案承担业务状态解释，正是生产架构禁止的同类启发式 |

## 本次防线

- 真实 Golden 在 Task processing 窗口观察 Assistant 三候选与 Canvas 单 Style Bible 节点，禁止只等终态。
- 同一 Golden 在 Choice 后读取 Canvas 节点 identity/可见内容并 reload，禁止只读 workflow stage。
- Canvas conformance 从生产 registry 穷尽；删除 `editStylePreview` kind 而不是保留不可达定义。
- Shared resolver Logic 直接输入正式 resource/task facts，反证 partial complete、failed-after-running、ready-for-choice 和 confirmed 错误优先级。
- Git 中旧 renderer 只作为视觉参照，测试以用户可见 DOM/图片/状态为 oracle，不断言源码字符串。
