# Security Policy / 安全策略

## Reporting a vulnerability

Do not disclose vulnerabilities, credentials, exploit details, or user data in a public issue.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/waooAI/waoowaoo/security/advisories/new>

Include the affected version, deployment mode, impact, reproduction steps, and a minimal proof of concept. Remove real API keys, signed URLs, cookies, database dumps, and personal data.

请勿在公开 Issue 中披露漏洞、凭据、利用细节或用户数据。请通过上面的 GitHub 私密安全报告渠道提交，
并提供受影响版本、部署模式、影响范围、复现步骤和最小证明；提交前删除所有真实密钥和个人数据。

## Scope

The maintainers can investigate waoowaoo application and container behavior. Third-party AI providers, object-storage services, Docker, Temporal, databases, and reverse proxies remain governed by their own security programs unless the issue is caused by waoowaoo's integration.

Developer Preview releases are not yet recommended for public multi-tenant production.
