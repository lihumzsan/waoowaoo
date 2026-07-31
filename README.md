<p align="center">
  <a href="https://www.waoowaoo.com/">
    <img src="images/cta-banner.png" alt="🚀 探索 AI 影视的下一代创作流 | 立即加入 waoowaoo 在线网页版内测候补" width="800">
  </a>
</p>

<p align="center">
  <img src="public/banner.png" alt="waoowaoo" width="600">
</p>

<h1 align="center">waoowaoo AI 影视 Studio</h1>

<p align="center">
  一款基于 AI 技术的短剧/漫画视频制作工具，支持从小说文本自动生成分镜、角色、场景，并制作成完整视频。
</p>

<p align="center">
  <a href="README_en.md">English</a> · <a href="https://www.waoowaoo.com/">加入内测候补</a> · <a href="https://github.com/saturndec/waoowaoo/issues">反馈问题</a>
</p>

> [!IMPORTANT]
> ⚠️ **测试版声明**：本项目目前处于测试初期阶段，由于暂时只有我一个人开发，存在部分 bug 和不完善之处。我们正在快速迭代更新中，**欢迎进群反馈问题和需求，及时关注项目更新！目前更新会非常频繁，后续会增加大量新功能以及优化效果，我们的目标是成为行业最强AI工具！**

<img src="https://github.com/user-attachments/assets/2b3fc495-9812-493a-8dbc-5bec4757df31" width="30%">

---
## ✨ 功能特性

- 🎬 **AI 剧本分析** — 自动解析小说，提取角色、场景、剧情
- 🎨 **角色 & 场景生成** — AI 生成一致性人物和场景图片
- 📽️ **分镜视频制作** — 自动生成分镜头并合成视频
- 🎙️ **AI 配音** — 多角色语音合成
- 🌐 **多语言支持** — 中文 / 英文界面，右上角一键切换

---

## 🚀 快速开始

**前提条件**：安装 [Docker Desktop](https://docs.docker.com/get-docker/)

### 方式一：拉取预构建镜像（最简单）

无需克隆仓库，下载即用：

```bash
# 下载 docker-compose.yml
curl -O https://raw.githubusercontent.com/saturndec/waoowaoo/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/saturndec/waoowaoo/main/.env.example
cp .env.example .env

# 编辑 .env：为所有空白密钥生成独立随机值，并让 MYSQL_PASSWORD、
# DATABASE_URL 与 COMPOSE_DATABASE_URL 中的密码保持一致（URL 中需编码特殊字符）。
# 另外填写一个预先创建、可通过公网 HTTPS 访问的 S3-compatible 存储桶。

# 启动所有服务
docker compose up -d
```

> ⚠️ 当前为测试版，版本间数据库不兼容。升级请先清除旧数据：

```bash
docker compose down -v
docker rmi ghcr.io/saturndec/waoowaoo:latest
curl -O https://raw.githubusercontent.com/saturndec/waoowaoo/main/docker-compose.yml
docker compose up -d
```

> 启动后请**清空浏览器缓存**并重新登录，避免旧版本缓存导致异常。

### 方式二：克隆仓库 + Docker 构建（完全控制）

```bash
git clone https://github.com/saturndec/waoowaoo.git
cd waoowaoo
cp .env.example .env
# 按上面的说明填写 .env；Compose 会在必需密钥缺失时拒绝启动
docker compose up -d
```

更新版本：
```bash
git pull
docker compose down && docker compose up -d --build
```

### 方式三：本地开发模式（开发者）

```bash
git clone https://github.com/saturndec/waoowaoo.git
cd waoowaoo

# 复制环境变量配置文件（必须在 npm install 之前完成）
cp .env.example .env
# ⚠️ 编辑 .env，填写数据库、Redis、Temporal、外部 S3-compatible 存储、认证与加密配置
# MYSQL_PASSWORD 必须与两个数据库 URL 中的密码一致

npm install

# 只启动本地数据库和 Redis 即时传输；媒体始终写入 .env 配置的开发对象存储桶
# 注意：docker-compose.yml 将服务映射到非标准端口，.env.example 已按此预设
docker compose up mysql redis -d

# 初始化数据库表结构（首次必须执行，跳过会导致启动后报错）
npm run db:push

# 启动开发服务器
npm run dev
```

> [!WARNING]
> 跳过 `npm run db:push` 会导致数据库表结构缺失；请务必在启动应用与 worker 前运行。
>
> 对象存储桶必须预先创建，并允许当前凭据执行 bucket 检查以及对象读、写、删操作。
> `S3_ENDPOINT` 必须是外部 AI Provider 可访问的 HTTPS endpoint；本地开发同样使用开发桶，
> 不需要 ngrok、cloudflared、本地文件存储或 Docker MinIO。AWS S3、Cloudflare R2、
> 腾讯云 COS 与阿里云 OSS 只需切换同一组 `S3_*` 配置；GCS 需使用 XML API + HMAC 凭据。
> Azure Blob 不是 S3 协议，本版本不直接支持。
>
> 从旧 BullMQ/Outbox/Run/Wait 架构升级到 B+ 前，必须先停止旧 Web、Bull worker
> 和 Outbox dispatcher，完成数据库备份，再运行
> `npm run db:bplus-cutover-preflight`。该命令只读：任何 active Task、旧 Run/Wait/
> Activity/Interruption/Handoff、待交付 Outbox、未完成 OperationExecution、
> 未消费 ApprovalGrant、旧模型 checkpoint 或重复 Thread archive 都会明确阻断。
> 全部为 0 后，人工审核输出并执行 `npm run db:bplus-cutover-apply`；不要用
> `db:push --accept-data-loss` 代替这次 migration。migration 完成后再启动新 Web 与
> Temporal worker。B+ migration 的 MySQL DDL 非事务化，中途失败必须停止并检查实际
> schema，禁止盲目重跑。

### B+ 一次性切换：备份、演练与失败恢复

这次切换会删除旧控制面表和字段，必须在维护窗口内执行。下面的逻辑备份和完整恢复
演练是发布门槛；云数据库快照或时间点恢复可以作为额外保护，但不能代替这次演练。
所有旧 Web、Bull worker 和 Outbox dispatcher 必须从备份开始前一直保持停止，防止备份
之后再产生无法进入新库的写入。

先把以下变量替换成目标 MySQL 的真实值。备份目录必须位于受限的持久磁盘，不能放进
Git 仓库；数据库名只允许字母、数字和下划线。

```bash
set -euo pipefail
umask 077

export BPLUS_DB_HOST='127.0.0.1'
export BPLUS_DB_PORT='3306'
export BPLUS_DB_USER='waoowaoo'
export BPLUS_DB_PASSWORD='replace-with-real-password'
export BPLUS_DB_NAME='waoowaoo'
export BPLUS_BACKUP_DIR='/absolute/private/backup/path/bplus-cutover-20260731T120000Z'

case "$BPLUS_DB_NAME" in
  ''|*[!A-Za-z0-9_]*) echo 'BPLUS_DB_NAME must contain only A-Z, a-z, 0-9, _' >&2; exit 1 ;;
esac

mkdir -p "$BPLUS_BACKUP_DIR"
MYSQL_PWD="$BPLUS_DB_PASSWORD" mysqldump \
  --host="$BPLUS_DB_HOST" \
  --port="$BPLUS_DB_PORT" \
  --user="$BPLUS_DB_USER" \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  --set-gtid-purged=OFF \
  --column-statistics=0 \
  --no-tablespaces \
  --default-character-set=utf8mb4 \
  "$BPLUS_DB_NAME" > "$BPLUS_BACKUP_DIR/pre-cutover.sql"

test -s "$BPLUS_BACKUP_DIR/pre-cutover.sql"
shasum -a 256 "$BPLUS_BACKUP_DIR/pre-cutover.sql" \
  > "$BPLUS_BACKUP_DIR/pre-cutover.sql.sha256"
shasum -a 256 -c "$BPLUS_BACKUP_DIR/pre-cutover.sql.sha256"
```

在同一 MySQL server 上创建一个明确命名的临时演练库，真实恢复备份并在这个临时库上
完成一次 preflight 与 migration。以下命令会拒绝覆盖已经存在的同名库。演练用
`DATABASE_URL` 的密码必须进行 URL 编码。

```bash
set -euo pipefail

export BPLUS_REHEARSAL_DB='waoowaoo_bplus_rehearsal_20260731'
: "${BPLUS_REHEARSAL_DATABASE_URL:?Set the rehearsal database URL in an ignored local environment file}"

case "$BPLUS_REHEARSAL_DB" in
  ''|*[!A-Za-z0-9_]*) echo 'BPLUS_REHEARSAL_DB must contain only A-Z, a-z, 0-9, _' >&2; exit 1 ;;
esac

test "$(
  MYSQL_PWD="$BPLUS_DB_PASSWORD" mysql \
    --host="$BPLUS_DB_HOST" \
    --port="$BPLUS_DB_PORT" \
    --user="$BPLUS_DB_USER" \
    --batch \
    --skip-column-names \
    --execute="SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '$BPLUS_REHEARSAL_DB'"
)" = '0'

MYSQL_PWD="$BPLUS_DB_PASSWORD" mysql \
  --host="$BPLUS_DB_HOST" \
  --port="$BPLUS_DB_PORT" \
  --user="$BPLUS_DB_USER" \
  --execute="CREATE DATABASE \`$BPLUS_REHEARSAL_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

MYSQL_PWD="$BPLUS_DB_PASSWORD" mysql \
  --host="$BPLUS_DB_HOST" \
  --port="$BPLUS_DB_PORT" \
  --user="$BPLUS_DB_USER" \
  "$BPLUS_REHEARSAL_DB" < "$BPLUS_BACKUP_DIR/pre-cutover.sql"

DATABASE_URL="$BPLUS_REHEARSAL_DATABASE_URL" npm run db:bplus-cutover-preflight
DATABASE_URL="$BPLUS_REHEARSAL_DATABASE_URL" npm run db:bplus-cutover-apply

test "$(
  MYSQL_PWD="$BPLUS_DB_PASSWORD" mysql \
    --host="$BPLUS_DB_HOST" \
    --port="$BPLUS_DB_PORT" \
    --user="$BPLUS_DB_USER" \
    --database="$BPLUS_REHEARSAL_DB" \
    --batch \
    --skip-column-names \
    --execute="
      SELECT IF(
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name IN (
              'project_agent_turns',
              'agent_tool_effects',
              'agent_turn_interactions',
              'follow_up_batches',
              'follow_up_batch_members'
            )) = 5
        AND
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name IN (
              'project_agent_runs',
              'project_agent_waits',
              'project_agent_activities',
              'project_agent_interruptions',
              'project_agent_execution_handoffs',
              'project_agent_continuation_checkpoints',
              'project_agent_events',
              'outbox_commands'
            )) = 0
        AND
        (SELECT COUNT(*) FROM information_schema.table_constraints
          WHERE constraint_schema = DATABASE()
            AND table_name = 'project_assistant_thread_archives'
            AND constraint_name = 'project_assistant_thread_archives_userId_fkey'
            AND constraint_type = 'FOREIGN KEY') = 1,
        'BPLUS_SCHEMA_READY',
        'BPLUS_SCHEMA_DIVERGED'
      )
    "
)" = 'BPLUS_SCHEMA_READY'
```

演练成功后，回到仍然冻结写入的真实数据库，重新运行只读 preflight，再且仅再执行一次
migration，并用同一条 schema 查询确认结果。不要对真实数据库执行
`db:push --accept-data-loss`。

```bash
set -euo pipefail

npm run db:bplus-cutover-preflight
npm run db:bplus-cutover-apply

test "$(
  MYSQL_PWD="$BPLUS_DB_PASSWORD" mysql \
    --host="$BPLUS_DB_HOST" \
    --port="$BPLUS_DB_PORT" \
    --user="$BPLUS_DB_USER" \
    --database="$BPLUS_DB_NAME" \
    --batch \
    --skip-column-names \
    --execute="
      SELECT IF(
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name IN (
              'project_agent_turns',
              'agent_tool_effects',
              'agent_turn_interactions',
              'follow_up_batches',
              'follow_up_batch_members'
            )) = 5
        AND
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name IN (
              'project_agent_runs',
              'project_agent_waits',
              'project_agent_activities',
              'project_agent_interruptions',
              'project_agent_execution_handoffs',
              'project_agent_continuation_checkpoints',
              'project_agent_events',
              'outbox_commands'
            )) = 0
        AND
        (SELECT COUNT(*) FROM information_schema.table_constraints
          WHERE constraint_schema = DATABASE()
            AND table_name = 'project_assistant_thread_archives'
            AND constraint_name = 'project_assistant_thread_archives_userId_fkey'
            AND constraint_type = 'FOREIGN KEY') = 1,
        'BPLUS_SCHEMA_READY',
        'BPLUS_SCHEMA_DIVERGED'
      )
    "
)" = 'BPLUS_SCHEMA_READY'
```

如果真实 migration 在任意 DDL 处失败，立即停止，不得在这个部分切换的库上重新运行
migration，也不得人工逐条补表。保留失败库作为诊断证据，创建一个新的空恢复库，从已
验证的备份恢复，然后在恢复库上从 preflight 开始完成一次全新切换：

```bash
set -euo pipefail

export BPLUS_RECOVERY_DB='waoowaoo_bplus_recovery_20260731'
: "${BPLUS_RECOVERY_DATABASE_URL:?Set the recovery database URL in an ignored local environment file}"

case "$BPLUS_RECOVERY_DB" in
  ''|*[!A-Za-z0-9_]*) echo 'BPLUS_RECOVERY_DB must contain only A-Z, a-z, 0-9, _' >&2; exit 1 ;;
esac

test "$(
  MYSQL_PWD="$BPLUS_DB_PASSWORD" mysql \
    --host="$BPLUS_DB_HOST" \
    --port="$BPLUS_DB_PORT" \
    --user="$BPLUS_DB_USER" \
    --batch \
    --skip-column-names \
    --execute="SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = '$BPLUS_RECOVERY_DB'"
)" = '0'

MYSQL_PWD="$BPLUS_DB_PASSWORD" mysql \
  --host="$BPLUS_DB_HOST" \
  --port="$BPLUS_DB_PORT" \
  --user="$BPLUS_DB_USER" \
  --execute="CREATE DATABASE \`$BPLUS_RECOVERY_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

MYSQL_PWD="$BPLUS_DB_PASSWORD" mysql \
  --host="$BPLUS_DB_HOST" \
  --port="$BPLUS_DB_PORT" \
  --user="$BPLUS_DB_USER" \
  "$BPLUS_RECOVERY_DB" < "$BPLUS_BACKUP_DIR/pre-cutover.sql"

DATABASE_URL="$BPLUS_RECOVERY_DATABASE_URL" npm run db:bplus-cutover-preflight
DATABASE_URL="$BPLUS_RECOVERY_DATABASE_URL" npm run db:bplus-cutover-apply

test "$(
  MYSQL_PWD="$BPLUS_DB_PASSWORD" mysql \
    --host="$BPLUS_DB_HOST" \
    --port="$BPLUS_DB_PORT" \
    --user="$BPLUS_DB_USER" \
    --database="$BPLUS_RECOVERY_DB" \
    --batch \
    --skip-column-names \
    --execute="
      SELECT IF(
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name IN (
              'project_agent_turns',
              'agent_tool_effects',
              'agent_turn_interactions',
              'follow_up_batches',
              'follow_up_batch_members'
            )) = 5
        AND
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name IN (
              'project_agent_runs',
              'project_agent_waits',
              'project_agent_activities',
              'project_agent_interruptions',
              'project_agent_execution_handoffs',
              'project_agent_continuation_checkpoints',
              'project_agent_events',
              'outbox_commands'
            )) = 0
        AND
        (SELECT COUNT(*) FROM information_schema.table_constraints
          WHERE constraint_schema = DATABASE()
            AND table_name = 'project_assistant_thread_archives'
            AND constraint_name = 'project_assistant_thread_archives_userId_fkey'
            AND constraint_type = 'FOREIGN KEY') = 1,
        'BPLUS_SCHEMA_READY',
        'BPLUS_SCHEMA_DIVERGED'
      )
    "
)" = 'BPLUS_SCHEMA_READY'
```

恢复库通过 `BPLUS_SCHEMA_READY` 查询后，才允许把部署的 `DATABASE_URL` 指向恢复库并
启动新 Web 与 Temporal worker。失败库和演练库只能在备份、迁移日志、校验输出都已归档
且运维人员明确确认后删除；应用代码不会提供自动修复或自动回退状态机。

---

访问 [http://localhost:13000](http://localhost:13000)（方式一、二）或 [http://localhost:3000](http://localhost:3000)（方式三）开始使用！

> 方式一、二会在容器首次启动时初始化数据库；外部对象存储配置和预建桶仍必须提前准备。

> [!TIP]
> **如果遇到网页卡顿**：HTTP 模式下浏览器可能限制并发连接。可安装 [Caddy](https://caddyserver.com/docs/install) 启用 HTTPS：
> ```bash
> caddy run --config Caddyfile
> ```
> 然后访问 [https://localhost:1443](https://localhost:1443)

---

## 🔧 API 配置

启动后进入**设置中心**配置 AI 服务的 API Key，内置配置教程。

> 💡 **注意**：目前仅推荐使用各服务商官方 API，第三方兼容格式（OpenAI Compatible）尚不完善，后续版本会持续优化。

---

## 📦 技术栈

- **框架**: Next.js 15 + React 19
- **数据库**: MySQL + Prisma ORM
- **持久执行**: Temporal（Thread 协调与长期 Task）
- **即时传输与缓存**: Redis（不承担生命周期正确性）
- **样式**: Tailwind CSS v4
- **认证**: NextAuth.js

---

## 📦 页面功能预览

![4f7b913264f7f26438c12560340e958c67fa833a](https://github.com/user-attachments/assets/fa0e9c57-9ea0-4df3-893e-b76c4c9d304b)
![67509361cbe6809d2496a550de5733b9f99a9702](https://github.com/user-attachments/assets/f2fb6a64-5ba8-4896-a064-be0ded213e42)
![466e13c8fd1fc799d8f588c367ebfa24e1e99bf7](https://github.com/user-attachments/assets/09bbff39-e535-4c67-80a9-69421c3b05ee)
![c067c197c20b0f1de456357c49cdf0b0973c9b31](https://github.com/user-attachments/assets/688e3147-6e95-43b0-b9e7-dd9af40db8a0)

---

## 🤝 参与方式

本项目由核心团队独立维护。欢迎你通过以下方式参与：

- 🐛 提交 [Issue](https://github.com/saturndec/waoowaoo/issues) 反馈 Bug
- 💡 提交 [Issue](https://github.com/saturndec/waoowaoo/issues) 提出功能建议
- 🔧 提交 Pull Request 供参考 — 我们会认真审阅每一个 PR 的思路，但最终由团队自行实现修复，不会直接合并外部 PR

---

**Made with ❤️ by waoowaoo team**

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=saturndec/waoowaoo&type=date&legend=top-left)](https://www.star-history.com/#saturndec/waoowaoo&type=date&legend=top-left)
