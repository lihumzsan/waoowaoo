<!-- architecture-module: asset-scope-ownership -->

# 资产 Scope 所有权

## 设计理念

资产身份不是一个孤立 ID。所有用于写入前读取和变更的资产，都必须先解析为同一个不可拆分的权威身份：scope、owner user、可选 project、asset kind、asset ID，以及可选 variant ID。

鉴权只证明“谁正在调用”；资产 Scope 权威负责证明“这个调用者究竟可以修改哪一个资产”。Route、UI、Operation 和 Task 都只能消费这项结论，不能各自重新解释所有权。

## 不变量

- **ASO-01 — Scoped identity 不可拆分。** 全局资产必须属于当前用户；项目资产必须属于当前用户拥有的项目；请求 kind 必须与持久化资产 kind 一致。
- **ASO-02 — 子实体身份不能悬空。** appearance、image、render 或其他 variant ID，只有在它确实属于已验证的 scoped parent asset 时才有效。
- **ASO-03 — 共享 service 是唯一所有权裁判。** Route 或 project 鉴权只是前置条件，不是资产所有权证明；所有 mutation、plan 和 read-for-write 都必须调用共享 Asset Scope resolver。
- **ASO-04 — Scope 不匹配不得泄露资源存在性。** missing、foreign、wrong-kind 和 cross-parent 统一在副作用发生前以 `NOT_FOUND` 失败。
- **ASO-05 — Copy 必须原子验证两端。** 全局 source 与项目 target 必须先完成授权；校验、替换和 source association 位于同一事务。
- **ASO-06 — 删除不得只凭裸 ID。** destructive deletion 必须经过与 update、select、revert 相同的 scoped identity 证明。
- **ASO-07 — 制作规划资产来源显式。** Edit-first 主流程中，`confirmEpisodeEditBible` 的确认事务通过 `ensureEditBibleAssets` 物化本次制作规划声明的 ProjectCharacter/ProjectLocation 及其首个 variant；后续 `generate_edit_script_assets` 只为这些既有 identity 规划并提交图片/空间档案任务，不得等核心剪辑表生成后再创建一套同义资产。核心剪辑 requirement 只绑定真实资产 identity，不是第二资产写入入口。

## 权威入口

| 事实或动作 | 唯一权威入口 | 持久化依据 |
| --- | --- | --- |
| owner、scope、kind、parent/variant 解析 | `src/lib/assets/services/asset-scope-ownership.ts` | 全局资产 `userId`；项目 `userId`；资产 `projectId`；variant parent foreign key |
| 资产 mutation 与删除 | `src/lib/assets/services/asset-actions.ts` | 上述 resolver 返回的完整 scoped target |
| location-backed 资产操作 | `src/lib/assets/services/location-backed-assets.ts`，仅由 scoped asset actions 调用 | 已验证的 project/global asset identity |
| upload/render 写入 | `src/lib/assets/services/project-upload-render.ts` | 上传副作用前完成的 target ownership 校验 |
| API 与 Operation 入口 | unified asset routes、`src/lib/operations/api-only/assets-api-ops.ts` | Route 鉴权 + service 返回的 scoped authority |

Route body 中的 ID、UI card identity、Operation context、最近记录或裸 variant ID 都不是所有权事实。调用方不得自行补充部分查询，也不得在 resolver 失败后回退到无 scope 的 `findUnique({ id })`。

## 验证

- `npm run check:architecture-docs` 验证模块文档结构、索引和声明路径完整。
- `npm run check:asset-scope-ownership` 拒绝新的 raw-ID mutation、跨父级 variant 和非原子 copy 旁路。
- `tests/integration/api/specific/asset-scope-ownership.integration.test.ts` 使用真实 MySQL 验证 global/project、character/location/prop、parent/variant 和 copy atomicity。
- `GJ-ASSET-HUB-CROSS-PROJECT-DENIAL` 通过真实浏览器与生产 copy route，证明第二个已登录用户不能覆盖其他项目的资产。

结构检查只证明已知旁路没有恢复；跨用户拒绝由最小安全 Journey 证明，普通 source/target 组合由真实 MySQL integration 证明，不再另建一条浏览器产品线。

## 历史回归

- `f364bbc9e4` 引入 unified asset service 与 copy route 时，全局 source 查询包含 owner scope，但项目 target 仍使用裸 `findUnique({ id })`。结果是用户 B 可以用自己的项目完成 Route 鉴权，却把项目 A 的 character ID 作为 target，并成功覆盖项目 A 的资产。
- System Journey 的 `GJ-ASSET-HUB-CROSS-PROJECT-DENIAL` 首次通过真实浏览器、生产 Route、Service 和 MySQL 复现了这个跨用户写入。
- `af300a4ff` 将 owner、project、kind、parent/variant 与 copy transaction 收敛到共享 resolver，并删除 operation-specific raw-ID 所有权解释。
- 当前防线由跨项目拒绝 Journey 与 integration 中的合法复用/原子 copy 组合共同构成，避免用第二条产品 Journey 重复覆盖同一 service 契约。

## 修改检查表

- 是否把完整的 scope、owner、project、kind、asset 和 variant identity 传给共享 resolver，而不是只传裸 ID？
- 新增的 child/variant 是否通过 parent foreign key 验证，且没有“最近记录”或独立 ID 查询旁路？
- mutation、plan、Task、upload 或 storage 副作用是否全部发生在 ownership 校验之后？
- copy 是否在同一事务中先验证 source 与 target，再完成删除、替换和 source association？
- missing、foreign、wrong-kind、cross-parent 是否都在副作用前以不泄露存在性的错误失败？
- destructive helper 是否仍只能从 `asset-actions.ts` 的 scoped 入口调用？
- 如果新增资产 kind 或 variant，是否同步更新 resolver、`docs/architecture/modules.json` 的实际路径、真实 MySQL conformance 和适用 Golden Journey？
- 是否运行 `npm run check:architecture-docs`、`npm run check:asset-scope-ownership`，并根据行为影响选择已有 Product Golden，而不是机械新增测试？
