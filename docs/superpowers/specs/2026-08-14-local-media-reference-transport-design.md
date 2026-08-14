# 本地媒体引用传输修复设计

日期：2026-08-14
状态：已获用户批准

## 背景

Waoowaoo 只在本机运行。Next.js、Temporal Worker、MinIO、Codex 图片运行时和 ComfyUI 都属于同一台机器上的受控本地系统。当前媒体入口已经按 `userId + projectId + resourceId + contentVersion` 校验资源所有权，并由存储层签发绝对 MinIO URL。

现有 Provider Gateway 仍要求所有图片和视频引用使用 HTTPS。开发环境的 MinIO 签名地址是 `http://127.0.0.1:19000/...`，因此合法的本地资源会在 Codex 适配器执行 owner-aware、有界字节物化之前被拒绝，产生 `PROVIDER_MEDIA_REFERENCE_HTTPS_REQUIRED`。

## 目标

- 让本地 MinIO 的绝对 HTTP 签名 URL 成为合法媒体传输引用。
- 图片和视频使用同一套本地媒体 URL 校验。
- 保留资源所有权、固定版本、大小、MIME 类型和内容完整性校验。
- 保留 Codex 适配器在 provider fence 之前通过 Storage SDK 读取图片并物化为本地临时文件的路径。
- 继续显式拒绝相对路径、Data URL、非 HTTP(S) scheme、空值和内嵌用户名或密码。
- 从用户真实触发点验证：Chrome 上传参考图后，助手能够登记资源并提交实际图片生成任务。

## 非目标

- 不配置公网域名、TLS、反向代理或外部对象存储。
- 不新增外部 provider 兼容分支、自动降级或第二套媒体协议。
- 不把 Base64 变成跨 provider 的通用输入协议。
- 不修改资源 identity、版本、Task 生命周期、provider fence 或持久化 writer。
- 不自动重放已经标记为失败且 `taskReplay: forbidden` 的旧任务；验证使用新的明确请求。

## 方案比较

### 方案 A：本地绝对 HTTP(S) URL 契约（采用）

Gateway 只验证 URL 是无嵌入凭据的绝对 `http:` 或 `https:` URL，不再要求 HTTPS。owner-aware 资源投影仍是唯一上游入口，Codex 继续在适配器内部将已授权引用转成本地文件。

优点：符合仅本地部署事实；复用现有唯一投影链；同时支持本机 MinIO、Codex 和 ComfyUI；不削弱资源所有权边界。

### 方案 B：完全删除媒体 URL 校验（拒绝）

实现最少，但会让相对路径、Data URL、`file:` URL和嵌入凭据进入 Gateway，错误位置更晚且协议不完整。

### 方案 C：仅为 Codex 跳过 HTTPS 校验（拒绝）

能修复当前图片，但会保留“通用 HTTPS 规则 + provider 特例”双轨；本地 ComfyUI 和后续本地媒体能力仍可能再次遇到同一问题。

## 权威入口与数据流

1. 上传图片由聊天附件入口验证 token、用户、项目、媒体类型、大小和内容摘要。
2. 助手通过现有 Operation 把上传附件登记为固定版本的 `WorkspaceResource`。
3. 图片生成 Task 通过 `resolveWorkspaceResourceInputMedia` 解析 `resourceId + contentVersion`，不得使用路径或最近记录猜归属。
4. `resolveOwnedImageUrlForGeneration` 进行 owner-aware 读取授权、对象元数据和 MIME/大小校验，然后签发本地绝对 MinIO URL。
5. Provider Gateway 对图片和视频引用执行统一的“绝对 HTTP(S)、无嵌入凭据”传输校验。
6. Codex 图片适配器在 provider fence 之前重新解析该已授权存储引用，经 Storage SDK 有界读取字节、检测 MIME，并物化为临时图片文件；准备失败不得触发 provider 提交。
7. 其他本地 adapter 消费同一绝对本地 URL，不建立第二套 URL 解释或外部 HTTPS 分支。

## 代码边界

- `src/lib/ai-exec/media-references.ts`
  - 将 HTTPS-only 判定收敛为绝对 HTTP(S) URL 判定。
  - 错误必须继续区分空值/无效 URL、scheme 不支持和内嵌凭据。
- `src/lib/ai-exec/engine.ts`
  - 继续在 provider fence 前调用唯一媒体引用校验，不添加 provider 名称分支。
- `src/lib/ai-providers/codex/image.ts`
  - 继续使用现有 owner-aware、有界本地物化，不新增网络下载旁路。
- `docs/architecture/modules/provider-gateway.md`
  - 更新 PG-17 的本地绝对签名 URL表述，并记录上一版只新增 adapter prepare、却未移除 Gateway HTTPS 旧裁判导致换形式复发。

## 错误处理

- 相对路径、Data URL、`file:` 或其他 scheme：在 provider fence 前明确失败。
- URL 中包含用户名或密码：在 provider fence 前明确失败。
- 本地资源无权读取、版本不匹配、对象缺失、超限或 MIME 不支持：由 owner-aware 媒体入口明确失败。
- Codex 本地字节准备失败：不 claim provider fence，不创建 provider 工作。
- 已经失败的历史 Task 保持失败事实，不修改、不删除、不自动重放。

## 验证

1. 先增加独立纯逻辑用例，证明：
   - `http://127.0.0.1:19000/...` 和合法 HTTPS URL 通过；
   - 相对路径、Data URL、`file:` URL 与嵌入凭据被拒绝。
2. 观察用例在生产修改前因 HTTP 被拒绝而失败。
3. 实施最小代码修改，使该用例通过。
4. 运行目标 ESLint、TypeScript typecheck 和相关媒体契约检查。
5. 重启本地 Next.js/Temporal 服务，确认加载新代码。
6. 从 Chrome 使用同一参考图发送新的重试请求；确认：
   - 聊天 Turn 正常完成；
   - 上传资源为 `ready`；
   - 新图片 Task 不再出现 HTTPS-required 错误；
   - provider 接受参考图并生成新资源，最终资源达到 `ready`。

## 状态与入口数量

- 修改前后，资源 writer、Task writer、provider 提交入口和生命周期解释者数量均不变。
- 删除一个过时的 HTTPS-only 状态裁判；不新增兼容层、fallback、timer 或第二协议。
- 仍然只有 owner-aware 媒体投影入口决定私有资源能否进入生成链路。
