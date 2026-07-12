# 历史回归矩阵

| 历史症状 | 根因 | 旧修复/防线 | 复发形式 | 本次防线 |
| --- | --- | --- | --- | --- |
| 修改多个路径时只看到聚合模块列表 | router 先合并路径再筛模块，没有 path → match 归属 | 人工根据输出反推 | 未映射路径被其他已命中路径掩盖 | 每个输入路径独立显示模块、匹配 sourcePath 和未映射状态 |
| 实施中扩展了修改范围但未再次做架构路由 | 修改前只检查预计目标 | 提交前人工 Git review | 新增/移动的权威文件没有进入架构审计 | `--changed` 修改后只读枚举全部实际变化并复用同一 router |
| 大量测试存在但真实组合路径失败 | changed-file、目录覆盖率和 mock 自证替代用户 observable | test-system reset 删除启发式，Golden 成为最高证据 | 容易把 `--changed` 再做成测试选择器 | 明确禁止 changed-file 决定 Journey；仍由 TG-11 和模块语义裁决 |
| 制作规划 raw stream 与 Canvas adapter schema 漂移 | worker normalizer 和浏览器各自维护输出解释 | Canvas CN-03 要求共享 raw schema | 新 Prompt 或字段变更只更新生成/终态路径 | 通用 Prompt 输出契约要求审计 raw schema、stream、normalizer、fixture 与 UI |
| 核心剪辑模型字段与 ledger 事实重复 | Prompt/schema 让模型成为第二事实 writer | chapter planning 收敛为 ledger projector | 局部模块 guard 不能提醒其他结构化 Prompt | 所有 ai-prompts 路由到通用 Prompt 契约，领域模块继续决定具体 owner |
| Golden provider fixture 返回旧协议 | deterministic provider 手写字段与生产 parser 漂移 | provider self-test 校验部分生产 schema | fixture 绿色被误认为真实模型或全部 Prompt 已验证 | 文档明确 fixture 只是协议替身；结构化字段变化必须审计 fixture 并运行适用 Journey |
| standards pricing/capability 文件未命中架构模块 | manifest 未登记 standards 根目录 | 独立 catalog syntax checks | 修改标准但未阅读 billing/provider 权威说明 | 将已证实的 standards 路径映射到相关模块，并记录运行时代码 catalog 双表示盲区 |
