<!-- architecture-module: production-operations -->

# 生产发布与主机治理

## 为什么是这样

生产发布会同时改变 Web、异步消费者、Runtime placement 和数据库契约，不能依赖人工记忆拼接命令。
主机清理同样会删除恢复材料；把“磁盘空间”当作普通缓存问题，会在没有备份或仍被运行实例引用时
破坏回滚和数据恢复。因此发布与维护都必须由受控入口依据权威运行事实裁决，并在无法证明安全时
原地失败。

## 不变量

- **PO-01 — 只发布已验证的不可变身份。** 生产发布只能消费通过同一 CI 验证的精确源码身份；Web、
  Worker 与 Runtime 最终必须运行解析后的不可变镜像 digest，禁止用可漂移 tag 或服务器工作区状态
  决定生产内容。
- **PO-02 — Worker 版本切换必须排空。** 新 Worker 通过版本路由成为新任务唯一消费者；旧 Worker
  停止领取后只允许排空已执行工作，仍有执行事实时不得强制删除。发布完成必须证明只有新版本继续
  消费。
- **PO-03 — Runtime placement 必须由生命周期 owner 交接。** Web 所有权切换前必须停止旧 owner；
  旧 placement 中尚未终结的 Turn 只能经 Assistant 生命周期的既有恢复 writer 结算，禁止只删除
  容器或只改 UI 状态后启动新 owner。
- **PO-04 — 清理不拥有业务 volume。** 自动维护只能删除明确归类的可重建缓存、非在用镜像和有界
  日志；持久 volume、当前运行 digest 与保留的回滚 digest 不属于清理入口。目标身份或在用状态无法
  证明时必须拒绝执行。
- **PO-05 — 数据库日志清理以已验证备份为前置事实。** binlog 保留由数据库维护入口唯一管理；只有
  新备份完整产生并通过完整性验证后，才可删除超出保留窗口的日志。备份失败不得推进日志清理。
- **PO-06 — 长生命周期进程日志必须有界。** Compose 服务、动态 Runtime 与本地 Registry 都必须
  使用有界日志策略；新增绕过 Compose 的容器入口也必须声明同等边界，禁止依赖事后人工清盘。
- **PO-07 — 失败发布不得伪报完成。** 任一镜像、数据库、路由、Runtime、Worker、代理或维护验收
  不能证明目标终态时，发布必须失败并保留可诊断事实；不得在旧新版本仍竞争消费时宣布成功。

## 权威入口

- 已验证源码到生产镜像与服务交接：`.github/workflows/verify.yml`、`scripts/production/**`
- Worker 版本路由与排空：`scripts/temporal/worker-rollout.sh`
- Runtime Turn 恢复结算：`src/lib/assistant-runtime/persistence.ts`
- 动态 Runtime 容器边界：`src/lib/codex-runtime/docker-runtime-container.ts`
- 周期维护调度：`ops/systemd/**`

## 踩过的坑

- 旧发布只替换 Compose Web/Worker，独立 Docker Runtime 不受 Compose 管理；等待用户授权的旧容器
  可无限存活并阻断后续版本，而直接删除又会留下数据库 waiting Turn → 发布脚本只看服务容器，未把
  Runtime placement 纳入同一交接协议 → 停止旧 Web owner 后复用生命周期恢复 writer 结算，再删除
  旧 placement 并启动新 owner（PO-03/07）。
