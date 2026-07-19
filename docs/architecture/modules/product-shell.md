<!-- architecture-module: product-shell -->

# 产品外壳、身份与本地化

## 设计理念

产品外壳负责用户进入系统后最先依赖的事实：当前会话、当前语言、部署版本能力和顶层导航。它只投影这些权威事实，不得根据页面文案、目标语言、隐藏按钮或环境猜测当前状态。

## 不变量

- **PS-01 — 当前语言拥有当前界面。** 导航、可访问名称、错误提示和确认入口必须使用当前 locale；目标 locale 只有在用户选中后才拥有切换确认内容和后续导航。
- **PS-02 — 部署能力单一来源。** cloud/self-hosted 的可见能力只从 `src/lib/deployment/features.ts` 派生并经公开 deployment contract 消费，页面不得根据 edition 名称或环境变量另行猜测。隐藏页面不等于关闭能力：用户 Provider 配置是否可用必须由 `providerCredentialMode` 同时裁决 UI、API、Operation channel 和 runtime；`platform-key` 下用户读取、写入和连接诊断全部拒绝。
- **PS-03 — 会话与业务身份分离。** 浏览器重载、退出和重新登录不得改变用户的持久 identity；受保护页面和 route 必须分别通过真实会话与资源 owner 校验。
- **PS-04 — locale 导航唯一入口。** 本地化页面导航必须使用 `@/i18n/navigation`，切换语言必须保留当前产品 pathname 和持久实体 identity。
- **PS-05 — 外部辅助能力不是真相来源。** GitHub 更新等外部辅助响应不能改变鉴权、项目或部署能力事实；Golden 只以协议兼容替身验证边界，真实公网可用性保留为外部盲区。
- **PS-06 — 一个用户动作只有一个页面后继。** 创建或保存成功后若必须导航到另一产品表面，不得同时启动只服务于当前页面的 refetch；留在当前页时才由当前页刷新自己的 View。
- **PS-07 — 权威父资源成功后才可初始化子资源。** 空数组、缺失 View 或 loading 结束不能证明用户拥有父资源。自动创建默认剧集等 setup 写入必须先取得成功且已鉴权的 Project；父资源 401/403/404 或读取错误后必须停止全部派生写入。
- **PS-08 — 浏览器会话是用户 API 的唯一身份来源。** 受保护 HTTP route 只接受 NextAuth session 中的持久 user id；固定内部 token、调用方提供的 user id、用户名或邮箱不得成为并行身份入口。日志下载和其他运维数据还必须经过显式管理员授权，不能由 deployment feature visibility 代替鉴权。
- **PS-09 — 认证防线与部署配置失败关闭。** 登录/注册限流只在 `TRUSTED_PROXY_HOPS` 明确声明后从右侧可信代理链解析客户端 IP；无法验证来源使用共享桶，Redis 不可用时拒绝认证尝试。cloud preflight 必须显式区分本地开发与正式部署：本地只允许 loopback HTTP、无代理或明确的非负代理跳数，以及仅 loopback 暴露的无认证 Bull Board；正式部署必须拒绝缺失、弱密钥、非 HTTPS 公网地址和未知代理拓扑。Compose 不得提供可用的默认密码或把基础设施默认绑定到公网。

## 权威入口

- locale 路由与导航：`src/i18n/**`、`src/components/LanguageSwitcher.tsx`、`@/i18n/navigation`。
- 顶层会话和能力投影：`src/components/Navbar.tsx`、`src/app/[locale]/profile/page.tsx`。
- 部署能力：`src/lib/deployment/config.ts`、`src/lib/deployment/features.ts`、`/api/deployment`；用户 Provider 配置后端能力统一由 `src/lib/user-api/availability.ts` 裁决。
- 注册/登录和资源 owner：生产 auth routes、NextAuth session 与项目鉴权 service。
- API session、管理员权限和错误边界：`src/lib/api-auth.ts`、`src/lib/auth/admin.ts`、`src/lib/api-errors.ts`。
- 部署启动边界：`docker-compose.yml`、`Dockerfile`、`docker-entrypoint.sh`、`scripts/check-cloud-env.mjs`、`scripts/bull-board.ts` 与 `next.config.ts`。

## 验证

- `GJ-AUTH-SESSION-RECOVERY` 验证注册、刷新、退出、错误密码和恢复登录不改变持久用户 identity。
- `GJ-PROJECT-CROSS-USER-ISOLATION` 验证会话 identity 不能越过项目 owner。
- `GJ-I18N-CRITICAL-PROJECT` 验证英文 UI 创建的同一项目经产品语言切换后仍是同一持久实体。
- `GJ-DEPLOY-SELF-HOSTED-CAPABILITIES` 比较公开 capability contract 与真实注册、Profile 和导航表面。
- `scripts/guards/locale-navigation-guard.mjs` 阻止本地化导航恢复第二入口。
- `tests/unit/auth/rate-limit-client-ip.test.ts` 反证伪造 X-Forwarded-For 绕过；`docker compose config` 与 cloud env preflight 分别验证自托管、cloud 启动契约。

## 历史回归

- 首次全产品 i18n Journey 发现英文页面的语言按钮使用目标语言生成 `aria-label`，视觉文字虽然是英文，可访问名称却是中文；按当前语言查询的真实浏览器因此无法操作。根因是把“当前界面语言”和“准备切换到的目标语言”混成一个 copy owner。
- 真实退出 Journey 先发现 NextAuth CSRF GET 与页面导航竞争；手写 POST 虽清除了服务端 Cookie，却又让 SessionProvider 保持已登录，进一步证明登出不能有第二客户端 writer。Profile 现在用 NextAuth `signOut({redirect:false})` 同时更新协议、Cookie 和客户端缓存，再由 locale router 导航；Journey 同时验证 Navbar 未登录与 session 为空。
- 项目创建 Journey 发现“创建后引导模型配置”同时启动项目列表 refetch 和 Profile 导航，页面中止自己的 refetch 后又记录错误；创建动作现在根据唯一后继决定是刷新列表还是离开页面。
- Asset ownership Journey 在删除攻击者项目后立即退出，发现删除 handler 启动当前页 refetch 却不等待它完成；下一次导航把成功删除后的刷新记录成网络错误。留在当前页的删除动作现在等待自己的唯一刷新后继完成。
- 权限 Journey 发现外部用户读取 Project 已返回 403 后，页面仍把空 episodes 当作合法零状态并自动创建第一集；自动初始化现在必须先证明权威 Project 已成功读取。
- 大量旧测试没有经过真实英文页面、Navbar 和产品切换确认，因而从未观察到这个组合错误。
- 早期内部 LLM HTTP 代理删除后，固定 `INTERNAL_TASK_TOKEN + x-user-id` 身份旁路仍残留在通用 auth helper，且普通用户可下载全局日志；路由级项目鉴权与 UI 隐藏没有覆盖这两个非项目入口。当前删除内部 token 协议、代理 handler 与 callback，用户 API 只接受 session id，日志 route 复用管理员裁决，5xx 响应不再回传内部错误详情。Golden auth/permission 继续验证真实会话；运维身份的独立部署验证仍是未覆盖盲区。
- 自托管 Compose 曾把 MySQL、Redis、MinIO、NextAuth、Cron、API 加密和 Bull Board 凭据写死，并把数据库、存储和队列面板绑定全部网卡；旧健康检查只证明服务可达，反而固化了公开弱凭据。当前所有密钥必须显式注入，基础设施与应用端口默认只绑定 loopback，Redis 启用认证，Bull Board 在生产或非 loopback 时强制完整凭据，容器以 Node 22 构建并在入口完成数据目录权限后降权到 `node`。既有部署升级前需同步 `.env`，真实反向代理/TLS 组合仍需在目标环境复验。
- 代理信任改为显式配置后，真实权限 Journey 在无可信代理的本地部署连续创建多个测试用户时触发了共享注册桶：原先每分钟 3 次的阈值会把同一 NAT/未知来源下的正常注册误判成攻击。注册桶调整为每分钟 10 次，仍由 Redis 原子滑窗限制批量滥用；登录继续保持更严格阈值，无法确认客户端来源时仍不信任来路 header，也不回退为无限制。
- 安全部署加固曾把正式公网 cloud 的管理员、Bull Board 认证、HTTPS 和正数代理跳数要求无条件加入 `.env.cloud.local` preflight；结构检查和生产构建只证明规则足够严格，没有运行仍由同一入口驱动的本地 `dev:cloud`，导致没有管理员、反向代理或公网 Bull Board 的正常开发环境无法启动。当前保留一个 fail-closed 校验器，由 package script 显式选择 development 或 production profile；development 只放宽不存在的运维能力，公网 HTTP、半套 Bull Board 凭据、非 loopback 无认证暴露和非法代理值仍原地失败。
- Cloud API 配置页面虽由 deployment feature 隐藏，共享的读取、写入和连接诊断 route 仍只校验登录，主 Agent registry 也继续暴露读写配置 Tool；正常生成因为 `platform-key` 忽略用户持久配置而未被改写，但隐藏 UI 并未关闭后端能力。当前 `providerCredentialMode` 同时派生 API 配置可见性和后端 availability，Cloud 在数据库或外部连接前统一拒绝，Agent 配置 Operation 改为 API-only；Self-hosted 的个人设置 writer 保持不变。

## 修改检查表

1. 当前页面的可见和可访问内容是否全部由当前 locale 拥有？
2. 目标 locale 是否只在用户选择后用于确认内容和后续导航？
3. deployment UI 是否只消费公开 features contract，而没有读取 edition 或环境自行判断？
4. 登出、重载、切换语言后是否保留或明确结束正确的会话与业务 identity？
5. 是否复用了 `@/i18n/navigation`，且相关 Golden Journey 经过真实浏览器验证？
6. 自动创建默认子资源前，是否已经成功读取并鉴权父资源，而不是只看到空列表？
