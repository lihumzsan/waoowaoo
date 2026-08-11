# 环境变量与基础设施

`.env.example` 是自托管模板，`.env.cloud.example` 仅用于官方 Cloud 开发。不要把两者混用。

## 必需配置

| 分类 | 变量 | 说明 |
|---|---|---|
| 应用镜像 | `APP_IMAGE` | Web 与 Worker 共用的不可变 digest |
| 数据库 | `COMPOSE_DATABASE_URL`、`MYSQL_*` | Compose 内部必须使用 `mysql` 主机名 |
| Redis | `REDIS_PASSWORD` | 独立随机值 |
| 认证 | `NEXTAUTH_URL`、`NEXTAUTH_SECRET` | 公开地址与会话签名密钥 |
| 内部安全 | `CRON_SECRET`、`API_ENCRYPTION_KEY` | 内部调用与用户 Provider Key 加密 |
| 存储 | `S3_*` | 外部 HTTPS S3-compatible bucket |
| Temporal | `TEMPORAL_MYSQL_PASSWORD`、Worker 镜像和 Build ID | 持久任务与版本发布 |
| Agent Runtime | `CODEX_RUNTIME_IMAGE`、`CODEX_RUNTIME_HOST_ROOT` | 隔离运行镜像和持久 Thread 目录 |

运行 `sh scripts/self-hosted/prepare-env.sh` 可以安全生成本地密钥。脚本使用权限为 `0600` 的新文件，
发现目标 `.env` 已存在时立即拒绝覆盖。

## 固定的自托管模式

```dotenv
DEPLOYMENT_EDITION=self-hosted
PROVIDER_CREDENTIAL_MODE=user-key
BILLING_MODE=OFF
```

这三个值共同决定自托管产品表面：显示用户 API 配置，隐藏官方 Cloud 计费和平台 Provider Key。
不要通过复制 Cloud 环境变量重新开启第二套能力判断。

## 网络与端口

默认只有回环地址可访问：

| 服务 | 默认宿主机端口 |
|---|---:|
| Web（生产 Compose） | `13000` |
| MySQL | `13306` |
| Redis | `16379` |
| Temporal | `17233` |
| Temporal UI（可选 profile） | `18080` |

只有明确配置防火墙、TLS 和认证后，才应修改 `APP_BIND_ADDRESS` 或 `INFRA_BIND_ADDRESS`。数据库、Redis
和 Temporal 不应直接暴露到公网。

## 反向代理

- `NEXTAUTH_URL` 必须是浏览器实际访问的最终 HTTPS origin。
- `TRUSTED_PROXY_HOPS` 只填写实际可信代理层数，直连保持 `0`。
- 代理必须支持 SSE/流式响应，关闭不必要的响应缓冲。
- 上传限制应覆盖你允许的最大媒体文件，但不要设置无限请求体。

## 密钥备份

必须安全备份 `.env`，特别是 `API_ENCRYPTION_KEY`。轮换数据库、Redis 或内部密钥需要同步更新所有相关
消费者；不要只替换数据库中的一侧。`API_ENCRYPTION_KEY` 丢失后，已有用户 Provider Key 无法恢复。

禁止提交：`.env`、数据库备份、日志、S3 凭据、Provider Key、证书、私钥和官方 Cloud 私有配置。
