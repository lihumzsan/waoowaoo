# 自托管快速开始

本文区分两条路径：本地评估使用源码挂载的 Docker 开发环境；长期运行使用不可变镜像和受保护的
Temporal Worker 发布流程。两者都使用同一套 MySQL、Redis、Temporal、S3 和 Codex Runtime 边界。

## 1. 前置要求

- Docker Engine 或 Docker Desktop，支持 Compose v2。
- 本地评估需要 Node.js 22 和 npm。
- 至少 4 核 CPU、8 GB 内存、20 GB 可用磁盘。
- 一个预先创建、可通过公网 HTTPS 访问的 S3-compatible bucket。
- 能够访问你计划配置的 AI Provider。

确认工具：

```bash
docker version
docker compose version
node --version
npm --version
```

## 2. 本地 Docker 评估

```bash
git clone https://github.com/waooAI/waoowaoo.git
cd waoowaoo
sh scripts/self-hosted/prepare-env.sh
```

脚本会生成数据库、Redis、Temporal、认证和 Provider Key 加密密钥，不会覆盖已有 `.env`。随后编辑
`.env`，填写：

```dotenv
S3_ENDPOINT=https://s3.example.com
S3_UPLOAD_ENDPOINT=https://s3.example.com
S3_REGION=us-east-1
S3_BUCKET=your-bucket
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_FORCE_PATH_STYLE=false
```

安装本地启动依赖并运行：

```bash
npm install
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。这个命令会构建并启动 Docker 中的 Web、MySQL、
Redis、Temporal、开发 Worker 和 Codex Runtime；退出命令会停止前台开发进程，但不会删除持久卷。

## 3. 在网页中配置模型

登录后打开 **设置 → API 配置**，添加自己的 Provider Key，并为 Assistant、分析、图片、视频、声音和
音乐角色选择模型。自托管部署不会读取官方平台模型密钥，也不会在缺失模型配置时静默降级。

## 4. 生产式自托管

生产 Compose 不从源码隐式构建应用，而要求两个发布镜像：

- `ghcr.io/waooai/waoowaoo@sha256:<digest>`：Web 与 Temporal Worker 共用的应用镜像。
- `ghcr.io/waooai/waoowaoo-codex-runtime@sha256:<digest>`：隔离的创作 Agent Runtime。

从 Release 说明或你自己的 registry 获取真实 digest，替换 `.env` 中所有全零占位符。首次安装时，
blue 和 green Worker 可以先指向同一个应用 digest，但只有 blue 的副本数为 1：

```dotenv
APP_IMAGE=ghcr.io/waooai/waoowaoo@sha256:<app-digest>
CODEX_RUNTIME_IMAGE=ghcr.io/waooai/waoowaoo-codex-runtime@sha256:<runtime-digest>
TEMPORAL_WORKER_BLUE_IMAGE=ghcr.io/waooai/waoowaoo@sha256:<app-digest>
TEMPORAL_WORKER_BLUE_BUILD_ID=<release-build-id>
TEMPORAL_WORKER_BLUE_REPLICAS=1
TEMPORAL_WORKER_GREEN_IMAGE=ghcr.io/waooai/waoowaoo@sha256:<app-digest>
TEMPORAL_WORKER_GREEN_REPLICAS=0
NEXTAUTH_URL=http://localhost:13000
```

先检查 Compose，再通过唯一 rollout 入口建立首个 Current Worker Version：

```bash
docker compose config --quiet
sh scripts/temporal/worker-rollout.sh bootstrap blue
docker compose up -d
docker compose ps
```

访问 [http://localhost:13000](http://localhost:13000)。若对公网开放，请先在反向代理配置 HTTPS、请求体
大小、长连接和访问控制，再把 `NEXTAUTH_URL` 改成最终 HTTPS 地址。

## 5. 常用命令

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f temporal-worker-blue
docker compose --profile temporal-ui up -d temporal-ui
docker compose stop
```

不要使用 `docker compose down -v`，除非你明确要删除数据库和持久卷。升级不要直接替换唯一 Worker，
请遵循[升级、备份与恢复](upgrades.md)。
