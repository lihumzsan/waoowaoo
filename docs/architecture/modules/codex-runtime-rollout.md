<!-- architecture-module: codex-runtime-rollout -->

# Codex Creative Runtime

## 为什么是这样

Codex app-server 是唯一 Agent Runtime，并独占 Codex 文本采样、原生搜索与 Thread/history；Wao 保留产品
View、WorkspaceResource、Capability Service、破坏性确认、Task 和执行平面。桌面原生模式直接复用当前 Windows 用户的 Codex 登录，
Wao 只为每个 placement 物化可销毁 workspace 与其中的 registry Skills，不写入或清理标准 Codex Home。Docker 部署使用显式平台
API 凭据和按 scope 隔离的 Codex Home 保存原生 Thread/history，不经过模型网关。Runtime 可被替换，因此 UI 和业务
服务不直接依赖它的进程细节，统一经适配器与 AssistantRuntime。

容器是租户和资源边界，Codex 内层 sandbox 是纵深防御——两者职责不同，不能互相替代。产品 edition
不是运行环境 profile：把两者混为一谈会让本地开发无法启动，或让生产静默降级。

不使用 Git：创作历史由资源版本拥有，并发安全来自 ownership、单 Turn、Catalog 锁与不可变版本身份。

## 不变量

- **CRR-01 — 唯一 Runtime。** 每个活跃 `(userId, projectId)` 最多一个 Runtime session；同一
  Project 同时最多一个活跃 Turn。
- **CRR-02 — 适配器隔离协议。** UI、route 和业务 service 只能通过 AssistantRuntime；协议方法、
  版本差异和进程生命周期收敛在适配器与 Session Manager。进程级能力必须在 app-server 启动时启用
  并验证，不能只在会话层声明后假定已存在。
- **CRR-03 — Runtime driver 必须显式且保持双层隔离。** local driver 复用桌面登录和标准用户 Home；
  Docker driver 使用平台 API 凭据与按 scope 持久 Home。两者都只能写临时 Project workspace，并运行
  同一钉死版本的原生 App Server；禁止 driver fallback、共享租户 Home 或绕过内层 Codex sandbox。
- **CRR-04 — WorkspaceResource 才是项目持久事实。** Runtime 只物化空 scratch 与 workspace 内 registry 生成的主 Agent Skills；
  不物化项目文件，不复制 Catalog 或对象内容，也不在 Turn 结束时 capture 文件。项目生产事实由服务端每 Turn 直接附加给唯一 writer。
  local 标准 Codex Home 或 Docker scope Home 只供原生 Codex 写 Thread/history 与运行配置，Wao 不写入 Resource、Skill 正文；scratch、inode 和
  Runtime 路径都不是产品权威。
- **CRR-05 — scratch 没有持久语义。** Runtime 可自由创建临时研究和工具文件，但这些文件不会被
  观察、上传或映射为 Resource。持久内容必须显式调用业务 Operation；媒体引用使用 canonical
  Resource id/version，不通过本地指针文件。
- **CRR-06 — Runtime 状态与产品 View 分权。** driver 所属的 Codex Home 是模型 Thread/history 与 resume 的
  唯一权威；数据库 View 是聊天展示、确认归因和产品刷新事实。Product Thread 在首个原生 Turn
  前绑定 native thread id；产品消息绝不 seed、修补或重建模型历史。两份事实服务不同消费者，任何
  一方都不得被解释为另一方的恢复 fallback。
- **CRR-06A — 静态 Agent 合约拥有唯一运行水位。** 实际 base/developer instructions 与 registry
  生成的全部 Runtime Skills 共同派生一个 contract revision；placement 只执行物化时冻结的同一
  revision。准入发现旧 revision 时，活跃 Turn 必须先自然结算；没有活跃 Turn 时由 Session Manager
  唯一替换 placement，并以持久 native thread identity 和新合约恢复，禁止依赖重启、idle timer、
  Skill 版本字符串或产品消息回灌完成正确性接力。
- **CRR-07 — MCP 是唯一系统能力桥。** 真实媒体、导入、批量生产与破坏性操作只经带当前 Turn
  凭据的 MCP；Capability Service 仍是业务实现，MCP 不复制逻辑。Runtime bearer 只证明能力调用权，
  绝不证明用户同意——破坏性 writer 必须验证浏览器侧已持久化的同 Turn 决定。每次调用由同一
  Session Manager 直接授权调用，不做文件 flush/refresh；授权与 ownership 复验全部发生在副作用
  之前。业务结果只从持久 View 返回，临时工作区状态不能把已成功的副作用伪报为工具失败。
  业务能力命名空间必须标记为 direct-only，不进入嵌套执行器。
- **CRR-07A — 用户取消是正常终态。** 拒绝破坏性确认时返回结构化 declined 且不标记协议错误；
  UI 显示"已停止"，模型不得解释为服务失败或建议重试。
- **CRR-07B — Runtime bearer 不是模型 API key。** bearer 是当前 placement 的签名 identity，没有独立的墙钟有效期；其 nonce 只用于 Wao MCP ownership
  与 capability 授权；Codex 模型采样和原生搜索使用 local 桌面登录或 Docker 平台 API 凭据，不经过 Wao bearer。MCP 先证明该 nonce 仍持有租约，
  再证明 Project 恰好一个活跃、未取消、未 clear 且归属本次执行的 Turn。native thread id 只标识模型历史，绝不替代当前 Turn
  与 ownership 的执行授权。placement 停止或轮换必须先关闭其协议 session，再释放租约；旧 token 因失去 ownership 不能重放。
- **CRR-08 — 空闲可停，持久性不依赖停机事件。** 无活跃 Turn 时达到 idle timeout 可直接停止进程并
  删除 scratch；所属 Codex Home 由 Codex 原生维护，不等待 completion、checkpoint 或
  shutdown 回调才获得持久性。释放 ownership 前仍必须确认产品 Turn 已结算。
- **CRR-09 — 版本钉死，实验能力显式协商。** binary/协议版本与 smoke 一起升级；未知关键
  request/event 不得静默忽略。产品所需的实验方法必须在 initialize 显式声明并由真实 schema smoke
  校验存在；关闭该能力等同缺失必需能力。升级前必须排空活跃 Turn，并在持久卷快照副本上验证原生
  read/resume；不兼容时原地失败，禁止以产品 View 重建模型历史。
- **CRR-09B — Native sampling 与重试只有一个 owner。** Codex App Server 是同一 Turn 内模型请求与流式连接重试
  的唯一 owner 且重试有界；Wao 不建立第二套模型 proxy、retry 或请求规范化。无法由原生协议无损承载的字段原地失败。中间错误只表示
  本次尝试，声明将重试时不得提前写产品 Turn 失败。
- **CRR-11 — 进程内 Manager 唯一。** 同一进程的所有 route bundle 必须复用一个进程级 Manager；
  开发热更新不能遗留仍在续租的模块级实例。跨进程唯一性由外部 ownership claim 裁决；每个原生
  命令和后台恢复入口在动作前确认同一个 owner generation，不能只在进程启动时获取一次租约。
- **CRR-12 — 当前控制面单进程。** placement 与 MCP session 目前都是进程内对象，因此 Web 控制面
  只支持一个 Node 进程；媒体 Worker 可独立横向扩展。启用多 replica 前必须先增加按 owner 的请求
  路由与 session affinity，禁止把 ownership claim 误称为跨 replica 转发能力。
- **CRR-13 — Runtime 路径不能成为产品链接。** materialization root、scratch 相对路径、绝对路径和
  `file://` 只属于可销毁执行环境；标准 Codex Home 是原生用户状态，不是 Wao 的产品链接或 scope 事实。
  用户可导航对象必须使用 canonical Resource identity 并交给 Canvas 的唯一定位入口；任何 Runtime 路径都不得投影为产品链接。

## 权威入口

- Runtime 协议与适配：`src/lib/codex-runtime/runtime-adapter.ts`、`app-server-client.ts`
- placement / ownership / idle / 恢复：`src/lib/codex-runtime/runtime-session-manager.ts`
- 隔离与容器：`runtime-config.ts`、`Dockerfile.codex-runtime`
- workspace scratch 与 Runtime Skill 配置：`src/lib/assistant-runtime/runtime-persistence.ts`、
  `src/lib/creative-skills/runtime-skills.ts`
- 原生 Codex Home 与 App Server：`src/lib/codex-runtime/app-server-client.ts`；能力桥：`src/lib/wao-mcp/**`

## 踩过的坑

- 容器 driver 首版把外层容器当成唯一沙箱，向 Turn 声明完全访问权限；同 UID 的 shell 因而能读取
  bearer 并直连旧模型通道 → 两层隔离被当成一层 → 本地与容器都启用受限写权限并关闭 shell 网络
  （CRR-03/CRR-07B）。
- Docker Runtime 首版 smoke 只验证镜像与 app-server 协议，并从容器外直接读取 Skill；后续又强制旧
  Landlock，先触发互斥 enforcement 拒绝，移除旧后端后才暴露外层 Docker 禁止 `bubblewrap` 创建内层
  namespace → 绕过 Codex 的 syscall 验收不能证明双层沙箱可用 → 外层容器只授予内层沙箱所需的有界
  能力，smoke 必须经该钉死版本的 `codex sandbox` 执行且发布后再用真实模型 Skill 调用验收（CRR-03）。
- Landlock 验收曾只证明内层沙箱可以读取 Skill 文件，没有驱动模型走真实原生 Skill 调用；Skill 位于
  Codex home 时，`on-request` 仍把模型发起的读取解释为工作区外命令并要求人工确认 → syscall 可读不等于
  真实调用无需审批 → registry 生成的 Skill 只在 workspace `.agents/skills` 暴露，由容器叠加只读挂载，
  shell 类权限使用 granular 拒绝让越界原地失败而不产生无人能处理的审批请求
  （CRR-03/04）。
- 为消除 shell 审批曾把整个 Runtime approval policy 设为 `never`；Codex 同时自动拒绝 MCP elicitation，
  所有破坏性操作因此立即表现为用户拒绝且没有可响应交互 → 命令审批和业务确认不是同一权限类 →
  granular policy 只允许 MCP elicitation，shell、规则、Skill 与权限升级继续 fail-closed，并以真实确认
  交互验收（CRR-03/07）。
- 旧模型通道首版只验证"项目里恰好有一个活跃 Turn"，未证明请求来自当前 Runtime；旧容器 bearer 可在
  placement 存活期间等待新 Turn 后重放 → 凭据没有绑定 placement 租约 → bearer nonce 与 ownership token
  完全相同（CRR-07B）。
- MCP 首版把只有 checkpoint 后才写入的 durable thread id 当成当前调用身份，全新线程的首个 Turn
  因此在计划生成前统一失败；此前的真实验收复用了已有线程，只证明恢复路径 → 用恢复身份做执行
  围栏，且验收遗漏首轮路径 → 统一 capability Turn resolver 不再要求 durable thread id。
- MCP 曾在业务事务或执行提交成功后才做 ownership 复验；用户恰在提交后取消会让后置检查抛错，把
  真实成功返回成失败并诱导重复执行 → 授权复验发生在副作用之后 → 复验截止于副作用之前，后置刷新
  失败只触发恢复与告警（CRR-07）。
- 版本升级为通知信封新增可选字段，而 fail-closed parser 仍只允许旧结构，升级后在 initialize 之后
  立即杀死进程，所有 Turn 表现为 Runtime failed → 钉死版本与生产 parser 不同步 → 两者同步演进
  （CRR-09）。
- 产品 edition 被当成运行环境 profile：Cloud 无条件要求容器，而本地 Cloud 开发的 preflight 又要求
  本地进程，所有本地首条消息都在 materialize 前失败 → 只有生产强制容器（CRR-03）。
- 模块级 Runtime singleton 在开发热更新后失去引用但继续续租，新 bundle 又创建了第二个 Manager，
  表现为永久 ownership busy → 模块级单例不是进程级单例 → 进程级 global 只保存一个 service。
- 首次接通业务审批时只延长了两层 timeout，遗漏两个真实协议边界：调用被嵌套执行器包裹、以及内部
  发起的请求脱离父调用后路由到无人持有的独立流 → 服务端已在等待用户而 Runtime 收不到请求 →
  业务命名空间 direct-only，内部请求保持父请求关联，两层 timeout 只承担等待上限（CRR-07）。
- 中文项目的最终答复遵循 locale，但流式推理摘要仍短暂显示英文 → 只约束"response"不足以覆盖全部
  可见输出 → 每 Turn locale context 显式覆盖回复、进度、计划说明与推理摘要。
- Runtime 曾镜像完整资源树并在 MCP 前后 capture/refresh，媒体还用 `.resource` 指针表示云文件；
  临时文件因此成了第二个状态解释者，文件漂移会阻断已就绪的云资源 → 删除资源镜像、指针与写回，
  Runtime 只保留可销毁 scratch，所有持久事实直接经 Operation 读写（CRR-04/05/07/08）。
- 删除资源镜像后曾保留一次性生成的 `system/project.json`；长生命周期 Runtime 中配置变更会让该文件
  过期，且相同路径又被误传给只认 Resource 的工具 → 可重建文件仍是竞争状态解释源 → 删除全部项目
  文件投影，每 Turn 从唯一 resolver 直接注入当前 View（CRR-04/13）。
- Runtime state 曾只在成功 completion/idle 时复制到对象存储；失败或进程被杀时最新用户消息没有进入
  bundle，恢复又用不含该消息的产品 View seed 新线程，导致约束回退 → checkpoint 与 UI seed 是两个
  竞争历史 writer → 删除两者，模型历史只由持久 Codex home 原生维护（CRR-06/08）。
- 搜索工具切换曾证明持久 native Thread 会保留旧指令，但当时只把 revision 要求写进事故结论，没有
  建立实际合约 resolver；后续 Creative Skill 虽升级版本，活跃 placement 仍只比较环境指纹并继续执行
  旧分段规则 → 上一版防线没有进入真实准入与物化路径 → exact instructions 与生成后 Skills 派生唯一
  revision，Session Manager 在安全 Turn 边界替换旧 placement（CRR-06A）。
