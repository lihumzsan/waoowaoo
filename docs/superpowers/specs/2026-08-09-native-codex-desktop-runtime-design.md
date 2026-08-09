# 原生 Codex 桌面账号运行时设计

## 决策与范围

本机所有 Wao 项目共用当前 Windows 用户已登录的 Codex Desktop/CLI 账号。Codex 是唯一的文本、助手和图片 Provider；本阶段不接入 ComfyUI，也不恢复 OpenRouter。

该决定只覆盖可信任的本机 `local` Runtime。云端或 Docker Runtime 不得挂载、复制或读取桌面 Codex Home；它们在本阶段必须显式失败，而不是回退到其他模型 Provider。

本设计解决截图中首条助手命令即显示“参数错误”的根因：Wao 将原生 Codex 调用伪装成自定义 Responses Provider，而该网关只接受 OpenRouter。原生 Codex App Server 不再经过这个协议转换层。

## 已确认事实

- Codex 官方将 `CODEX_HOME` 定义为 CLI、IDE extension 和 app-server 共用的状态根，其中包含 config、auth、logs、sessions、skills 和 standalone package metadata；没有公开的“只指定认证文件”配置。[Environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)
- 官方建议深度集成使用 app-server；它负责认证、对话历史、审批和流式 Agent 事件。[Codex App Server](https://learn.chatgpt.com/docs/app-server)
- 因此，保留桌面自动登录的受支持方式是让本机 App Server 使用当前用户的原生 Codex Home。将 `auth.json` 复制、链接到项目目录，或从该目录抽取并缓存 token，都不在本设计内。
- 当前代码把每个 `(userId, projectId)` 的 `codex-homes/<scopeHash>` 同时当作认证根和原生状态根；`runtime-access.ts` 又创建名为 `wao-runtime` 的 Responses Provider，`codex-model-gateway` 最终只允许 OpenRouter。这两条链路与上述目标冲突。
- 当前安装的 Codex CLI 为 0.147，而产品协议常量仍钉在 0.146；根据 CRR-09，这必须作为一次显式协议升级验证，不能通过放宽 parser 或伪造版本跳过。

## 目标与非目标

目标：

- 助手、普通文本和图片生成都使用当前桌面账号的原生 Codex CLI/App Server。
- 首条助手命令直接建立原生 Thread，不再请求 Wao 内部 `/responses` 或 `/alpha/search` 网关。
- Wao 的产品 Thread、Turn、审批、计费、资源和 Project View 继续严格按 `(userId, projectId)` 归属。
- 不复制、不提交、不展示或删除桌面认证材料。
- 失败时返回可定位的原生 Codex 配置/登录/协议错误，绝不回退 OpenRouter 或另一家 Provider。

非目标：

- 不接入 ComfyUI、视频、音频或语音工作流。
- 不清理既有 `codex-homes` 目录或用户桌面 Codex 的历史、插件、技能、配置和登录信息；任何存量数据清理须另获授权。
- 不支持云端/Docker 使用桌面 ChatGPT 登录，也不引入 token 代理、credential broker 或 API-key 兼容层。
- 不改变 Wao MCP 的项目级 bearer、审批和资源写入边界。

## 采用的架构

```text
Wao 项目命令
  -> Wao AssistantRuntime / Session Manager（唯一项目生命周期裁判）
  -> 本机 Codex App Server（当前 Windows 用户的原生 CODEX_HOME）
  -> Codex/ChatGPT 原生认证与模型服务

Wao 产品 View / Resource / 审批 / 计费
  <- Wao projector 与 MCP（仍按 userId + projectId 隔离）

普通文本、图片 Operation
  -> 原生 codex exec（同一桌面 CODEX_HOME）
```

### 唯一 owner 与 writer

| 事实 | 唯一 owner / writer | 消费者 | 不允许的替代来源 |
| --- | --- | --- | --- |
| 桌面 Codex 登录、原生配置、原生历史 | 当前 Windows 用户的 Codex Home 与 Codex 自身 | 本机 CLI、IDE、Wao local App Server | Wao 数据库、项目目录、复制的 auth 文件、OpenRouter key |
| Wao 项目 Thread/Turn/View/审批/资源 | Wao 的既有持久化与 projector | UI、MCP、Session Manager | Codex session 文件、模型输出、工作区路径 |
| 项目临时 workspace 与 Wao runtime skills | `AssistantRuntimePersistence` 为当前 placement 创建的临时目录 | 当前 App Server | Desktop `CODEX_HOME` |
| 一次模型采样、流和重试 | 当前 native App Server 的 Runtime adapter | Wao Session Manager | `codex-model-gateway`、第二个 provider retry |

变更后，认证与原生状态 writer 为 1（Codex），产品事实 writer 为 1（Wao），模型执行入口为 1（native App Server）。现有 Responses 网关和其 OpenRouter 凭据选择器删除，writer 数量为 0。

### Home、项目隔离与清理语义

本机 child process 不再把 `CODEX_HOME` 改写为 `codex-homes/<scopeHash>`；它使用当前 Windows 用户的默认 Codex Home（或用户显式设置的标准 `CODEX_HOME`）。Wao 不应将实际用户目录硬编码到源码或 `.env.example`。

这意味着原生 Codex 的 session、日志、已安装插件和用户级配置在该 Windows 账号下共享。这是用户已选择“自动使用当前桌面登录”的直接后果；Wao 不把这些原生记录投影为产品数据，也不按目录枚举、读取或向其他项目展示。产品可见隔离继续依赖 Wao 的 canonical `(userId, projectId)`、native thread id 映射和 Project/Turn 锁。

每次 placement 仍创建唯一的可销毁 workspace，并只在其中生成 `.agents/skills`。`materializeCreativeRuntimeConfiguration` 不得再创建、删除或覆盖 Desktop Home 下的 `AGENTS.md`、`config.toml` 或 `skills/**`。用户执行项目 clear 时，只清理 Wao 已定义的项目事实和该 placement 的临时 workspace；不得删除共享 Desktop Home，也不得用 Wao View 重建原生模型历史。

Wao 传给 thread start/resume 的运行时 config 必须显式声明 Wao MCP、Wao 自己的 approval 规则、禁用的原生 skills 和所需功能。实现必须通过真实 `skills/list` 与 MCP inventory 验证这些一次性 override 生效，不能假设用户 Home 中的插件配置天然安全或已被覆盖。

### 模型和调用协议

- 助手模型固定解析为已注册的 `codex::gpt-5.5`（运行时模型 `gpt-5.5`），并在 `thread/start` 与 `thread/resume` 直接传递 model；不传 `modelProvider`，不注入 `model_providers`。
- 助手模型选择不再读取 OpenRouter provider 配置或 API key。若历史用户配置仍指向其他 Provider，产品配置层必须以明确的“助手仅支持原生 Codex”错误拒绝，而不是将它变成 Responses 上游。
- `CODEX_RUNTIME_WAO_BASE_URL` 和项目 bearer 仅继续用于 Wao MCP。bearer 绝不再作为模型 Provider credential，也不再发往内部 model/search route。
- 原生 Codex 的 web search 由 App Server 自己执行；删除 `standalone_web_search` 对 Wao `/alpha/search` 的依赖。
- 直接文本与图片 Operation 继续使用已有 `codex exec` adapter，并与 App Server 复用同一可执行文件解析器，避免 WindowsApps shim 的 `EPERM` 启动错误。

### Driver 与并发边界

`local` 是此设计唯一允许的 driver。选择 `docker` 时，配置读取必须原地报出“desktop-native Codex account requires local driver”；严禁把 Desktop Home bind-mount 进容器、复制认证，或悄悄选择 OpenRouter。

同一 `(userId, projectId)` 仍最多一个活跃 Runtime 和一个活跃 Turn，沿用现有 Session Manager ownership。不同项目允许拥有不同的 Wao placements，但它们会共享同一个原生 Home；上线前必须用两个并发 App Server、两个不同 project scope 的真实 native Thread 验证 Codex Home 的锁、session 落盘和 resume 不会交叉。若该验证不通过，实施必须停在验证阶段并重新设计为显式的单 App Server 多线程协调；不得在调用方新增 timer、复制 Home 或跨项目复用 Wao Thread。

## 完整入口、删除项与迁移

| 触点 | 变更 | 验证 |
| --- | --- | --- |
| `src/lib/assistant-runtime/runtime-access.ts` | 删除 Wao Responses Provider、gateway 解析和 OpenRouter 模型选择；构造原生 Codex thread config | start/resume 参数断言与 App Server smoke |
| `src/lib/codex-runtime/app-server-client.ts` | 使用 `resolveCodexExecutablePath()` 而不是 `codex` shim；同步 0.147 协议 parser 与 pinned 版本 | real binary initialize + schema smoke |
| `src/lib/assistant-runtime/runtime-persistence.ts` | 保留临时 workspace，取消 per-scope Codex Home 创建与 clear 删除 | materialization / clear 验证不触碰 Desktop Home |
| `src/lib/creative-skills/runtime-skills.ts` | 只生成 workspace skill；不写或删 Codex Home 配置和 skills | `skills/list` 只暴露期望 Wao skills |
| `src/lib/codex-runtime/{runtime-container,local-process-runtime-container}.ts` | 移除 per-scope home 传递与 `CODEX_HOME` 覆盖；仅 local 可用 | child env 与 login smoke |
| `src/lib/codex-runtime/{docker-runtime-container,runtime-config}.ts` | 禁止 desktop-native 模式使用 Docker | 配置失败测试 |
| `src/lib/codex-model-gateway/**` | 整体删除 | 无生产 import / 无 internal route |
| `src/app/api/internal/codex-runtime/model/**` | 删除 Responses 与 standalone-search route | route/import 搜索为零 |
| `scripts/codex-gateway-error-smoke.ts` | 删除；其 oracle 属于将被删除的网关 | scripts 引用为零 |
| `scripts/codex-runtime-smoke.ts` 和相关 container smoke | 改为原生登录/协议、workspace 和无网关断言 | 目标 smoke 通过 |
| `src/app/api/projects/[projectId]/assistant/command-http.ts` | 删除 gateway 专用错误映射，新增原生登录、driver 和协议错误投影 | 首条命令错误可读且可定位 |

旧的 per-scope `codex-homes` 目录不在迁移中删除；它们失去执行语义但保留在磁盘上，直到用户单独授权清理。不存在双轨：新的运行不会读取、写入或恢复这些目录。

## 生命周期、失败与恢复

1. 正常 start：Wao 取得项目 ownership，创建临时 workspace 和 Wao skills，启动 local App Server；App Server 从 Desktop Home 读取原生登录，Wao 创建或 resume canonical native Thread。
2. 首次命令：Wao 的 command arbiter 在同一 Project transition 内持久化命令身份、建立/绑定 native thread、再启动 Turn。模型网络错误只属于该 native attempt；Wao 不提前写最终失败。
3. cancel / clear：先终止当前 runtime，等待 Turn 结算，再销毁 workspace。clear 不删除 Desktop Home、不清理其他项目、不用产品消息重建 Codex history。
4. idle / restart：可销毁 workspace 和 child process；native history由 Codex 持久化。Wao 仅凭已绑定的 native thread id resume，不能扫描或猜测 Desktop Home 中的 session。
5. 登录缺失、过期或账号不可用：映射为明确的 `ASSISTANT_RUNTIME_CODEX_LOGIN_REQUIRED` 或 native auth error，提示在当前 Windows 用户下登录 Codex；不降级。
6. 0.147 protocol 不兼容：原地失败并标识 `ASSISTANT_RUNTIME_CODEX_PROTOCOL_UNSUPPORTED`；升级前排空活跃 Turn，绝不通过忽略新字段继续运行。
7. 共享 Home 并发冲突：保留项目 Turn 的真实失败/恢复语义；不得将重试转移至网关或第二个 Runtime。若并发 prerequisite 未满足，停止 rollout。

## 实施前治理检查

- 权威执行入口由 `AssistantRuntime -> RuntimeSessionManager -> native App Server` 保持唯一；删除 `AssistantRuntime -> Wao Responses Gateway -> OpenRouter` 旁路。
- 权威认证 owner 从“每项目 pseudo-home + provider key”收敛为“当前 Windows 用户的原生 Codex Home”一个来源；Wao 不成为认证 writer。
- 共享原生历史是明确接受的本地信任边界；Wao 可见产品事实不共享。任何跨项目可见性均按 Wao canonical scope 拒绝。
- Docker、API key、credential broker、auth copy/link 和 OpenRouter fallback 都是禁止范围，不留兼容分支。
- 该变更改变 Runtime credential/state ownership，实施前已运行 architecture impact 并阅读 `codex-runtime-rollout`、`assistant-run-lifecycle`、`ai-prompt-output-contract` 与 `provider-gateway` 契约；实现阶段需按本说明逐项映射修改文件。

## 验证与已知盲区

最低验证集：

1. 静态检索确认 production 中不存在 `codex-model-gateway`、内部 model route、`modelProvider` 自定义 provider 或 OpenRouter assistant gateway import。
2. TypeScript typecheck，以及只覆盖独立 oracle 的现有 runtime/protocol tests。
3. 使用实际安装的 0.147 executable 完成 initialize、thread start、thread resume、技能列表和 MCP inventory schema smoke。
4. 用已登录桌面账号从新建项目发送首条短文本命令；验证 Wao Project Turn、native Thread 绑定、流式投影和无 `参数错误`。
5. 执行一次 Codex 图片 Operation，验证生成资产经既有唯一 Resource writer 落库。
6. 启动两个不同项目的本机 runtime 并行执行最小 native Turn，验证无 Home 锁冲突、无 Thread 交叉和可 resume。
7. 验证 clear/idle/restart 不修改 Desktop Home 外的认证文件，不删除共享 Home，且不会将其它项目的 native history 显示到当前项目。

无法由离线测试证明的范围：实际 ChatGPT 账号的配额、服务端模型可用性及原生 Home 的跨进程行为。这些必须通过第 4 至 6 项受控本机真实验证确认；若不通过，交付只能报告实现完成，不能声称架构完成。
