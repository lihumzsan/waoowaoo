<!-- architecture-module: codex-runtime-rollout -->

# Codex Runtime 渐进替换

## 当前状态

当前只完成 **Stage 0 隔离验证**。`src/lib/codex-runtime/**`、`src/lib/wao-mcp/**` 与
`scripts/codex-runtime-smoke.ts` 不接收生产 HTTP 请求、不写产品 Thread/Turn View、不执行
收费 Operation，也不改变现有 Agent、Temporal 或 Canvas 的权威关系。通过后才允许进入
Runtime Session Manager、产品 View 接入与一次性切换阶段。

## 目标

把通用 Agent 能力交给 Codex app-server；Wao 只拥有三类产品事实：普通文本创作工作区、
可计费的媒体生产能力，以及供 Canvas/Chat 渲染的最终 View。创作工作区是文件，Canvas 是
投影；图片、视频、音频、Task、Billing 与审批仍由现有正式服务拥有，不伪装成文件状态。

## 不变量

- **CRR-01 — RuntimeAdapter 是唯一 Codex 协议边界。** 产品层不得直接拼 app-server
  JSON-RPC。Stage 0 固定验证 `codex-cli 0.144.1` 的 stdio 协议；升级前必须重新运行真实
  smoke，协议差异只在 adapter 内处理。
- **CRR-02 — app-server 是进程内运行时，不是产品事实库。** Codex Thread rollout 只用于
  模型恢复；MySQL 中的用户可见消息、审批、Task、计费和最终 View 仍是产品权威。空 Thread
  尚无可恢复 rollout；完成至少一个 Turn 后才可跨 app-server 进程 resume。
- **CRR-03 — 进程失败显式结束当前运行。** 进程退出必须拒绝全部 pending request，并向
  owner 发出 `processExited`。Stage 0 只证明“结束进程后以 threadId 建新进程恢复已完成
  Turn”；不承诺透明恢复进程中 Turn。生产 Session Manager 必须选择 kill-and-resume，禁止
  猜测旧进程仍在执行。
- **CRR-04 — 每个活跃 user/project 只有一个运行时 owner。** Stage 0 的
  `LocalRuntimeManager` 以 runtimeKey 串行建立进程并拒绝同 key 不同 cwd。生产容器调度、
  多设备准入、空闲回收和崩溃重建由后续唯一 Session Manager 承担，不能由 route 或 UI
  各自启动第二个 runtime。
- **CRR-05 — 双层隔离职责不同。** 生产外层容器或 microVM 是租户、CPU、内存、磁盘和
  进程边界；Codex `read-only/workspace-write` 是内层命令权限。Stage 0 本机 smoke 可裸跑，
  不是多租户部署依据。默认创作 Turn 使用 `workspace-write`，审阅任务使用 `read-only`；
  `danger-full-access` 不得成为云端默认值。
- **CRR-06 — 工作区只有一个 S3 bundle writer。** canonical identity 是
  `userId + projectId` 哈希后的固定 object key；bundle 只含 UTF-8 `.md/.txt/.json`，编码、
  排序、路径和大小限制由 `workspace-bundle.ts` 唯一解释。没有 Git、revision、CAS、状态字段、
  本地持久卷或逐文件对象。单 writer 假设失效前不得并发保存同一项目。
- **CRR-07 — 运行目录是临时 materialization。** 每次启动把 bundle 展开到空的 authoring
  目录，结束后 capture、规范化、写回并销毁目录。symlink、隐藏路径、穿越路径、二进制和特殊
  文件原地失败。媒体文件不下载进工作区；文本只保存正式 Resource/Artifact identity、意图和
  提示词，Task/Artifact status 由产品 View join 得到。
- **CRR-08 — MCP 是现有 Operation 的协议投影，不是第二业务层。** Tool 名称、说明、输入
  schema 和 effect annotation 来自生产 Operation Registry；MCP Server 只转发给注入 executor。
  鉴权、scope、稳定 call identity、计划、计费、审批、Task、Provider 和幂等仍由正式
  invocation owner 裁决。MCP annotation 不能代替 Wao 计费审批。
- **CRR-09 — Stage 0 MCP 不产生真实 effect。** 当前五项 allowlist 只验证协议：
  `create_image/create_video/create_audio/generate_voice/merge_videos`。Stage 0 executor 必须是
  no-effect 探针。生产切换前应把 MCP exposure 变成 Operation Registry 声明并删除临时
  allowlist，禁止长期维护第二张能力表。
- **CRR-10 — Temporal 只保留长期产品任务。** 图片、视频、音频和合并等长任务继续由
  Temporal、Task 与 Billing 账本处理；Codex Turn 生命周期不得再次包装进 Temporal。异步任务
  完成后的产品 View 和后续唤醒由后续 Session Manager 接回，而不是让模型轮询文件 status。
- **CRR-11 — UI、本地化与审批保持产品所有权。** 浏览器只连接 Wao API/SSE，不直连
  app-server。app-server 的通知和 server request 由 RuntimeAdapter 投影为现有 UI 可消费的
  token/Item/审批卡；用户可见输出必须注入当前 locale。Codex 命令审批与 Wao 预算/计费审批在
  UI 上可以统一呈现，但权威条件不得合并或互相绕过。
- **CRR-12 — 切换只能一次完成。** Stage 0/1 允许隔离新实现与旧生产实现并存，但任何请求
  只能命中其中一个 owner。进入产品切换后必须排空旧 Turn、迁移 View/恢复所需事实、一次切换
  route，并删除 Agents SDK Turn runner、Temporal Thread Coordinator 及其 fallback；禁止按失败
  自动回退旧 Agent。

## 事实与写入者

| 事实 | Stage 0 owner | 生产目标 owner |
| --- | --- | --- |
| Codex 进程与 JSON-RPC pending request | `LocalRuntimeManager` + `CodexAppServerClient` | Runtime Session Manager + RuntimeAdapter |
| Codex rollout/session blob | Codex app-server | Codex app-server，Wao 只保存 opaque 定位/恢复引用 |
| 用户可见对话与审批 View | 现有 MySQL owner，Stage 0 不写 | Wao MySQL View projector |
| 创作文本目录 | 单 S3 workspace bundle | 单 S3 workspace bundle writer |
| Operation schema/effect | 现有 Operation Registry | 现有 Operation Registry |
| 收费执行、Task、Billing、Artifact | Stage 0 禁止执行 | 现有 invocation/Temporal/Billing/Resource owner |
| Canvas | 现有 Canvas View | 工作区与正式 Resource/Task 事实的只读投影 |

## 生命周期

```text
load S3 bundle → materialize empty authoring dir → start app-server
→ initialize → thread/start or thread/resume → turn/start
→ notifications/server requests projected by Wao → completed/interrupted
→ capture canonical text bundle → S3 write + read-after-error verification
→ stop app-server → destroy temporary runtime directory
```

S3 PUT 抛错后，只能 GET 同一 key 并比较 canonical bytes 与 SHA-256：相同视为已提交；不同是
冲突；不存在是失败。Stage 0 没有 baseRevision，因为同一项目只有一个 writer；如果未来允许
第二 writer，必须先引入唯一并发裁判，不能继续依赖覆盖顺序。

## 阶段边界

1. **Stage 0：** 本地 app-server、RuntimeAdapter、no-effect MCP、bundle 往返、真实模型 Turn
   与跨进程 resume。无 route、DB、UI、Docker 生产接入。
2. **Stage 1：** 外层容器与唯一 Session Manager；验证 tenant/resource/network 隔离、Manager
   崩溃、空闲停止和重新放置。
3. **Stage 2：** MySQL View/SSE/审批卡接入；MCP executor 复用现有 invocation，稳定
   `turnId + callId` 进入计费/Task owner；补齐 locale 注入。
4. **Stage 3：** Workspace/Canvas 投影接入和 Temporal Task 完成唤醒；运行真实创作样片。
5. **Cutover：** 排空、一次切换并删除旧 Agent runtime 与 Thread Coordinator，不保留双轨。

## Stage 0 验证与盲区

- `npm run runtime:codex:smoke`：无模型费用地验证目录 canonical 往返、MCP schema/list/call、
  app-server initialize 和 Thread start/read。
- `npm run runtime:codex:smoke -- --live-turn`：以真实 `gpt-5.6-sol` Turn 验证流式文本、完成
  通知、app-server 停止后新进程 resume。
- `npm run typecheck`、targeted ESLint 与 `npm run architecture:impact -- --changed` 验证类型、
  静态纪律和架构映射。
- 未验证：目标部署 S3 的真实 PUT outcome-unknown、外层容器租户隔离、Manager 崩溃重连、
  active Turn interrupt/steer、Codex server-request 审批、真实收费 MCP、MySQL View/UI、
  Temporal 完成唤醒和旧系统切换删除。因此当前只能称 Stage 0 实现完成。
