# 对象存储

waoowaoo 使用部署级 S3-compatible bucket 保存图片、视频和音频。当前版本不提供本地文件存储或内置
MinIO fallback。

## 要求

- bucket 必须预先创建。
- endpoint 必须使用 HTTPS，并能被你配置的外部 AI Provider 访问。
- 凭据需要检查 bucket，以及读取、写入和删除对象的权限。
- 建议为 waoowaoo 使用独立 bucket 或独立前缀和最小权限凭据。

```dotenv
S3_ENDPOINT=https://s3.example.com
S3_UPLOAD_ENDPOINT=https://s3.example.com
S3_REGION=us-east-1
S3_BUCKET=waoowaoo
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
S3_SESSION_TOKEN=
S3_FORCE_PATH_STYLE=false
```

`S3_ENDPOINT` 用于读取、签名和控制操作；`S3_UPLOAD_ENDPOINT` 用于 PUT，可填写同一 endpoint，或明确的
跨地域上传加速 endpoint。两者必须指向同一个 bucket。

AWS S3、Cloudflare R2、腾讯云 COS 和阿里云 OSS 使用同一组配置。GCS 需要 XML API 与 HMAC 凭据。
Azure Blob 不是 S3 协议，当前版本不直接支持。

## 验证

应用或容器启动时会执行存储初始化检查。失败时先确认：

- endpoint 是完整 HTTPS URL。
- DNS 和 TLS 证书有效。
- region、bucket 和 path-style 模式匹配供应商要求。
- 当前凭据能读、写、删测试对象。
- 外部 Provider 能访问最终签名 URL，而不只是本机能访问。

不要在公开 Issue 中粘贴签名 URL、访问密钥或完整存储错误响应。
