# 故障排查

## 先收集安全信息

```bash
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=200 temporal-worker-blue
docker compose logs --tail=200 temporal
```

公开反馈前删除 API Key、签名 URL、用户内容、Cookie、数据库连接串和内部地址。保留页面参考编号、稳定
错误代码、发生时间、应用版本和 Worker Build ID。

## 页面显示 404

- 确认访问的是带 locale 的有效页面，首页应自动进入默认语言。
- 确认反向代理没有剥离路径或 locale 前缀。
- 运行生产构建确认预渲染边界正常：`npm run build`。
- 检查 `NEXTAUTH_URL` 是否与实际浏览器 origin 一致。

## `PROVIDER_AUTH_INVALID`

在 **设置 → API 配置** 重新检查 API Key、Base URL 和账户状态。不要把 Key 发到 Issue。自托管模式下
凭据属于当前用户；部署级平台 Key 不会成为 fallback。

## `serverOverloaded`

所选模型当前容量不足。稍后重试，或由用户明确选择另一个模型。应用不会在后台自动换模型。

## `UND_ERR_CONNECT_TIMEOUT`

检查容器的 DNS、代理、证书和出站网络，以及 Provider endpoint 是否从容器内可达。连接超时不等于
Provider 一定没有收到请求；以页面显示的提交阶段和错误代码为准。

## `PROVIDER_SUBMISSION_OUTCOME_UNKNOWN`

请求可能已经到达 Provider，但本地没有收到确定回执。先在 Provider 控制台核对任务和账单，再决定
是否由用户重新提交。系统故意不自动重发此类昂贵任务。

## Provider Key 无法解密

确认部署使用创建这些记录时的同一个 `API_ENCRYPTION_KEY`。如果密钥已丢失，无法恢复旧 Key；必须由
各用户重新填写。不要随意轮换该变量。

## Docker 启动被拒绝

- 全零镜像 digest：替换 `APP_IMAGE`、两个 Worker image 和 `CODEX_RUNTIME_IMAGE`。
- `CODEX_RUNTIME_HOST_ROOT`：必须是绝对、持久且非系统根目录的路径。
- Docker socket：Web 容器需要访问受控 Docker daemon 来创建隔离 Runtime。
- Worker Current Version 缺失：先执行 `worker-rollout.sh bootstrap blue`。
- S3 初始化失败：检查 endpoint、bucket、权限和 HTTPS 可达性。

## 本地生成停在授权后、没有创建 Task

运行 `npm run dev` 时，Web 只有在开发 Worker 的版本化 workflow/activity poller 均上线，并把本地
Build ID 设为 Current Version 后才会启动。若启动失败，检查：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs temporal-worker-dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs temporal-dev-route
```

不要重复点击授权、删除 Temporal 持久卷或重新提交已经获批的媒体任务。修复 Worker 启动错误后重新运行
`npm run dev`，原 workflow 会以稳定 identity 继续执行。若同一 Temporal namespace 曾用于正式版本化
Worker，请改用独立 namespace，不要让开发初始化入口修改正式路由。

## 获得帮助

确认没有敏感信息后，在 [GitHub Issues](https://github.com/waooAI/waoowaoo/issues) 提交最小复现、版本、
错误代码和参考编号。安全问题使用 [`SECURITY.md`](../../SECURITY.md) 中的私密渠道。
