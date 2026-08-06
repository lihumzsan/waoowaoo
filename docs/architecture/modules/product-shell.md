<!-- architecture-module: product-shell -->

# 产品外壳、身份与本地化

## 为什么是这样

产品外壳负责用户进入系统后最先依赖的事实：当前会话、当前语言、部署版本能力和顶层导航。它只
投影这些权威事实，不根据页面文案、目标语言、隐藏按钮或环境猜测当前状态。

隐藏 UI 不等于关闭能力——这是本模块最容易复发的错误。历史上多次出现"页面被 deployment feature
隐藏，但后端 route、Operation 和 Agent 工具仍然可用"。

## 不变量

- **PS-01 — 当前语言拥有当前界面。** 导航、可访问名称、错误提示和确认入口必须使用当前 locale；
  目标 locale 只有在用户选中后才拥有切换确认内容和后续导航。
- **PS-02 — 部署能力单一来源，且同时裁决前后端。** cloud/self-hosted 的可见能力只从 deployment
  features 派生并经公开 contract 消费，页面不得按 edition 名称或环境变量另行猜测。同一个 feature
  必须同时裁决 UI、API、Operation channel 和 runtime——隐藏页面不等于关闭能力。
- **PS-03 — 会话与业务身份分离。** 重载、退出和重新登录不得改变持久 identity；受保护页面与 route
  必须分别通过真实会话与资源 owner 校验。
- **PS-04 — locale 导航唯一入口。** 本地化页面导航必须使用 `@/i18n/navigation`；切换语言必须保留
  当前产品 pathname 和持久实体 identity。
- **PS-06 — 一个用户动作只有一个页面后继。** 创建或保存成功后若必须导航到另一表面，不得同时启动
  只服务当前页的 refetch；留在当前页时才由当前页刷新自己的 View。
- **PS-07 — 权威父资源成功后才可初始化子资源。** 空数组、缺失 View 或 loading 结束不能证明用户
  拥有父资源。父资源 401/403/404 或读取错误后必须停止全部派生写入。
- **PS-08 — 浏览器会话是用户 API 的唯一身份来源。** 受保护 route 只接受会话中的持久 user id；
  固定内部 token、调用方提供的 user id、用户名或邮箱不得成为并行身份入口。运维数据还必须经过
  显式管理员授权，不能由 feature 可见性代替鉴权。
- **PS-09 — 认证防线与部署配置失败关闭。** 注册、初次设置和改密必须共用唯一密码策略。限流只在
  可信代理链被显式声明后才解析来路 header，无法确认来源时不信任、也不回退为无限制。正式部署
  preflight 必须拒绝缺失或弱密钥、非 HTTPS 公网地址、可变 Worker build identity、关闭版本化与
  未知代理拓扑；编排文件不得提供可用默认密码或把基础设施默认绑定到公网。
- **PS-09a — 产品版本不拥有基础设施托管选择。** 产品 edition 只决定官方产品能力，不得被执行平面、
  存储或其他基础设施解释为必须购买对应厂商的托管服务；连接安全由各自显式配置裁决。
- **PS-11 — 认证入口与账号初始化唯一。** 产品只有一个登录/注册页面；受信身份已存在时登录，不存在
  时在同一次认证动作中创建用户与余额。所有认证方式必须复用同一个账号初始化 writer。个人资料
  可见性不能等同于密码能力：隐藏密码表单不得连带隐藏非密码身份管理。手机号 canonical identity 是
  归一化 E.164 并由唯一账号键持久化；修改显示名不得改写登录 identity。已启用短信目的地由穷尽
  registry 声明，且只能声明现有审核能力可直接发送的地区——需要新增审核的目的地不得作为潜在实例
  或运行时开关预埋；绕过 UI 的未启用目的地必须在发送前原地失败。验证码只在有 TTL 的服务端挑战中
  保存，页面倒计时不承担安全或终态正确性。
- **PS-12 — 对象存储是必需外部基础设施。** 所有部署共用一个预建的公网 HTTPS S3 兼容桶；启动必须
  在应用/worker 之前严格解析配置并验证桶可达。不得在启动时创建桶、回退本地目录或按 edition 选择
  第二存储协议。供应商切换只改部署级配置，不得进入 AI Provider 配置。
- **PS-13 — 错误 identity 与本地化文案分离。** HTTP/API 只返回稳定 typed code 与必要的非敏感
  identity；当前 locale 的 i18n catalog 是用户文案唯一 owner。route、执行失败、Provider message、
  `Error.cause` 和英文开发文案不得直接成为用户 copy；未知内部错误对外收敛为稳定 code。
- **PS-14 — 客户端错误只有一个解释入口。** 浏览器只经统一的 error client / hook / toast context
  把稳定 code 投影为当前 locale 文案、下一步动作和可报障 reference。页面不得展示原始 message、
  stack、Provider 原文或裸错误码，也不得另建局部 toast/alert；401、离线与重连必须产生明确可恢复
  反馈。
- **PS-15 — 站内公告按 registry identity 与版本投放。** placement、有效期、优先级和文案 key 只由
  registry 声明；`(user, announcement, version)` 是跨设备已读唯一事实。页面只消费服务端 pending
  View，不得用 localStorage、DOM 或组件私有布尔值建立第二套已读状态。新版必须递增 version。
- **PS-16 — 公测预约是显式同意的独立联系事实。** 预约不得复用认证身份、付费席位或支付记录；
  `(campaignId, phoneE164)` 是唯一 identity，只有服务端预约 service 可以写入。前后端必须由同一
  deployment feature 裁决，且只有付费内测的权威 Campaign View 判定席位售罄后才能开放；API
  只回传脱敏号码，不得把原始手机号写入日志或响应。

## 权威入口

- locale 路由与导航：`src/i18n/**`、`@/i18n/navigation`
- 部署能力：`src/lib/deployment/**`、`/api/deployment`；用户 Provider 配置可用性由
  `src/lib/user-api/availability.ts` 统一裁决
- 认证与账号初始化：`src/lib/auth/**`（`account-onboarding.ts` 是唯一账号 writer）
- API 会话、管理员权限与错误边界：`src/lib/api-auth.ts`、`src/lib/auth/admin.ts`、`src/lib/errors/**`
- 公测预约：`src/lib/public-beta/**`、`/api/public-beta/waitlist`；售罄事实来自
  `src/lib/paid-beta/campaign.ts`
- 部署启动边界：`docker-compose.yml`、`docker-entrypoint.sh`、`scripts/check-cloud-env.mjs`、
  `src/lib/storage/**`

## 踩过的坑

- 英文页面的语言按钮用目标语言生成可访问名称：视觉是英文，可访问名称是中文，按当前语言查询的
  真实浏览器无法操作 → 把"当前界面语言"和"要切换到的语言"混成一个 copy owner（PS-01）。
- API 配置页面已被 feature 隐藏，但共享的读写与诊断 route 仍只校验登录，Agent 也仍暴露配置工具
  → 隐藏 UI 被当成关闭能力 → 同一 feature 同时派生前端可见性与后端 availability（PS-02）。
  同一根因换形式复发过一次：平台模型选择页删除后，用户偏好仍是平台模型的第二 writer → 服务端
  一并拒绝模型偏好写入。
- 内部 LLM 代理删除后，固定 token + 头部 user id 的身份旁路残留在通用 auth helper，普通用户还能
  下载全局日志 → route 级项目鉴权与 UI 隐藏没有覆盖非项目入口 → 删除内部 token 协议，运维 route
  复用管理员裁决（PS-08）。
- 用户 Provider 配置的读取接口曾直接解密并回传 API key，连接测试还依赖客户端重新提交明文 →
  设置页鉴权只能防跨用户，不能防扩展、XSS、前端日志与缓存 → View 只返回是否已配置。
- 上线前审计发现浏览器同时存在原生 alert、局部 toast 和十份私有 message parser，已有的中英文错误
  词表从未接入调用链 → 稳定错误 identity 没有唯一客户端 projector → 全局入口只接受 registry code
  （PS-14）。
- 短信首版从号码语法猜业务能力：规范化接受任意合法 E.164，adapter 却始终发国内模板和签名，境外
  号码必然被拒 → 没有目的地 registry → registry 只声明现有模板可直接承载的地区（PS-11）。
- 依赖清理时用仓库检索判定传递依赖可删，遗漏了 worker 对未声明包的直接 side-effect import；类型
  检查通过而 worker 启动崩溃 → 类型检查不能证明运行时 import 可解析 → 运行入口只消费显式注入的
  环境。同类问题在国际号码库的 CommonJS 入口上换形式复发过一次。
- 首页比例选择曾用多个 HTTP 事务依次创建项目、改比例、初始化层级，任一步失败留下半初始化项目 →
  一个用户动作被拆成多个非原子事务 → 只调用一个创建 Operation。
