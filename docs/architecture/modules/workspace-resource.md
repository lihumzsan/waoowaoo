<!-- architecture-module: workspace-resource -->

# WorkspaceResource 创作工作区

## 为什么是这样

一个 Project 只有一棵创作资源树。`WorkspaceResource` 同时表示目录、用户可编辑文字文件，以及
生产出的图片、音频和视频；不存在 Authoring File、CreativeResource、Episode Resource 或 Canvas
Card Resource 等平行实体。

Episode、Chapter、Scene、Shot、Canon 都是用户目录与文件内容，不是系统 scope、外键或第二状态机。
旧系统把 Resource、领域表、Canvas 节点、authoring file 和消息附件分别解释为创作事实，导致名称
匹配、最近记录和多条 current 关系互相竞争。

## 不变量

- **WR-01 — Catalog 是路径与存在性的唯一持久权威。** 稳定 `resourceId` 是身份，`(projectId,
  activePath)` 唯一约束当前路径。未删除资源有且只有一个路径；删除只清空当前路径并保留最后路径
  用于恢复。对象存储拥有文件内容，Runtime 文件夹只是可销毁工作副本，Canvas 只是 View。
- **WR-02 — Project 是唯一作用域。** Resource 只有 `userId + projectId` 所有权。目录语义不产生
  系统 scope、外键或第二状态机。
- **WR-03 — 文件夹也是 Resource。** 虚拟根不持久化；每个非根父目录必须是同 Project 的未删除
  文件夹 Resource，因此空目录可持久化和显示。
- **WR-04 — 内容与语义按版本边界冻结。** 每个版本指向不可变对象。用户编辑只追加版本；生成结果由
  终态 materializer 追加版本。`resourceId + contentVersion` 是执行输入身份，当前路径只用于显示
  和审计。带注册 outputKind 的结构化文件必须在 checkpoint 通过同一 Output schema；同一 Resource
  不能改成另一 outputKind。
- **WR-05 — 字段所有权明确。** Agent 可在用户树内创建、编辑、移动、改名和软删除用户内容；不可写
  identity、status、Task、媒体指针内容、Lineage、模型、成本或系统投影。越界、隐藏路径、
  traversal、非法后缀和系统字段篡改必须原地失败。
- **WR-06 — Runtime checkpoint 是唯一文件写回入口。** materialize 时由 Catalog 与对象存储生成
  完整 Bundle；capture 时比较同一 baseline 并在一个事务内提交完整资源树。并发路径、存在性、类型、
  schemaId 和可写文本版本变化使整次 checkpoint 失败，不允许部分写回。
- **WR-07 — 所有生产能力强制 Placement。** 每个产出 Resource 的 Operation 必须在 registry 声明
  输出 kind/media/schema 并要求输出路径。Plan 阶段验证父目录、路径、schema 与冲突；缺 placement
  不报价、不提交，也不静默落收件箱。
- **WR-08 — 执行前冻结精确输入。** 以用户提供的路径解析当前 Resource，再把 `resourceId +
  contentVersion + role + position` 冻结到同一个 Snapshot。执行、重试和 Lineage 都只消费冻结
  版本，不能在 Task 开始后重新按路径读取。
- **WR-09 — 一个异步终态 writer。** 生成 Operation 的 commit 事务预留 pending Resource 与 Task；
  Task 终态在同一事务物化版本、Lineage、Resource 状态、Task 终态与通知。replay 返回同一事实，
  不能生成第二 Resource 或重复计费。
- **WR-10 — 批量生产是版本化专业 JSON，不是 N 次 Agent 调用。** 只接受项目相对 manifest 路径，
  用同一 Output schema 复验并冻结内容身份与摘要；一次冻结形成一个总报价和一个 Grant，再扇出
  Task。成员有稳定 identity；部分失败只重跑失败成员，成功成员不重提。
- **WR-11 — 移动、删除、恢复只有一套语义。** 文件移动只改自身路径；文件夹移动原子改写完整子树。
  移动、软删除与恢复必须以 canonical `resourceId` 定位并在 Project 锁内解析当前路径——禁止拿旧
  View 的 path 删除后来占用同一路径的另一个 Resource。活跃 Task 涉及的 Resource 不可移动或删除；
  pending Resource 不可删除。恢复冲突时必须显式给新路径，禁止静默改名。
- **WR-13 — 大项目按目录读取。** 列表与搜索用 cursor 分页和有界摘要，摘要来自版本行物化的预览
  列，列表路径零对象存储读取；完整正文只经单资源读取入口按需加载。规模上限必须明确失败，不能
  恢复静默截断。
- **WR-14 — 并行写入边界显式。** 主 Agent 是全局一致性文件的唯一 writer；并行 Subagent 只能写
  被分配的互斥目录。两个 writer 争用同路径由唯一约束与 checkpoint baseline fail closed，不靠
  最后写入覆盖。
- **WR-15 — MCP 边界同步同一工作区。** Operation 开始前必须在唯一 persistence queue 中 capture
  Runtime；结束后只在 Runtime 未变化时刷新最新投影。任一同步失败都不得开始新的付费执行，也不得
  伪装成功。Catalog、Task 与幂等执行身份仍是恢复权威。
- **WR-16 — 创作内容不在服务端编译。** 专业 JSON 必须包含完整最终 Prompt、创作身份与显式参数。
  Planner 在任何 Plan、报价、Resource 或 Task 副作用前严格校验、选择正式模型、解析精确引用并
  逐字冻结；禁止依据 schemaId 追加 Prompt、猜资产类型或覆盖比例。
- **WR-17 — Runtime 能力文件只读且可重建。** 只读能力投影由当前项目配置与生产 registry 派生，
  不是 Agent 可写配置、Task 快照或第二份能力权威。缺必需能力时对应值为空，专业子 Agent 必须停止
  而非猜测；提交时仍以当前配置重新校验并冻结真实执行参数。

## 权威入口

四个业务入口，route/UI/MCP/CLI 都只能调用它们，不能直接写 Resource、Version 或 Lineage：

1. WorkspaceResource persistence：folder、user file、move、soft delete、restore、checkpoint、
   reserve、materialize（`src/lib/workspace-resource/**`）
2. 产出 Resource 的 Operation registry：创建、上传/导入、合并，以及主 Agent 唯一新媒体入口
   Production Manifest
3. Task terminal materializer：异步成功、失败与取消
4. Runtime projector/capture：Catalog ↔ 临时普通目录（`src/lib/codex-workspace/**`）

## 踩过的坑

- 删除首版接受路径而非 canonical id；新增第二个删除入口后，旧 View 与并发移动之间可能误删占用
  同一路径的另一个 Resource → path 是可变位置而不是删除 identity → 全链路传 `resourceId`，锁内
  一次解析（WR-11）。
- 文本版本最初只用 `resourceId + version` 作为对象 key，且在事务提交前上传；事务回滚后同版本不同
  内容的重试会覆盖对象，而数据库仍保留旧摘要 → 版本不可变性被对象覆盖打破 → 对象 key 包含内容
  SHA-256，宁可留下待回收的未引用对象。
- 16 位 compact 幂等 hash 被写进要求完整 SHA-256 的输入字段，四类媒体 Task 在 Provider 调用前
  确定性失败；失败终态又先解析同一畸形 payload，Task、Resource 与冻结额度永久停在处理中 →
  两种 hash 混用 + 终态解析耦合成功路径 → fingerprint 与请求 identity 分离，失败终态只用
  canonical target 结算。
- 媒体 Task 在 Agent Turn 结束后异步物化版本，而 baseline 把所有 `currentVersion` 变化都视为
  Agent 写冲突，未变的媒体指针也报漂移 → 前台与后台 writer 共用同一 CAS 维度 → 文本按版本 CAS，
  媒体指针只以 identity/路径/存在性/类型参与。
- 专业 Skill 各自手写字段示例，执行层又是另一份 strict 权威，真实 worker 写出的字段被拒；错误
  投影还剥掉了字段级 issue，模型转而猜路径反复重试 → 同一契约两份表示 → 三种媒体直接复用同一
  Output Registry schema，失败返回有界字段 corrections。
