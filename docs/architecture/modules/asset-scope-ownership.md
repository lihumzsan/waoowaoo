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
- **ASO-07 — 资产 identity 由独立采用/创建入口显式建立。** 系统不存在 Edit-first 确认事务或“制作规划后自动建资产”。Primary 可从精确 screenplay/Bible/Chapter/asset-prompt revisions 调用既有 scoped asset Operation；该 Operation 必须先解析或创建唯一 ProjectCharacter/ProjectLocation/Prop identity，再独立提交媒体 Task。后续 Chapter、视频或连续性结果只能引用这些真实 identity，不能创建第二套同义资产，也不能因阶段或最近记录推断。
- **ASO-08 — 领域关系不拥有共享媒体回收权。** asset select、confirm、revert、cleanup、delete 与 project delete 只更新或删除自己的领域关系；storageKey、MediaObject 或签名 URL 不是独占所有权证明，同一对象可能被 copy/reuse 后由多个关系引用。领域操作不得直接删除已有对象或把任意 key 送入私有 GC/Outbox；物理回收只能由独立 media lifecycle owner 从生产 relation registry 穷尽证明零引用后执行。本次上传新建、尚未提交为任何关系的唯一临时 key 只允许在所属事务失败时原地补偿，不构成 GC 入口。
- **ASO-09 — 媒体读取也必须证明活跃 owner relation。** `/m/:publicId`、本地 `/api/files/:key`、对象存储签名 route 与后台 Task 的存储读取必须先通过同一媒体访问策略，从生产 MediaObject relation 或精确 legacy relation 证明权威 user 拥有引用；publicId、storageKey、签名 URL、Task payload 和文件存在性都不是公开授权。foreign 与 missing 统一返回 NOT_FOUND，响应只允许 private/no-store，签名 TTL 有固定上限。浏览器必须直接携带 session 读取受保护 route，内部相对重定向不得从服务端 Host 推导第二 origin；后台 Task 以任务的持久 `userId` 通过该策略后直接读取存储，不得为此恢复内部 HTTP token 或伪造浏览器 session。
- **ASO-10 — 顶层资产删除与重生成各有一个入口。** 角色、场景和道具的顶层删除只允许 `delete_asset → removeAsset`，Project/Asset Hub/API 不得保留按 kind 分裂的 delete Operation；appearance/image 等 variant 删除仍按精确 parent/variant identity 独立处理。已有资产不满意时只允许 `regenerate_asset` 在原 assetId 与既有 variant 下提交图片 Task，禁止创建同义替代资产。重生成计划必须冻结当前图片版本 watermark：同一版本重复提交保持幂等，新的完成版本必须可再次重生成，不能被首次生成任务的 dedupe key 吞掉。重生成可增加同一 parent 下显式候选槽，但不得改变顶层 canonical identity。

## 权威入口

| 事实或动作 | 唯一权威入口 | 持久化依据 |
| --- | --- | --- |
| owner、scope、kind、parent/variant 解析 | `src/lib/assets/services/asset-scope-ownership.ts` | 全局资产 `userId`；项目 `userId`；资产 `projectId`；variant parent foreign key |
| 资产 mutation 与删除 | `delete_asset` Operation → `src/lib/assets/services/asset-actions.ts::removeAsset` | 上述 resolver 返回的完整 scoped target；顶层角色/场景/道具共用一个入口 |
| 已有资产重生成 | `regenerate_asset` Operation → asset generation planner/commit | 原 assetId、精确 appearance/image variant 与新的 Task；不创建顶层资产 |
| location-backed 资产操作 | `src/lib/assets/services/location-backed-assets.ts`，仅由 scoped asset actions 调用 | 已验证的 project/global asset identity |
| upload/render 写入 | `src/lib/assets/services/project-upload-render.ts` | `prepareTransaction` 在事务外完成 target ownership 预检、图片上传与空间分析；短事务以 target identity + prepare `updatedAt` 单条 CAS 取得版本写权并一次提交业务关系、输出与资源 Outbox；失败只按 prepare identity 补偿本次新临时 key，事务结果不明时先以 owner + target identity + key 查询精确关系，关系已存在则拒绝删除 |
| API 与 Operation 入口 | unified asset routes、`src/lib/operations/api-only/assets-api-ops.ts` | Route 鉴权 + service 返回的 scoped authority |
| 媒体对象读取与签名 | `src/lib/media/storage-access-policy.ts`，由 `/m`、`/api/files`、`/api/storage/sign` 与 worker-owned media normalizer 共同调用 | MediaObject 的 owner relation registry；迁移期只接受逐字段精确解析的 legacy relation；Task userId 只作为裁决输入，不是读取旁路 |

Route body 中的 ID、UI card identity、Operation context、最近记录或裸 variant ID 都不是所有权事实。调用方不得自行补充部分查询，也不得在 resolver 失败后回退到无 scope 的 `findUnique({ id })`。

## 验证

- `npm run check:architecture-docs` 验证模块文档结构、索引和声明路径完整。
- `npm run check:asset-scope-ownership` 拒绝新的 raw-ID mutation、跨父级 variant 和非原子 copy 旁路。
- `tests/integration/api/specific/asset-scope-ownership.integration.test.ts` 使用真实 MySQL 验证 global/project、character/location/prop、parent/variant、copy atomicity，以及共享 prepare 版本的第二次上传必须被 stale `updatedAt` CAS 拒绝且不能覆盖第一份正式 render。
- `GJ-ASSET-HUB-CROSS-PROJECT-DENIAL` 通过真实浏览器与生产 copy route，证明第二个已登录用户不能覆盖其他项目的资产。
- 同一 Golden 的媒体加载与跨用户拒绝必须经过受保护 `/m`/文件 route；共享 policy 的路径规范化、symlink containment 与 private cache header 由 route/logic 验证补充。

结构检查只证明已知旁路没有恢复；跨用户拒绝由最小安全 Journey 证明，普通 source/target 组合由真实 MySQL integration 证明，不再另建一条浏览器产品线。

## 历史回归

- `f364bbc9e4` 引入 unified asset service 与 copy route 时，全局 source 查询包含 owner scope，但项目 target 仍使用裸 `findUnique({ id })`。结果是用户 B 可以用自己的项目完成 Route 鉴权，却把项目 A 的 character ID 作为 target，并成功覆盖项目 A 的资产。
- System Journey 的 `GJ-ASSET-HUB-CROSS-PROJECT-DENIAL` 首次通过真实浏览器、生产 Route、Service 和 MySQL 复现了这个跨用户写入。
- `af300a4ff` 将 owner、project、kind、parent/variant 与 copy transaction 收敛到共享 resolver，并删除 operation-specific raw-ID 所有权解释。
- 当前防线由跨项目拒绝 Journey 与 integration 中的合法复用/原子 copy 组合共同构成，避免用第二条产品 Journey 重复覆盖同一 service 契约。
- 资源通知与业务写收敛到同一事务时，项目和 Asset Hub 上传曾把 `sharp`、对象存储和空间档案 AI 一起塞入 interactive transaction，并且只在 executor 已返回 output 后才能补偿；慢外部调用可能令事务超时，执行中失败还会留下本次未共享对象。同步 Asset Hub 写迁入事务后，media normalizer/projector 还曾使用全局 Prisma client，无法读取本事务未提交的 MediaObject 并可能形成跨 client 竞争。当前 Operation 明确分为事务外 prepare、短事务 commit 和按 prepare identity 的失败补偿；同步媒体规范化/投影复用同一 transaction client，registry 穷尽拒绝缺少 prepare/commit/compensate 的外部资源写。已有关系仍只由领域更新，物理回收没有被转移给 Operation。
- 项目删除从旧 route 迁入 Operation 时沿用了“先枚举项目内 URL 并批量删除 storage，再删除数据库”的顺序；它既不能在 DB 失败时恢复对象，也把“项目引用”误当成媒体独占所有权，copy/reuse 后可能删除其他存活关系仍在使用的对象。当前 `delete_project` 只在 Operation 事务内删除项目及级联领域关系，返回值不再伪报 storage cleanup；后续物理回收只能由独立 media lifecycle/GC owner 证明全 registry 零引用后执行。
- 写入侧 owner resolver 已存在时，媒体读取 route 仍把 `publicId` 和 storage key 当作 bearer capability：任意登录用户可枚举 `/m`，本地文件 route 甚至无需会话，对象存储签名也未证明关系 owner。旧 Asset Journey 只验证 mutation/copy，没有攻击读取链。当前三个入口收敛到 relation-based read policy，本地文件额外用 realpath 拒绝 symlink 越界；legacy 字段只作为迁移期精确引用适配，尚未物化为 MediaObject relation 的全部历史组合是需由 Golden 继续复验的盲区。
- 媒体 route 收紧为浏览器 session 后，真实 Golden 又发现 video/image worker 仍把本地 key 转成 `/api/files` 再通过 HTTP 回读；worker 没有也不应拥有浏览器 Cookie，因此合法参考图被 401 拒绝、视频阶段永久停留在 processing。当前后台读取复用同一 owner relation policy，再直接读取对象存储并执行输入大小上限；旧内部 token、公开文件 route 和 session 冒充均未恢复。项目资产改图查询同时以 `projectId + userId` 约束裸子实体，防止合法 Task payload 被替换成其他 scope 的 ID。
- 旧风格预览链曾写入 storage 却未登记 MediaObject，暴露受保护媒体关系、Next 图片优化器 session 与本地签名 origin 三类断点。固定预览链已删除；用户显式要求的任意预览现在只走通用图片 Resource 路径，因此必须像其他图片一样先登记 MediaObject、使用受保护同源读取并保持 owner relation，不能恢复专用存储旁路。
- 顶层资产删除曾同时存在 Project character/location、Asset Hub character/location 和 generic location/prop 五个 Operation，部分路径直接调用 Prisma delete，Agent 又只有按图片组/单图分裂的旧重生成工具。用户无法从统一资产 identity 表达“删除后重做”或“原地重生成”，调用方也可能用 create 新增同义资产。当前五条顶层 delete 收敛为 `delete_asset` 并统一经过 scoped `removeAsset`；两个旧重生成 Operation 收敛为 `regenerate_asset`，复用既有 generation planner、mutation batch 和 asset identity。variant 删除不属于顶层资产入口，仍保留其精确 parent/variant 契约。

## 修改检查表

- 是否把完整的 scope、owner、project、kind、asset 和 variant identity 传给共享 resolver，而不是只传裸 ID？
- 新增的 child/variant 是否通过 parent foreign key 验证，且没有“最近记录”或独立 ID 查询旁路？
- mutation、plan、Task、upload 或 storage 副作用是否全部发生在 ownership 校验之后？
- copy 是否在同一事务中先验证 source 与 target，再完成删除、替换和 source association？
- missing、foreign、wrong-kind、cross-parent 是否都在副作用前以不泄露存在性的错误失败？
- destructive helper 是否仍只能从 `asset-actions.ts` 的 scoped 入口调用？
- 是否把“关系删除”误写成 storageKey 物理删除？除本次失败上传的唯一临时 key 外，领域操作不得承担媒体 GC。
- 如果新增资产 kind 或 variant，是否同步更新 resolver、`docs/architecture/modules.json` 的实际路径、真实 MySQL conformance 和适用 Golden Journey？
- 是否运行 `npm run check:architecture-docs`、`npm run check:asset-scope-ownership`，并根据行为影响选择已有 Product Golden，而不是机械新增测试？
