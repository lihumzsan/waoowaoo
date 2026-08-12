# Provider 与模型配置

自托管模式使用用户自己的 Provider 账户。部署者只负责基础设施；每个登录用户在网页中配置自己的
Provider Key 和模型。

## 配置步骤

1. 打开 **设置 → API 配置**。
2. 新增 Provider，并填写 API Key；只有自定义 endpoint 时才填写 Base URL。
3. 执行连接测试。
4. 为 Assistant、分析、角色图、场景图、图片编辑、视频、声音和音乐角色选择模型。
5. 保存后创建一个小型测试项目验证实际能力。

设置接口只返回“是否已配置”，不会把明文 Key 读回浏览器。空 secret 字段表示保留现有 Key。

## 能力边界

- 模型必须在 registry 中声明对应能力；名称相似不代表协议兼容。
- 应用不会在失败时自动换 Provider 或模型。
- 第三方 OpenAI-compatible endpoint 可能只兼容文字，而不兼容异步图片、视频和音频协议。
- Provider 的限流、内容审核、数据保留和费用由其自己的条款决定。
- 可选 Web Search 使用部署级 `OPENAI_API_KEY`，与用户的 Assistant 模型 Key 是不同能力边界。

## 安全建议

- 为自托管实例创建独立、最小权限的 Provider Key。
- 在 Provider 后台设置预算、限额和异常告警。
- 不要把 Key 放进 README、Issue、截图、日志或客户端环境变量。
- 公开部署时确保每个用户只能管理自己的配置。

## 失败处理

凭据无效、模型不可用或 Provider 拒绝时，应用会在所选模型上明确失败，不会静默换路。提交结果未知的
媒体请求不会自动重提，因为 Provider 可能已经受理并计费。错误代码和处理方法见
[故障排查](troubleshooting.md)。
