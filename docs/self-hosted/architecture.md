# 自托管架构

```text
Browser
  │ HTTPS / SSE
  ▼
Web application
  ├── MySQL ────── 项目、资源、任务、用户配置和最终事实
  ├── Redis ────── 即时传输、缓存和短期协调
  ├── Temporal ─── 持久 Workflow、Activity、重试和恢复
  │     └── Versioned Worker slots (blue / green)
  ├── S3 ───────── 图片、视频和音频对象
  └── Docker daemon
        └── Isolated Codex Runtime per active project
              └── User-selected AI Provider
```

## 所有权边界

- MySQL 中的 Resource、Task 和 Turn View 是产品持久事实。
- Temporal 管理执行生命周期，但不建立第二份产品状态。
- Codex Runtime 保存模型原生 Thread/history，不拥有项目资源事实。
- S3 保存媒体对象；数据库保存对象身份、版本和权限关系。
- 用户在网页配置 Provider Key；Provider transport 不选择替代模型。

## 为什么需要 Docker socket

Web 的 Runtime Session Manager 会为活跃项目创建短生命周期、资源受限的 Codex 容器。应用容器只携带
Docker CLI，并通过挂载的 daemon socket 创建 Runtime。生产部署必须保护该 daemon，限制主机访问，
并使用专用 internal network；把 Docker socket 暴露给不受信任容器等同于主机级风险。

## 网络边界

- MySQL、Redis 和 Temporal 默认只绑定回环地址。
- Codex Runtime network 为 internal network，只通过 Web 提供的受控能力访问业务系统。
- 外部 Provider 与 S3 使用 HTTPS 出站连接。
- 私网 Provider 默认被 SSRF 防线拒绝；只有明确受信任的主机可加入精确 allowlist。

## 持久目录

- MySQL、Redis 和 Temporal 配置使用 Compose volume。
- `data/` 与 S3 保存产品数据。
- `CODEX_RUNTIME_HOST_ROOT` 保存可恢复的原生 Agent Thread。
- `docker-logs/` 保存有界滚动日志。

生产设计和不变量以 [`docs/architecture`](../architecture/README.md) 为权威；本文只解释部署视角，不复制
模块状态机。
