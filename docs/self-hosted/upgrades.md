# 升级、备份与恢复

## 必须备份的内容

- MySQL 数据库。
- `.env`，尤其是 `API_ENCRYPTION_KEY`。
- S3 bucket 中的媒体对象。
- `CODEX_RUNTIME_HOST_ROOT` 中的持久 Agent Thread 数据。
- 当前应用/Runtime 镜像 digest、Worker Build ID 和 Compose 文件版本。

Redis 主要承担即时传输和缓存，但升级前仍应停止写入并保存完整部署状态。

## Worker 蓝绿升级

持续 Temporal Workflow 可能仍绑定旧 Worker Build。升级不能按固定时间停止旧 Worker，也不能用普通
`down/up` 替换唯一 Worker。

1. 在未运行的 slot 中配置新应用 digest、唯一 Build ID 和 `REPLICAS=1`。
2. 执行 `sh scripts/temporal/worker-rollout.sh promote <blue|green>`。
3. promotion 成功后更新 `APP_IMAGE`，再执行 `docker compose up -d` 更新 Web。
4. 使用 `sh scripts/temporal/worker-rollout.sh status` 检查旧版本。
5. 只有旧版本明确报告 `drained` 后，才把其副本数持久设为 `0` 并执行 `retire`。

rollout 脚本是唯一 Worker 路由入口。普通 `docker compose up` 不管理带
`temporal-worker-rollout` profile 的 Worker slot。

## 数据库升级

不要在生产环境使用 `db:push --accept-data-loss`。涉及迁移时：

1. 停止旧 Web 和旧执行入口。
2. 创建数据库备份并完成恢复演练。
3. 阅读对应 Release 的迁移说明。
4. 运行明确的 preflight；只有全部阻塞项为零才执行 apply。
5. 验证 schema 和关键数据后再启动新版本。

MySQL DDL 可能不是事务化的。迁移部分失败时按照 Release 说明从备份恢复，不要反复运行破坏性命令。

## 回滚

Web 可以指回上一不可变 digest，但仍在运行的 Workflow 必须保留能重放其历史的 Worker。数据库契约若
已发生不兼容变更，代码回滚必须配合经过验证的数据恢复，不能只替换容器镜像。

任何删除卷、数据库、对象或持久 Runtime 目录的动作都应视为不可恢复操作。
