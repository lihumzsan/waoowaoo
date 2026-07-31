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
- **ASO-07 — 资产 identity 由独立采用/创建入口显式建立。** 系统不存在 Edit-first 确认事务或“制作规划后自动建资产”。`adopt_asset_manifest` 只根据服务端编译的 `manifestAssetId` 创建/复用唯一 ProjectCharacter/ProjectLocation/Prop identity 和绑定，不生成图片。Primary 也可通过普通 scoped asset Operation 显式创建单个资产。后续 Chapter、视频或连续性结果只能引用这些真实 identity，不能创建第二套同义资产，也不能因阶段或最近记录推断。
- **ASO-08 — 领域关系不拥有共享媒体回收权。** asset select、confirm、revert、cleanup、delete 与 project delete 只更新或删除自己的领域关系；storageKey、MediaObject 或签名 URL 不是独占所有权证明，同一对象可能被 copy/reuse 后由多个关系引用。领域操作不得直接删除已有对象或把任意 key 送入私有 GC/Outbox；物理回收只能由独立 media lifecycle owner 从生产 relation registry 穷尽证明零引用后执行。本次上传新建、尚未提交为任何关系的唯一临时 key 只允许在所属事务失败时原地补偿，不构成 GC 入口。
- **ASO-09 — 媒体读取也必须证明活跃 owner relation。** `/m/:publicId`、对象存储签名 route 与后台 Task 的存储读取/签名必须先通过同一媒体访问策略，从生产 MediaObject relation 或精确 legacy relation 证明权威 user 拥有引用；publicId、storageKey、签名 URL、Task payload 和对象存在性都不是公开授权。foreign 与 missing 统一返回 NOT_FOUND，响应只允许 private/no-store，签名 TTL 有固定上限。浏览器必须直接携带 session 读取受保护 route；后台 Task 以任务的持久 `userId` 通过该策略后直接读取 metadata 并签发 Provider HTTPS URL，不得恢复内部 HTTP token、伪造浏览器 session 或调用受保护 route。
- **ASO-14 — 物理存储只有一个部署级 owner。** 所有部署（包括本地开发）只使用 `src/lib/storage` 的一个 S3-compatible provider 和一组 `S3_*` 配置；桶必须预先创建，endpoint 必须是绝对 HTTPS。运行时不创建桶，不提供 local filesystem、内置 MinIO、`STORAGE_TYPE` 分支或 provider-specific 存储配置。S3 签名 URL 是短期传输能力，不取代 MediaObject relation、`/m` 会话读取或 storageKey canonical identity。
- **ASO-10 — 顶层资产删除与重生成各有一个入口。** 角色、场景和道具的顶层删除只允许 `delete_asset → removeAsset`，Project/Asset Hub/API 不得保留按 kind 分裂的 delete Operation；appearance/image 等 variant 删除仍按精确 parent/variant identity 独立处理。已有资产不满意时只允许 `regenerate_asset` 在原 assetId 与既有 variant 下提交图片 Task，禁止创建同义替代资产。重生成计划必须冻结当前图片版本 watermark：同一版本重复提交保持幂等，新的完成版本必须可再次重生成，不能被首次生成任务的 dedupe key 吞掉。重生成可增加同一 parent 下显式候选槽，但不得改变顶层 canonical identity。
- **ASO-11 — Asset Hub 虚拟 Project identity 唯一。** 所有 API、SSE、Task、计费和 Operation scope 判断必须引用 `GLOBAL_ASSET_PROJECT_ID`；只有该常量定义可以包含协议字面量。调用方散布同名字面量会形成不可穷尽的 scope 解释源，禁止作为“只是字符串”保留。
- **ASO-12 — manifest asset 映射只有一个 writer。** `ProjectCharacter/ProjectLocation/Prop.manifestAssetId` 在 Project 内唯一，只由 `project-asset-writer` 建立或复用。Asset Worker 只返回资产事实、逐字来源证据与稳定可见设计，不能自定义数据库 key 或写媒体执行 Prompt；稳定 `manifestAssetId` 由服务端对 `kind + normalized canonicalName` 编译。已有同名资产可在无冲突时被该 writer 一次性附加 manifest identity；同 ID 指向不同 kind/name、名称/别名歧义或来源证据不存在必须失败，不得用数组位置或“最近资产”合并。
- **ASO-13 — 资产设计、identity 与图片分权。** `asset-development` Skill 只决定资产自身的稳定可见设计；`adopt_asset_manifest` 物化 identity；`create_image` 是唯一图片生成入口。最终资产图片 Prompt 只由服务端 Asset Prompt Compiler 以 `stableDescription + Manifest Lineage 冻结的 Creative Direction 视觉字段 + Asset Format Policy` 编译。Format Policy 唯一决定 4:3、纯白背景和各类资产固定构图；角色固定为左侧脸部特写、右侧完整全身。Worker、Primary、旧 suffix 常量和调用方不得写第二份版式。Task 成功后才以 `project_asset_image + variantId` Binding 绑定图片；不得在 manifest adoption 内启动 Task，也不得恢复角色/场景/道具专用图片 worker。
- **ASO-15 — 主动下载外部媒体必须与 owner 投影分层。** 自有媒体先由 relation-based policy 证明 owner 并投影短期外部 HTTPS URL；应用随后主动读取该 URL 或 Provider result 时只能经 `src/lib/media/outbound-fetch.ts` 的 SSRF-safe socket/redirect 边界。storage key、internal app hostname 与签名 URL 都不能成为私网 fetch allowlist。
- **ASO-16 — Project销毁先关闭活跃执行权。** `delete_project` 必须先锁定Project canonical identity，并在同一事务确认不存在非终态Task、active Agent Turn或仍可恢复/等待用户的interaction；存在任一项即typed conflict。数据库`onDelete: Cascade`只负责已关闭生命周期的关系清理，不能充当对Temporal、Provider、计费或Agent执行的取消协议。

## 权威入口

| 事实或动作 | 唯一权威入口 | 持久化依据 |
| --- | --- | --- |
| owner、scope、kind、parent/variant 解析 | `src/lib/assets/services/asset-scope-ownership.ts` | 全局资产 `userId`；项目 `userId`；资产 `projectId`；variant parent foreign key |
| 资产 mutation 与删除 | `delete_asset` Operation → `src/lib/assets/services/asset-actions.ts::removeAsset` | 上述 resolver 返回的完整 scoped target；顶层角色/场景/道具共用一个入口 |
| Project 资产 identity 创建/复用 | `src/lib/assets/services/project-asset-writer.ts` | `projectId + manifestAssetId` 或显式单资产输入；角色、地点和道具共用 writer |
| Asset Manifest 采用 | `src/lib/operations/domains/assistant/creative-asset-ops.ts::adopt_asset_manifest` | 精确 screenplay + Manifest 自身冻结的 Creative Direction Lineage、source evidence/identity validation、共享 Project asset writer |
| 资产图片计划与关联 | `create_image` + `src/lib/asset-generation/asset-image-format.ts` 的唯一 Prompt Compiler + Task terminal materializer | stableDescription、精确 Direction Lineage、唯一 4:3/纯白背景/固定构图 Policy、精确 asset/variant ownership、Binding CAS |
| 已有资产重生成 | `regenerate_asset` Operation → asset generation planner/commit | 原 assetId、精确 appearance/image variant 与新的 Task；不创建顶层资产 |
| location-backed 资产操作 | `src/lib/assets/services/location-backed-assets.ts`，仅由 scoped asset actions 调用 | 已验证的 project/global asset identity |
| upload/render 写入 | `src/lib/assets/services/project-upload-render.ts` | `prepareTransaction` 在事务外完成 target ownership 预检、图片上传与空间分析；短事务以 target identity + prepare `updatedAt` 单条 CAS 取得版本写权并一次提交业务关系与输出，Operation registry 从正式结果投影 authoritative changed refs，commit 后仅 best-effort 发布 SSE；失败只按 prepare identity 补偿本次新临时 key，事务结果不明时先以 owner + target identity + key 查询精确关系，关系已存在则拒绝删除 |
| API 与 Operation 入口 | unified asset routes、`src/lib/operations/api-only/assets-api-ops.ts` | Route 鉴权 + service 返回的 scoped authority |
| 媒体对象读取与签名 | `src/lib/media/storage-access-policy.ts`，由 `/m`、`/api/storage/sign` 与 `src/lib/media/outbound-owned-media.ts` 共同调用 | MediaObject 的 owner relation registry；Task userId 只作为裁决输入，不是读取旁路；后台投影只返回 HTTPS |
| 外部媒体主动下载 | `src/lib/media/outbound-fetch.ts` | 绝对 HTTP(S) URL、逐跳 DNS 与实际 socket 地址 policy；下载后仍受共享 body limit |
| 物理对象存储、运维枚举与启动验证 | `src/lib/storage/s3-config.ts`、`providers/s3.ts`、`bootstrap.ts`、`scripts/media-{safety-backup,build-unreferenced-index}.ts` | 单一 `S3_*` 部署配置、预建 bucket、S3 object key；运行时与运维脚本均无本地 writer、provider-specific 配置或建桶 writer |

Route body 中的 ID、UI card identity、Operation context、最近记录或裸 variant ID 都不是所有权事实。调用方不得自行补充部分查询，也不得在 resolver 失败后回退到无 scope 的 `findUnique({ id })`。

## 验证

- `tests/integration/security/asset-scope-ownership.integration.test.ts` 使用真实 MySQL 验证 global/project、parent/variant、copy atomicity 与 stale CAS 拒绝。
- `SEC-ASSET-CROSS-PROJECT-DENIAL` 通过真实浏览器和生产 copy route 验证第二个已登录用户不能覆盖其他项目的资产。
- `S3_*` 的 HTTPS、必填凭据与 endpoint shape 可由配置解析和类型检查验证；HeadBucket、对象权限、签名域名及外部 Provider 可达性必须在目标部署桶人工复验，不能由本地 fixture 证明。
- `npx tsx --env-file=.env scripts/test-sign-api.ts` 仅用于目标部署桶的人工验收：用唯一 key 上传对象、生成 HTTPS 签名 URL、下载比对后删除该测试对象；该命令会写入并删除一个测试对象，不属于只读启动检查。
- `tests/integration/security/outbound-image.security.test.ts` 只保留 SSRF、重定向、字节和格式安全边界。后台私有媒体 owner + S3 的真实组合依赖部署对象存储，当前作为发布复验盲区，不用本地存储 fixture 伪造。

结构检查只证明已知旁路没有恢复；跨用户拒绝由最小安全 Journey 证明，普通 source/target 组合由真实 MySQL integration 证明，不再另建一条浏览器产品线。

## 历史回归

- `f364bbc9e4` 引入 unified asset service 与 copy route 时，全局 source 查询包含 owner scope，但项目 target 仍使用裸 `findUnique({ id })`。结果是用户 B 可以用自己的项目完成 Route 鉴权，却把项目 A 的 character ID 作为 target，并成功覆盖项目 A 的资产。
- 旧 System Journey 首次通过真实浏览器、生产 Route、Service 和 MySQL 复现了这个跨用户写入；该案例现收缩为最小浏览器安全场景 `SEC-ASSET-CROSS-PROJECT-DENIAL`。
- `af300a4ff` 将 owner、project、kind、parent/variant 与 copy transaction 收敛到共享 resolver，并删除 operation-specific raw-ID 所有权解释。
- 当前防线由跨项目拒绝 Journey 与 integration 中的合法复用/原子 copy 组合共同构成，避免用第二条产品 Journey 重复覆盖同一 service 契约。
- 资源通知与业务写收敛到同一事务时，项目和 Asset Hub 上传曾把 `sharp`、对象存储和空间档案 AI 一起塞入 interactive transaction，并且只在 executor 已返回 output 后才能补偿；慢外部调用可能令事务超时，执行中失败还会留下本次未共享对象。同步 Asset Hub 写迁入事务后，media normalizer/projector 还曾使用全局 Prisma client，无法读取本事务未提交的 MediaObject 并可能形成跨 client 竞争。当前 Operation 明确分为事务外 prepare、短事务 commit 和按 prepare identity 的失败补偿；同步媒体规范化/投影复用同一 transaction client，registry 穷尽拒绝缺少 prepare/commit/compensate 的外部资源写。已有关系仍只由领域更新，物理回收没有被转移给 Operation。
- 项目删除从旧 route 迁入 Operation 时沿用了“先枚举项目内 URL 并批量删除 storage，再删除数据库”的顺序；它既不能在 DB 失败时恢复对象，也把“项目引用”误当成媒体独占所有权，copy/reuse 后可能删除其他存活关系仍在使用的对象。当前 `delete_project` 只在 Operation 事务内删除项目及级联领域关系，返回值不再伪报 storage cleanup；后续物理回收只能由独立 media lifecycle/GC owner 证明全 registry 零引用后执行。
- `delete_project` 收敛到数据库事务后仍曾允许级联删除带走运行中的Task、Agent Turn与待resume interaction；这只删除本地关系，不会同步撤销已经提交给Temporal或Provider的执行许可。当前删除与执行创建共用Project行锁，并在同一事务对三类活跃事实失败关闭；只有生命周期均已终态后才允许关系级联和后续独立媒体GC。
- 写入侧 owner resolver 已存在时，媒体读取 route 仍把 `publicId` 和 storage key 当作 bearer capability：任意登录用户可枚举 `/m`，本地文件 route 甚至无需会话，对象存储签名也未证明关系 owner。旧 Asset Journey 只验证 mutation/copy，没有攻击读取链。读取随后收敛到 relation-based policy；本次删除最后的 local provider 与 `/api/files`，浏览器只剩 `/m` 或鉴权后签名重定向。尚未物化为 MediaObject relation 的历史组合是人工迁移复验盲区。
- 媒体 route 收紧为浏览器 session 后，真实产品复验又发现 video/image worker 仍把本地 key 转成 `/api/files` 再通过 HTTP 回读；worker 没有也不应拥有浏览器 Cookie，因此合法参考图被 401 拒绝、视频阶段永久停留在 processing。后台读取先改为 owner-aware 直接读取并编码，随后参考声音暴露 OpenRouter 只接受 HTTPS 且 Base64 请求体显著放大。当前后台唯一投影复用同一 owner policy，只读取 HeadObject metadata 并签发 24 小时 HTTPS URL；完整对象由外部 Provider 直接从部署桶读取，应用不再承担参考媒体 body 中转。
- 旧风格预览链曾写入 storage 却未登记 MediaObject，暴露受保护媒体关系、Next 图片优化器 session 与本地签名 origin 三类断点。固定预览链已删除；用户显式要求的任意预览现在只走通用图片 Resource 路径，因此必须像其他图片一样先登记 MediaObject、使用受保护同源读取并保持 owner relation，不能恢复专用存储旁路。
- 顶层资产删除曾同时存在 Project character/location、Asset Hub character/location 和 generic location/prop 五个 Operation，部分路径直接调用 Prisma delete，Agent 又只有按图片组/单图分裂的旧重生成工具。用户无法从统一资产 identity 表达“删除后重做”或“原地重生成”，调用方也可能用 create 新增同义资产。当前五条顶层 delete 收敛为 `delete_asset` 并统一经过 scoped `removeAsset`；两个旧重生成 Operation 收敛为 `regenerate_asset`，复用既有 generation planner、共享资产 writer 和 asset identity。variant 删除不属于顶层资产入口，仍保留其精确 parent/variant 契约。
- `delete_asset` 收敛完成后，旧资产 generation 父 pack 在 `0c5c954e5` 被整体删除，
  但独立 `domains/asset/delete.ts` 与六条生产 API route 继续存在；生产 registry 因此完全
  漏接该 Operation，既有 conformance 只能验证“已经注册的实例”，无法发现整个实例消失，
  所有顶层删除最终都以 `OPERATION_NOT_FOUND` 失败。当前将现有
  `createAssetDeleteOperations()` 作为独立 `['asset']` pack直接接回唯一生产 registry，
  不复制 Operation 或恢复 generation 父 pack；Project/Asset Hub/generic route仍只调用
  同一个 `delete_asset`。后续删除或重组父 pack必须枚举仍存活的生产 route operationId，
  不能以目录父子关系推断子实例已经退役。
- 资产管线曾让 Worker 直接给出实体 key，并在采用结果时同步创建图片任务；随后 canonical screenplay 又提前登记生产资产候选，使剧本身份、资产筛选、数据库 identity 和媒体生命周期彼此耦合，剧本漏登时下游无法补救。当前 asset manifest 是生产资产范围唯一 owner，服务端生成稳定 manifest identity，共享 Project asset writer 唯一建立领域 identity，manifest adoption 只采用，`create_image` 只生成并在终态绑定。当前验证盲区是真实 MySQL 下同名历史资产与新 `manifestAssetId` 并发采用的完整竞争组合。
- Asset Worker 曾输出自由媒体生成文本，服务端又追加固定资产格式后缀；旧 `constants.ts` 同时保留相反的 16:9、左全身右特写、非白底规则。三个 writer 让同一次执行同时要求不同画幅和构图，逐字剥离旧 policy 的 helper 也只能删除完全相同字符串，无法消除 Worker 自由措辞。当前 Manifest 删除最终 Prompt 字段，旧 suffix/helper 一次性删除，服务端 Compiler 成为唯一 writer；真实 Provider 对固定构图的服从度仍需生成样本复验。
- 媒体读取权限收紧后，外部下载仍有两套解释：`outbound-image` 允许配置 hostname 绕过私网检查，storage/media-process 又直接 fetch Provider result。该分裂既允许跨端口访问内部服务，也留下 DNS 预检与连接解析的竞态。当前 owner relation 与网络目标 policy 明确分层，所有主动 body 下载复用同一 socket-pinned 出口；目标部署桶的真实签名域名与 DNS/代理组合仍是发布复验边界。

## 修改检查表

- 是否把完整的 scope、owner、project、kind、asset 和 variant identity 传给共享 resolver，而不是只传裸 ID？
- 新增的 child/variant 是否通过 parent foreign key 验证，且没有“最近记录”或独立 ID 查询旁路？
- mutation、plan、Task、upload 或 storage 副作用是否全部发生在 ownership 校验之后？
- copy 是否在同一事务中先验证 source 与 target，再完成删除、替换和 source association？
- missing、foreign、wrong-kind、cross-parent 是否都在副作用前以不泄露存在性的错误失败？
- destructive helper 是否仍只能从 `asset-actions.ts` 的 scoped 入口调用？
- 是否把“关系删除”误写成 storageKey 物理删除？除本次失败上传的唯一临时 key 外，领域操作不得承担媒体 GC。
- 如果新增资产 kind 或 variant，是否同步更新 resolver、`docs/architecture/modules.json` 的实际路径，并按风险判断现有 MySQL/security 证据是否仍适用？
- manifest adoption 是否只调用共享 Project asset writer 并更新 Binding，没有创建图片 Task？图片是否仍只经 `create_image` 和终态 Binding？
- 是否默认不新增测试，并明确人工或自动验证边界？
