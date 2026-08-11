<p align="center">
  <img src="public/banner.png" alt="waoowaoo" width="640">
</p>

<h1 align="center">waoowaoo AI 影视 Studio</h1>

<p align="center">
  面向 AI 影视生产的自托管创作工作区：从故事与剧本出发，完成创意方向、视觉资产、视频分段与声音设计。
</p>

<p align="center">
  <a href="README_en.md">English</a> ·
  <a href="https://www.waoowaoo.com/">在线体验</a> ·
  <a href="https://github.com/waooAI/waoowaoo/issues">问题反馈</a>
</p>

<p align="center">
  <a href="https://github.com/waooAI/waoowaoo/actions/workflows/verify.yml"><img alt="Verify" src="https://github.com/waooAI/waoowaoo/actions/workflows/verify.yml/badge.svg"></a>
  <a href="https://github.com/waooAI/waoowaoo/pkgs/container/waoowaoo"><img alt="Container" src="https://img.shields.io/badge/container-ghcr.io-blue"></a>
</p>

> [!IMPORTANT]
> 当前自托管版本处于 **Developer Preview**。推荐全新安装和受控网络部署，不建议直接用于公网多租户生产环境。
> 模型效果、费用、并发和可用性由你配置的第三方 AI Provider 决定。

## waoowaoo 能做什么

- **剧本与故事结构**：从故事文本形成可继续制作的结构化剧本。
- **创意方向**：统一视觉风格、色彩、材质、镜头和声音方向。
- **视觉资产**：管理角色、场景、道具和跨镜头复用素材。
- **图片与视频生成**：调用配置的模型生成图片、编辑图片并制作视频分段。
- **声音设计**：在模型能力支持时生成对白、声音或音乐资源。
- **可视化工作区**：在资源画布中检查生成结果、依赖关系和任务状态。
- **持久任务执行**：使用 Temporal 管理耗时生成任务、恢复和终态交付。
- **自带模型配置中心**：每个用户在网页中配置自己的 Provider API Key 和模型。

> 各项能力取决于具体 Provider 和模型。并非所有 Provider 都同时支持文字、图片、视频、声音和音乐。

## 运行架构

```text
浏览器
  │
  ▼
waoowaoo Web ───────────────► 用户配置的 AI Provider
  │                                  ▲
  ├── MySQL：项目与任务事实          │
  ├── Redis：即时传输与缓存          │
  ├── Temporal：持久任务与恢复 ──────┘
  ├── S3：图片、视频和音频对象
  └── Codex Runtime：按项目隔离的创作 Agent
```

应用、MySQL、Redis、Temporal、Worker 和 Codex Runtime 均通过 Docker 运行。媒体对象使用外部
S3-compatible 存储，因为第三方生成服务需要访问 HTTPS 素材地址。

## 本地快速体验

### 前置要求

- Docker Engine 或 Docker Desktop，支持 Docker Compose v2。
- Node.js 22 和 npm。
- 4 核 CPU、8 GB 内存和至少 20 GB 可用磁盘；建议 8 核、16 GB 内存。
- 一个预先创建、可通过公网 HTTPS 访问的 S3-compatible bucket。

### 启动

```bash
git clone https://github.com/waooAI/waoowaoo.git
cd waoowaoo

# 生成本地数据库、Redis、认证和加密密钥；不会覆盖已有 .env。
sh scripts/self-hosted/prepare-env.sh

# 编辑 .env，至少填写 S3_ENDPOINT、S3_UPLOAD_ENDPOINT、S3_BUCKET、
# S3_ACCESS_KEY_ID 和 S3_SECRET_ACCESS_KEY。

npm install
npm run dev
```

启动后访问 [http://localhost:3000](http://localhost:3000)。`npm run dev` 使用
`docker-compose.yml` 与 `docker-compose.dev.yml` 启动完整本地依赖和容器化开发环境。

> [!CAUTION]
> 不要执行 `docker compose down -v`。`-v` 会删除数据库和其他持久卷。

生产式自托管要求使用不可变应用镜像和 Codex Runtime 镜像，并通过受保护的 Temporal Worker
蓝绿入口发布。请阅读[自托管快速开始](docs/self-hosted/quickstart.md)，不要直接照搬开发命令上线。

## 首次进入网页

1. 注册本地账户并登录。
2. 打开 **设置 → API 配置**。
3. 添加你自己的 Provider API Key。
4. 为 Assistant、分析、图片、视频、声音和音乐角色选择可用模型。
5. 使用配置页面的连接测试确认凭据和 endpoint 正常。
6. 创建项目并开始第一轮制作。

自托管模式固定使用 `DEPLOYMENT_EDITION=self-hosted` 与
`PROVIDER_CREDENTIAL_MODE=user-key`，不会内置官方平台模型密钥。Provider Key 写入数据库前使用
`API_ENCRYPTION_KEY` 加密；请备份 `.env`，丢失该密钥后已有 Provider Key 无法解密。

## 常见错误

| 错误代码 | 含义 | 优先检查 |
|---|---|---|
| `PROVIDER_AUTH_INVALID` | Provider 凭据无效 | API Key、Base URL、账户状态 |
| `serverOverloaded` | 当前模型容量不足 | Provider 状态、模型容量、稍后重试 |
| `UND_ERR_CONNECT_TIMEOUT` | 无法及时建立出站连接 | 本机网络、代理、DNS、Provider endpoint |
| `PROVIDER_SUBMISSION_OUTCOME_UNKNOWN` | 提交后没有确定回执 | 先核对 Provider 侧任务，避免重复计费 |
| `API_ENCRYPTION_KEY` 相关错误 | 无法加密或解密用户 Key | `.env`、密钥是否被替换或丢失 |

系统不会自动重发 `PROVIDER_SUBMISSION_OUTCOME_UNKNOWN` 类型的昂贵媒体任务，因为远端可能已经收到请求。
更多排障方法见[故障排查](docs/self-hosted/troubleshooting.md)。

## 数据与隐私

- 项目、任务和用户配置保存在你的 MySQL 中。
- 图片、视频和音频保存在你配置的 S3 bucket 中。
- 生成请求会按用户选择发送给对应的第三方 AI Provider。
- Provider 的数据保留、内容审核和费用规则由其自身条款决定。
- 公开部署前，请自行配置 HTTPS、访问控制、备份和网络边界。

## 已知限制

- 当前版本是 Developer Preview，推荐先用于本地或受控网络环境。
- 外部 Provider 可能出现容量不足、网络超时、限流或内容审核失败。
- 第三方 OpenAI-compatible API 不保证兼容所有异步图片、视频和音频协议。
- 长时间 Assistant 会话可能消耗较大的模型上下文。
- 本版本要求外部 S3-compatible 对象存储。

## 文档

- [自托管快速开始](docs/self-hosted/quickstart.md)
- [环境变量与基础设施](docs/self-hosted/configuration.md)
- [Provider 与模型配置](docs/self-hosted/providers.md)
- [对象存储](docs/self-hosted/storage.md)
- [升级、备份与恢复](docs/self-hosted/upgrades.md)
- [故障排查](docs/self-hosted/troubleshooting.md)
- [系统架构](docs/self-hosted/architecture.md)

## 安全与贡献

请不要通过公开 Issue 提交漏洞利用细节、真实凭据或用户数据。安全问题请按照
[`SECURITY.md`](SECURITY.md) 中的私密渠道报告。欢迎提交 Bug、功能建议和 Pull Request；开始前请阅读
[`CONTRIBUTING.md`](CONTRIBUTING.md) 和项目架构约束。

## 许可证

本项目代码按照 [`AGPL-3.0-only`](LICENSE) 授权。通过网络向用户提供修改后的版本时，请特别留意
AGPL 第 13 条对应的源码提供义务。waoowaoo 名称、Logo 和品牌素材不因代码许可证自动获得商标授权，
详见 [`TRADEMARKS.md`](TRADEMARKS.md)。

---

<p align="center">Made with ❤️ by the waoowaoo team</p>
