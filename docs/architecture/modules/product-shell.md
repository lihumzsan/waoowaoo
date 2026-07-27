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
- **PS-09 — 认证防线与部署配置失败关闭。** 注册、初次设置和修改密码必须共同复用唯一密码策略，当前最小长度为 8 位；不得由页面、route 或运维写入绕过。登录/注册限流只在 `TRUSTED_PROXY_HOPS` 明确声明后从右侧可信代理链解析客户端 IP；无法验证来源使用共享桶，Redis 不可用时拒绝认证尝试。cloud preflight 必须显式区分本地开发与正式部署：本地只允许 loopback HTTP、无代理或明确的非负代理跳数，以及仅 loopback 暴露的无认证 Bull Board；正式部署必须拒绝缺失、弱密钥、非 HTTPS 公网地址和未知代理拓扑。Compose 不得提供可用的默认密码或把基础设施默认绑定到公网。
- **PS-10 — 首页初始化是一个原子构造。** 首页已展示并保存的画面比例不再触发模型 Choice；“开始创作”只能通过 `create_project` 的一个事务创建 Project、写入该显式比例并创建首 Episode。任一步失败必须全部回滚，浏览器不得用 create → config PATCH → episode POST 拼出半初始化项目。其他没有比例的合法入口仍保留 `videoRatio=null`，真正需要媒体执行时由 Primary 发起通用 Choice，并且只提交当前比例决定。
- **PS-11 — 认证入口与账号初始化唯一。** 产品只有一个登录/注册页面；受信身份已存在时登录，不存在时在同一次认证动作中创建 `User` 与 `UserBalance`。所有认证方式必须复用 `src/lib/auth/account-onboarding.ts` 这一账号初始化 writer。Cloud 只注册手机号与 Google provider，密码 provider、独立注册 route、密码设置 API 必须同时关闭；self-hosted 只注册用户名密码 provider。手机号 canonical identity 是归一化 E.164，并由 `Account(provider="phone", providerAccountId)` 唯一键持久化。验证码只在 Redis 中保存带 TTL 的 HMAC，发送、失败补偿、尝试计数与一次性消费由 `phone-verification.ts` 唯一裁决；页面倒计时不承担安全或终态正确性。

## 权威入口

- locale 路由与导航：`src/i18n/**`、`src/components/LanguageSwitcher.tsx`、`@/i18n/navigation`。
- 顶层会话和能力投影：`src/components/Navbar.tsx`、`src/app/[locale]/profile/page.tsx`。
- 部署能力：`src/lib/deployment/config.ts`、`src/lib/deployment/features.ts`、`/api/deployment`；用户 Provider 配置后端能力统一由 `src/lib/user-api/availability.ts` 裁决。
- 注册/登录和资源 owner：`src/lib/auth/account-onboarding.ts`、`src/lib/auth/password-auth.ts`、`src/lib/auth/phone-verification.ts`、生产 auth routes、NextAuth session 与项目鉴权 service。
- API session、管理员权限和错误边界：`src/lib/api-auth.ts`、`src/lib/auth/admin.ts`、`src/lib/api-errors.ts`。
- 部署启动边界：`docker-compose.yml`、`Dockerfile`、`docker-entrypoint.sh`、`scripts/check-cloud-env.mjs`、`scripts/bull-board.ts` 与 `next.config.ts`。
- 首页 Project 构造：`create_project` Operation；Episode 行锁与编号由 `src/lib/projects/episode-service.ts` 统一写入，比例初始值和后续 `update_project_config` 共同复用 `video-ratio-write.ts` 的唯一事实 writer。

## 验证

- `GJ-AUTH-SESSION-RECOVERY` 验证注册、刷新、退出、错误密码和恢复登录不改变持久用户 identity。
- `GJ-PROJECT-CROSS-USER-ISOLATION` 验证会话 identity 不能越过项目 owner。
- `tests/unit/auth/phone-number.test.ts` 验证中国大陆输入变体与国际号码只能投影为一个 E.164 canonical identity，歧义号码原地拒绝。
- `GJ-I18N-CRITICAL-PROJECT` 验证英文 UI 创建的同一项目经产品语言切换后仍是同一持久实体。
- `GJ-DEPLOY-SELF-HOSTED-CAPABILITIES` 比较公开 capability contract 与真实注册、Profile 和导航表面。
- `scripts/guards/locale-navigation-guard.mjs` 阻止本地化导航恢复第二入口。
- `scripts/guards/api-route-contract-guard.mjs` 只允许枚举的匿名 route；手机号发送是唯一新增公开认证 route，其他认证与用户 API 仍必须显式鉴权。
- 自由组合 Golden 从真实首页证明 Project、16:9 和首 Episode 同时存在且没有比例 Choice；缺少比例的非首页入口则证明模型通用 Choice 仍可恢复当前媒体请求。
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
- 首页增加比例选择后曾用三个独立 HTTP 事务依次创建 Project、PATCH 比例、创建 Episode；后两步失败会留下无比例或无 Episode 的孤儿 Project。当前首页 payload 只调用现有 `create_project`，构造事务复用比例与 Episode 的权威 writer；独立 Project/Episode API 仍服务非首页显式操作，不是首页 fallback。
- 手机号认证接入前，密码注册通过 `/api/auth/register → auth_register_user` 创建 `User + UserBalance`，Google adapter 又独立复制同一初始化事务；页面同时保留 signin/signup 两套入口，deployment feature 只控制 Google 按钮和 provider，继续新增手机号会形成第三个 writer，并可能让 Cloud 隐藏密码 UI 后仍保留 credentials callback、注册 API 与密码设置 API。当前删除独立 signup、register route、注册 Operation 与旧结果协议，Google、手机号和 self-hosted 密码共同复用一个 onboarding writer；Cloud feature 同时裁决页面、NextAuth provider、短信发送 route 与密码设置 route。腾讯云明确拒绝时按 challenge identity 补偿，网络结果不明时保留短期 challenge，避免已送达验证码被本地误删；真实运营商到达率与目标生产反向代理组合仍是外部盲区。

## 修改检查表

1. 当前页面的可见和可访问内容是否全部由当前 locale 拥有？
2. 目标 locale 是否只在用户选择后用于确认内容和后续导航？
3. deployment UI 是否只消费公开 features contract，而没有读取 edition 或环境自行判断？
4. 登出、重载、切换语言后是否保留或明确结束正确的会话与业务 identity？
5. 是否复用了 `@/i18n/navigation`，且相关 Golden Journey 经过真实浏览器验证？
6. 自动创建默认子资源前，是否已经成功读取并鉴权父资源，而不是只看到空列表？
7. 新认证方式是否复用了唯一 onboarding writer、canonical Account identity 与 deployment capability，而没有恢复独立注册入口？
