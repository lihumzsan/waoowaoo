<!-- architecture-module: asset-scope-ownership -->

# Asset Hub Scope 与媒体所有权

## 设计理念

Asset Hub 是用户级可复用角色、场景和道具库；Project 内的任何人物、场景、道具、参考图和生成媒体都统一为 WorkspaceResource。两者可以通过显式导入建立 Lineage，但不存在 ProjectCharacter/ProjectLocation/ProjectAsset 第二套项目实体。

## 不变量

- **ASO-01 — Asset Hub 只有 user scope。** 全局资产必须属于当前用户，kind 必须与持久记录一致；Project id 不是 Hub asset ownership。
- **ASO-02 — 子实体不能悬空。** appearance、image/render variant 只有在属于已验证的 parent asset 时才有效。
- **ASO-03 — 共享 resolver 唯一裁决。** Route 鉴权不是资产证明；read-for-write、update、select、revert 和 delete 都先调用 `asset-scope-ownership.ts`。
- **ASO-04 — 不泄露存在性。** missing、foreign、wrong-kind 与 cross-parent 在副作用前统一 `NOT_FOUND`。
- **ASO-05 — 导入 Project 生成 WorkspaceResource。** Hub asset 进入项目必须显式选择 Placement，并由 WorkspaceResource service 创建目录/文件或媒体引用与 Lineage；不得复制成项目资产表、从名称合并或自动改写原 Hub asset。
- **ASO-06 — 媒体关系拥有访问权，不拥有物理回收权。** publicId、storageKey、签名 URL 和对象存在都不是授权；读取由 MediaObject active owner relation 证明。删除 Hub/Workspace 关系不能直接删除共享对象，物理 GC 只能在穷尽 relation registry 后执行。`/m/` 响应缓存只允许 `private, max-age, immutable`（MediaObject 字节不可变），禁止 `public`/`s-maxage` 让共享或 CDN 缓存成为第二分发面；授权检查仍在每次未命中请求上执行。
- **ASO-07 — 外部下载受 SSRF 边界。** 自有媒体先完成 owner 投影，再由统一 outbound fetch 逐跳验证 DNS/socket/redirect；内部 hostname 或签名 URL 不能成为私网 allowlist。
- **ASO-08 — 顶层删除唯一。** Hub 角色、场景、道具删除统一经 `delete_asset → removeAsset`；variant 使用精确 parent/variant identity。Project Resource 删除走 WorkspaceResource 契约，不走 Asset Hub service。
- **ASO-09 — 存储配置唯一。** 所有部署只使用 `src/lib/storage` 的 S3-compatible provider 与 `S3_*`；桶预建，endpoint 为 HTTPS，不回退本地目录或运行时建桶。
- **ASO-10 — Project 删除先关闭执行。** 删除 Project 前在同一事务确认没有非终态 Task、active Turn 或待恢复 interaction；数据库 cascade 不能替代外部执行取消。

## 权威入口

| 动作 | 唯一入口 |
| --- | --- |
| Hub owner/kind/variant | `src/lib/assets/services/asset-scope-ownership.ts` |
| Hub mutation/delete | `src/lib/assets/services/asset-actions.ts` + Asset Hub Operation/routes |
| Hub → Project | WorkspaceResource import Operation + Placement/Lineage |
| Project 创作资产 | `src/lib/workspace-resource/**` |
| 私有媒体读取/签名 | `src/lib/media/storage-access-policy.ts`、`outbound-owned-media.ts` |
| 外部媒体下载 | `src/lib/media/outbound-fetch.ts` |
| 对象存储 | `src/lib/storage/**` |

## 验证

真实 MySQL security tests 验证 cross-user Hub 和 WorkspaceResource 拒绝、parent/variant 归属、导入 Placement 与 Lineage。最小浏览器安全用例验证第二个用户无法读取/修改他人资源。目标桶、签名域名、Provider 下载与物理 GC 是部署边界，不能由 mock 声称完成。

## 修改检查表

- 是否把 Hub asset 直接当成 Project Resource，或恢复项目资产表？
- mutation 是否传递完整 owner/kind/parent identity？
- 导入是否显式 Placement 并建立 Resource Lineage？
- 是否误把关系删除当成物理对象删除？
