<!-- architecture-module: canvas-node -->

# Canvas 节点与投影

## 为什么是这样

Canvas 是 WorkspaceResource 文件树的空间化投影，不是第二套文件系统或业务状态机。一个文件夹对应
一个 Canvas。节点 identity、存在性、生命周期、动作能力和内容全部来自 registry、正式 Query、
Resource、Lineage 与 Task owner；Canvas 只拥有位置、视口、选择和临时草稿等纯展示状态。

不存在 Storyboard、Panel、VideoGroup、EditScript、Workflow stage 等专用流程节点。历史上这些阶段
节点各自解释一段制作状态，任何 owner 字段或查询条件漂移都会制造空窗，且把"文本记录存在"误解释成
"媒体已成功"。

## 不变量

- **CN-01 — 节点种类穷尽注册。** registry 为每种 kind 穷尽 identity、layout、renderer、Task
  target 与动作能力。新增同类实例不得通过分散 switch 或文件存在性接入。
- **CN-02 — 一个文件夹就是一个 Canvas。** 持久文件夹以自身 `resourceId` 作为 scope key，项目根
  使用唯一虚拟 identity，永不创建伪 Resource。
- **CN-02A — 节点 canonical identity 只来自 Resource。** 不得用路径、数组位置、最近记录、Prompt、
  DOM、历史消息或 Task 到达顺序推导 identity；路径变化不改变节点 identity。
- **CN-02B — 展开/收起只有一个裁判。** 当前文件夹按子树读取，由唯一 expansion policy 依显式预算
  导出展示形态。展开/收起不是持久状态、不落库、不由 renderer 或第二处逻辑再解释；父子关系只由
  共享路径关系函数导出，不能持久化第二份 parent 字段。同一画布会话内收起集合单调不回弹。
- **CN-02C — 导航只有一条路径。** 按钮点击、卡片单击与双击都调用 Canvas owner 注入的同一个导航
  callback。不得用 window event 或 renderer 私有状态建立第二条导航路径，也不维护第二份目录结构。
- **CN-02D — 布局不改变文件归属。** 拖拽只写当前 scope 下的位置，绝不修改路径；移动文件或文件夹
  只能走 Resource 的显式 move 能力。
- **CN-02E — 批次与当前选择不改变节点事实。** 每个 Resource 始终按自己的 identity 形成节点；
  领域批次只保持稳定展示顺序，不合并成候选节点。只有一次 generation 实际创建两个以上结果时才
  下发 alternatives 分组，单结果不伪造组。组不合并节点、不保存 selected/current；当前项只来自
  服务端 typed selection，renderer 不得用数组位置或本地选中态覆盖它。
- **CN-03 — 运行展示无裁决权。** Task runtime 只能覆盖已物化 Resource 的运行展示，不能凭 Task、
  模型推理或本地乐观结果创建节点或写业务状态。
- **CN-04 — 生命周期只有一个 resolver。** 持久 Resource、Task runtime 与纯 UI 展开态是独立输入；
  projector/renderer 不得根据文案、有无字段、timer 或 refetch 推断成功/失败。
- **CN-05 — UI 不展示领域 ID。** 正式 View 展示服务端按 canonical identity 投影的当前名称；缺少
  View 必须显式失败，不得回退成 id。
- **CN-08 — 同步与异步写入都精确交接 Query。** 只通过注册的受影响资源列表发布可 replay 事实：
  提交事件只公布已持久化的 pending Resource，终态事件只公布已结算事实。客户端只 invalidate 正式
  Query，禁止从 TaskType、target、operation output 或本地 baseline 猜更新。易失通知只优化延迟；
  正式 Resource View 的持久 revision 是在线完整性的唯一校验水位。
- **CN-10 — 连线只表达真实 Lineage。** 边必须来自持久的输入→输出 Lineage，且两端都已作为当前
  Canvas 的可见节点出现。推荐顺序、空间邻近、同批成员或共享目录都不能产生可见边。
- **CN-13 — 新批次只调整一次整体视口。** 持久批次 identity 是自动定位的唯一请求身份；至少一个
  目标物化后只执行一次整体 fitView。同批成员的状态变化、查询刷新与顺序变化都不得再次移动视口；
  用户操作立即终止动画。禁止按"第一个 running 节点"轮换或用 timer 恢复跟随。
- **CN-14 — 直接动作只复用正式 Operation。** 卡片 retry、variant 与编辑必须从最终 Action View
  构造精确 scope；上传必须经正式上传与物化 Operation。UI 不插入假 Resource、不改本地生命周期，
  只把成功 ACK 或变更通知当作 Query 失效信号。付费动作一次用户意图持有稳定幂等键，且只批准当前
  展示的完整计划。
- **CN-14B — 上传显式落在当前文件夹。** 提交意图时冻结当前 `folderPath` 与名称，由服务端
  派生并冻结最终路径；异步重试沿用已预留 Resource，切换文件夹不能把进行中的任务移到新目录。
- **CN-15 — 选择与 Assistant 上下文各有唯一 UI owner。** 父级持有唯一 selection 与唯一 assistant
  context；后者只在显式动作时从 selection 复制，单纯选中不附加。不建立全局事件总线或第二份
  selection。
- **CN-16 — Canvas 没有可见性覆盖层。** 节点隐藏与归档不是 Canvas 状态；渲染层不得引入第二可见性
  解释（本地 override、隐藏集合或按归档字段过滤）。
- **CN-17 — 布局按 project + folder 隔离，且只持久化顶层节点。** 读写前必须验证目标文件夹属于
  同项目且未删除，禁止以路径、当前上下文或最近布局推断 scope。展开分区内部的后代不写入父 Canvas
  的 layout scope。
- **CN-18 — 大规模必须保持 Canvas 语义。** 树与搜索使用稳定 cursor 分页并启用视口虚拟化，不因
  规模退化为普通列表。完整替换布局只能在当前目录全部分页完成后执行，避免用首页删除未加载节点的
  布局。列表投影只消费有界摘要。
## 权威入口

- 节点 registry 与投影编排：`src/features/project-workspace/canvas/**`
- 展开/收起唯一裁判：`canvas/projection/workspace-canvas-expansion-policy.ts`
- 唯一 lifecycle resolver：`canvas/lifecycle/**`
- Resource View 与列表/搜索 Query：`src/lib/workspace-resource/view-service.ts`、`src/lib/query/**`
- 布局：`src/lib/project-canvas/layout/**` + canvas-layout route（scope 为 project + folder）
- 资源变更通知：`src/lib/workspace-resource/resource-impact.ts`、`resource-change-publisher.ts`

## 踩过的坑

- Storyboard/Panel 把"文本镜头记录存在"解释成"图片已成功"，18 个未提交的图片 Task 同时显示成功
  → 两种事实共用一个节点状态 → 删除阶段节点与全部入口（CN-03/CN-06）。
- 自动跟随最初为串行阶段设计：持续选择"第一个 running 节点"，并发批次逐个终态时选择结果随之变化，
  还有 timer 在用户操作后抢回视口 → 用运行顺序当定位身份 → 批次 identity 只触发一次整体 fitView
  （CN-13）。
- 视频卡曾复用无目标的批级动作，全部卡片得到同一总价，单卡点击真实提交了全部成员；本地标记只标
  点击的卡，无法纠正服务端批量事实 → 展示层 scope 与执行 scope 不一致 → 从同一卡片 View 构造
  精确 scope，计费请求的缓存身份包含该 scope（CN-14）。
- 图片预览按钮从初版就 stopPropagation，但包装层同时拥有内建 element selection 与业务点击入口，
  打开大图会同时唤起详情；第一轮只加 interaction marker，仍依赖包装层保留子元素语义，人工复验
  确认无效 → 存在两条 selection 入口 → 显式关闭 element selection，只保留唯一 controlled writer。
- 资源树切换后仍使用的一个查询 Operation 被误删，卡片状态刷新确定性返回"Operation not found"
  → 删除旧读取包时没有枚举实际消费者 → 该查询归入 Task Operation 包并保持 API-only。
- 列表查询曾为每个文本/JSON 读取对象存储全文，数千项时即使虚拟化也无法控制 I/O → 列表路径承担了
  单资源读取的职责 → 摘要来自版本行物化的预览列，完整正文只由单资源入口消费（CN-18）。
