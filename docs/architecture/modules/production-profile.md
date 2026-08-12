<!-- architecture-module: production-profile -->

# Production Profile

## 为什么是这样

同一套生产底座可以承载不同内容类型，但不同类型不能靠 Prompt 猜测、页面路径或已有文件反推。
Project 因此持有一个不可变的 Production Profile 身份；它只决定该项目允许的专业领域与生产旅程，
不复制媒体生成、Task、Resource 或 Canvas 的 owner。这样新增内容类型是 registry 中的新实例，而不是
另起工作流引擎或修改已有类型的事实解释。

## 不变量

- **PP-01 — 项目类型身份单一且不可变。** Project 创建时必须显式写入 profile id 与 version；
  `create_project` 是唯一 writer。创建后不得由 UI、Agent、已有资源或当前步骤改写、猜测或降级。
- **PP-02 — Profile registry 是唯一解释者。** 专业领域准入与可选生产旅程只由同一个穷尽 registry
  声明；未知 identity 或不支持的 version 必须原地失败，不得按默认类型继续。
- **PP-03 — 能力暴露与持久写入使用同一准入结论。** Runtime 只能物化当前 profile 允许的专业 Skill，
  专业文档的唯一保存入口必须再次按同一 registry 校验；Prompt 约定不能替代服务端边界，否则会把
  错误领域数据持久化进 Project。
- **PP-04 — 生产旅程不是第二份状态。** 旅程只是一份由当前 profile 与正式 Resource 生命周期派生的
  View，不持久化步骤完成标志，也不从消息、Canvas 位置、名称、时间或 UI 局部状态推断终态。
- **PP-05 — 共享生产 owner 不按类型分叉。** Profile 可以改变专业编排，但图片、音频、视频、Task、
  Resource、计费和 Canvas 仍使用各自唯一入口与生命周期；不得为某种内容类型复制同义执行链。

## 权威入口

- Project profile identity、准入与 Journey View：`src/lib/production-profile/**`
- 唯一创建 writer：`create_project`
- Runtime Skill 物化：`src/lib/assistant-runtime/runtime-persistence.ts`、`runtime-access.ts`
- 专业文档持久化边界：`save_project_document`

## 踩过的坑
