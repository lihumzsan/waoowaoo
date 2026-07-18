# 自由配音设计

## 目标

在小说推文项目的“成片”页面增加一个独立的“自由配音”折叠栏，让用户可以：

- 直接输入需要朗读的文字。
- 选择项目角色，并自动带出该角色的默认参考音色。
- 手动改选其他带参考音频的音色。
- 使用项目当前的 ComfyUI 语音工作流生成音频。
- 对同一段文字反复生成多个版本。
- 试听和下载任意已完成版本。
- 选中满意版本后，仅保留该版本并删除其他版本。
- 在同一项目中长期保存多条彼此独立的自由配音记录。

自由配音不进入正式台词列表，不绑定镜头，也不参与成片的台词、字幕或批量配音流程。

## 非目标

- 第一版不支持 Fal、百炼或其他非 ComfyUI 语音提供商。
- 不做跨提供商音色兼容或自动转换。
- 不把自由配音加入 `NovelPromotionVoiceLine`。
- 不把自由配音自动写入时间线、字幕、镜头或视频编辑器。
- 不支持在已有记录中修改文字、角色或音色。
- 不增加情绪提示词、情绪强度、语速或其他高级参数。
- 不增加自由配音专属模型选择器。
- 不提供多选、批量下载或批量删除。

## 已确认的产品决策

### 页面位置

采用独立折叠栏方案：

- “自由配音”与现有“台词配音”处于同一级别。
- 新折叠栏放在“台词配音”下方、视频卡片区域上方。
- 它拥有独立的数据加载、任务状态和展开状态，不修改 `VoiceStage` 的数据结构。

### 记录与版本

- 一条自由配音记录代表一段不可变的文字、角色和音色组合。
- 第一次生成时创建记录及版本 1。
- “重新生成”只新增版本，不覆盖旧版本。
- 用户修改文字、角色或音色后点击生成，必须创建新记录。
- 项目可以保存任意多条自由配音记录。
- 每条记录的版本号从 1 开始递增。
- 记录按创建时间倒序展示；版本按版本号倒序展示。

### 选中与清理

- 版本选择使用单选交互。
- 选择只保存在当前页面状态中，不单独持久化“已选中”标记。
- 用户必须点击“仅保留此版本”并通过二次确认，才执行永久清理。
- 清理成功后，同一记录只剩被保留版本。
- 即使只剩一个版本，用户仍可继续生成新版本。

## 当前代码约束

现有台词语音链路不能直接用于自由配音：

- `/api/novel-promotion/[projectId]/voice-generate` 要求 `episodeId` 和 `lineId`。
- `generateVoiceLine` 会读取 `NovelPromotionVoiceLine`、剧集和分镜上下文。
- 生成完成后会直接更新正式台词的 `audioUrl` 和 `audioDuration`。
- 当前 `voice_line` 任务的目标类型是 `NovelPromotionVoiceLine`。

因此自由配音必须使用独立记录、独立 API 和独立任务目标，不能通过创建隐藏台词来复用现有接口。

## 总体架构

```text
FreeVoicePanel
  -> 自由配音查询与变更 hooks
  -> 项目级 free-voices API
  -> 创建记录/版本 + 提交 free_voice 任务
  -> 现有 voice Queue
  -> voice Worker 的 FREE_VOICE 分支
  -> ComfyUI 自由配音生成服务
  -> 项目对象存储 + MediaObject + FreeVoiceVersion
  -> Task SSE 驱动前端刷新
```

自由配音复用以下现有基础设施：

- 项目权限校验。
- 项目角色和全局音色查询。
- 用户模型配置解析。
- ComfyUI 基础地址、工作流解析、参考音频上传和执行客户端。
- BullMQ 语音队列、Task 表、任务事件和 SSE。
- 对象存储和 `MediaObject` 稳定媒体地址。

它不复用 `generateVoiceLine` 的正式台词读取和持久化部分。

## 数据模型

### `NovelPromotionFreeVoiceRecord`

一条记录保存不可变的生成输入：

```prisma
model NovelPromotionFreeVoiceRecord {
  id                      String   @id @default(uuid())
  novelPromotionProjectId String
  text                    String   @db.Text
  characterId             String?
  characterName           String
  voiceSourceType         String
  voiceSourceId           String?
  voiceName               String
  referenceAudioUrl       String   @db.Text
  referenceAudioMediaId   String?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @default(now()) @updatedAt

  novelPromotionProject NovelPromotionProject @relation(fields: [novelPromotionProjectId], references: [id], onDelete: Cascade)
  referenceAudioMedia   MediaObject? @relation("NovelPromotionFreeVoiceReferenceAudioMedia", fields: [referenceAudioMediaId], references: [id], onDelete: SetNull)
  versions              NovelPromotionFreeVoiceVersion[]

  @@index([novelPromotionProjectId, createdAt])
  @@index([referenceAudioMediaId])
  @@map("novel_promotion_free_voice_records")
}
```

字段语义：

- `text` 在创建后不可编辑。
- `characterId` 用于追踪来源角色；角色被删除后记录仍保留，因此同时保存 `characterName` 快照。
- `voiceSourceType` 第一版只允许 `character` 或 `global_voice`。
- `voiceSourceId` 记录来源实体 ID，便于审计。
- `voiceName` 保存展示快照。
- `referenceAudioUrl` 和 `referenceAudioMediaId` 保存实际生成所使用的参考音频快照。

### `NovelPromotionFreeVoiceVersion`

每次生成对应一条版本记录：

```prisma
model NovelPromotionFreeVoiceVersion {
  id            String   @id @default(uuid())
  recordId      String
  versionNumber Int
  audioModel    String
  audioUrl      String?  @db.Text
  audioMediaId  String?
  audioDuration Int?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @default(now()) @updatedAt

  record     NovelPromotionFreeVoiceRecord @relation(fields: [recordId], references: [id], onDelete: Cascade)
  audioMedia MediaObject? @relation("NovelPromotionFreeVoiceVersionAudioMedia", fields: [audioMediaId], references: [id], onDelete: SetNull)

  @@unique([recordId, versionNumber])
  @@index([recordId, createdAt])
  @@index([audioMediaId])
  @@map("novel_promotion_free_voice_versions")
}
```

生成中、失败和完成状态以现有 `Task` 记录为准。任务目标为：

```text
type       = free_voice
targetType = NovelPromotionFreeVoiceVersion
targetId   = <version id>
```

版本表只保存业务结果，不重复维护另一套任务状态机。

同时在既有模型补充反向关系：

- `NovelPromotionProject.freeVoiceRecords`。
- `MediaObject.novelPromotionFreeVoiceReferenceAudios`。
- `MediaObject.novelPromotionFreeVoiceVersionAudios`。

## ComfyUI-only 语音生成

### 模型选择

- 自由配音不显示独立模型选择器。
- 提交时解析项目当前 `audioModel`；没有项目值时沿用现有用户默认模型解析规则。
- 解析结果的 provider 必须是 `comfyui`。
- 如果当前语音模型不是 ComfyUI，提交前返回明确错误，要求用户先在现有语音模型选择器中切换到 ComfyUI。
- 每个版本保存实际使用的 `modelKey`，后续修改项目模型不会改变历史版本信息。

### 工作流选择

- 使用现有 `resolveComfyUiVoiceLineWorkflowKey` 相同的单人工作流回退规则。
- 自由配音一次只朗读一个角色，因此多人工作流映射到对应单人工作流。
- ComfyUI prompt 直接使用记录中的朗读文字。
- 参考音频数组只包含记录保存的一个参考音频。
- 第一版不调用正式台词的分镜上下文提示词构建器。

### 音色来源

角色选择器只列出当前项目角色。

选择角色后：

1. 默认读取角色的 `customVoiceUrl` / `customVoiceMediaId`。
2. 角色没有参考音频时，显示“请先为角色设置参考音色”，并禁用生成。
3. 用户可打开音色选择器更换音色。

手动音色选择器：

- 复用现有全局音色查询和试听能力。
- 只展示存在 `customVoiceUrl` 或对应媒体引用的音色。
- 不展示只有百炼 `voiceId`、没有参考音频的音色。
- 选择后不修改角色默认音色，只影响当前新建记录。

## API 设计

### `GET /api/novel-promotion/[projectId]/free-voices`

返回当前项目的全部记录、版本、稳定媒体 URL 和各版本当前任务状态。

### `POST /api/novel-promotion/[projectId]/free-voices`

请求：

```json
{
  "text": "需要朗读的文字",
  "characterId": "character-id",
  "voiceSourceType": "character",
  "voiceSourceId": "character-id"
}
```

行为：

1. 校验项目权限。
2. 服务端重新读取角色、音色和参考音频，禁止客户端直接指定任意音频 URL。
3. 校验文字去除首尾空白后非空。
4. 校验当前语音模型是 ComfyUI。
5. 创建记录和版本 1。
6. 提交 `FREE_VOICE` 任务并返回任务 ID。

如果任务提交失败，删除本次尚未开始的版本；若它是记录的唯一版本，同时删除空记录。

### `POST /api/novel-promotion/[projectId]/free-voices/[recordId]/versions`

为指定记录创建下一个版本并提交任务。

- 文字、角色和音色全部读取记录快照，客户端不能覆盖。
- 使用事务分配下一个 `versionNumber`。
- 唯一索引负责防止并发生成得到重复版本号。
- 同一记录允许多个版本排队，但 UI 在一次提交完成前禁用重复点击。

### `POST /api/novel-promotion/[projectId]/free-voices/[recordId]/keep-version`

请求：

```json
{ "versionId": "version-id" }
```

行为：

1. 校验记录属于当前项目，版本属于当前记录。
2. 若该记录存在 queued 或 processing 的自由配音任务，拒绝清理。
3. 收集其他版本的对象存储 key。
4. 调用现有批量存储删除；只有存储删除全部成功后才删除数据库版本行和对应无引用媒体行。
5. 返回仅剩版本的最新记录数据。

对象存储删除是幂等操作。若发生部分失败，接口返回失败且保留数据库记录，用户可重试清理。

### `DELETE /api/novel-promotion/[projectId]/free-voices/[recordId]`

- 校验项目归属。
- 有 queued 或 processing 任务时拒绝删除。
- 删除所有版本音频后删除记录；版本通过级联删除。
- 使用二次确认防止误删。

### 下载

- 不增加专用下载 API。
- 已完成版本返回 `MediaObject` 的 `/m/<publicId>` 稳定地址。
- 下载按钮使用带有记录时间和版本号的安全文件名。

## 任务系统

新增：

```ts
TASK_TYPE.FREE_VOICE = 'free_voice'
```

需要同步更新：

- `TaskType` 联合类型。
- voice queue 类型集合。
- task intent 映射。
- 任务类型和阶段的中英文文案。
- voice Worker switch。

Worker 流程：

```text
received
  -> 读取版本、记录和项目
  -> 再次校验 ComfyUI 模型与参考音频
  -> 上报 generate_free_voice_submit
  -> 执行 ComfyUI 单人音频工作流
  -> 上传 voice/free/<projectId>/<recordId>/<versionId>.<ext>
  -> 创建/复用 MediaObject
  -> 更新版本 audioUrl、audioMediaId、audioDuration、audioModel
  -> 上报 generate_free_voice_persist
```

Worker 必须在外部生成前后调用现有取消检查。版本或记录在任务开始前不存在时，任务失败且不得创建孤立音频。

## 前端设计

### `FreeVoicePanel`

作为 `VideoTimelinePanel` 的同级组件插入视频阶段。

折叠栏头部显示：

- “自由配音”。
- 当前记录数量。
- 正在生成的版本数量。

展开后包含两个区域。

### 新建区

- 角色下拉框。
- 音色选择框。
- 朗读文字输入框。
- “生成”按钮。

交互规则：

- 选择角色后自动带出默认参考音色。
- 手动更换音色不修改角色资产。
- 输入或选择未满足要求时禁用生成并显示原因。
- 提交成功后清空输入框，并将新记录插入列表顶部。

### 记录列表

每条记录显示：

- 朗读文字摘要，展开后显示全文。
- 角色名和音色名快照。
- 创建时间。
- 版本数量和生成中数量。
- “生成新版本”和“删除记录”操作。

每个版本显示：

- 版本号。
- 实际模型。
- 生成时间。
- 音频时长。
- 任务状态或错误信息。
- 单选、试听和下载操作。

选中版本后显示“仅保留此版本”。清理和删除按钮在该记录存在活动任务时禁用。

## 查询与实时状态

- 为自由配音增加独立 query key，不复用 `voiceLines` 缓存。
- 创建、重新生成、清理和删除成功后只失效自由配音查询。
- 使用现有 Task SSE 和 target-state 查询追踪 `NovelPromotionFreeVoiceVersion`。
- 页面刷新后，服务端返回版本及 Task 状态，恢复 queued、processing、failed 和 completed 展示。
- 任务完成事件只刷新自由配音查询，不刷新正式台词和分镜数据。

## 删除和项目清理

- “仅保留此版本”和“删除记录”都必须删除数据库记录与对象存储音频。
- 删除整个项目时，现有项目对象收集逻辑必须加入自由配音版本的存储 key。
- `NovelPromotionProject` 删除时通过级联删除自由配音记录和版本。
- `MediaObject` 只在没有其他业务引用时删除；对象存储 key 的删除使用现有幂等接口。

## 错误处理

### 提交前错误

- 文字为空。
- 未选择角色。
- 角色不存在或不属于项目。
- 所选音色不存在参考音频。
- 当前语音模型不是 ComfyUI。
- ComfyUI 未配置基础地址。

### 生成错误

- ComfyUI 不可达、工作流不存在、参考音频上传失败或输出不是音频时，任务进入 failed。
- 失败版本保留，显示标准化错误，并允许再次生成新版本。
- 失败版本没有音频时不可试听、下载或被选为唯一保留版本。
- 一个版本失败不影响同记录的成功版本。

### 删除错误

- 活动任务存在时拒绝删除或清理。
- 存储删除失败时不删除数据库版本，返回可重试错误。
- 删除接口重复调用必须保持幂等。

## 测试策略

### 数据模型和迁移

- 项目可拥有多条自由配音记录。
- 记录可拥有多个连续版本。
- 同一记录不能出现重复版本号。
- 删除项目级联删除记录和版本。
- 媒体引用使用 `SetNull`，不因媒体元数据异常阻止项目删除。

### API 合约

- 只能访问当前用户拥有的项目数据。
- 创建记录时服务端重新解析角色和音色。
- 非 ComfyUI 模型被拒绝。
- 没有参考音频的角色或全局音色被拒绝。
- 重新生成不能覆盖记录输入。
- 保留版本不能引用其他记录的版本。
- 活动任务期间不能清理或删除。
- 存储删除失败时数据库记录仍存在。

### Worker

- 正确向 ComfyUI 传递文字和一个参考音频。
- 多人工作流正确回退到单人工作流。
- 音频上传路径包含项目、记录和版本 ID。
- 生成结果写入正确版本和 `MediaObject`。
- 取消、失败和记录缺失时不写入错误目标。

### 前端

- 选择角色自动带出默认音色。
- 音色选择器只显示带参考音频的音色。
- 创建新记录后输入区清空。
- 多记录、多版本按规定排序。
- 页面刷新后恢复活动任务和失败状态。
- 单选版本、二次确认、保留版本、删除记录、试听和下载行为正确。
- 正式台词列表不会出现自由配音记录。

### 回归和实时验收

- 原有单条台词生成、批量生成、重新生成和下载测试保持通过。
- 使用真实项目创建两条不同文字的自由配音记录。
- 其中一条连续生成三个版本。
- 试听并下载任意版本。
- 保留其中一个版本，确认其他数据库记录和存储对象已删除。
- 刷新页面后确认两条记录仍存在，且清理后的记录只剩一个版本。
- 确认镜头、正式台词、字幕和成片数据没有变化。

## 实施边界

推荐把改动限制在以下职责单元：

- Prisma 模型和迁移。
- ComfyUI 自由配音服务。
- 自由配音 API。
- `FREE_VOICE` 任务分发和 Worker handler。
- 自由配音查询 hooks 与组件。
- 视频阶段中的新折叠栏挂载点。
- 项目删除时的存储 key 收集。
- 任务、API、Worker、前端和回归测试。

不重构与本功能无关的台词、视频或资产模块。

## 成功标准

以下条件全部满足才算完成：

1. 自由配音记录不会出现在正式台词、镜头、字幕或时间线中。
2. 项目可以长期保存多条不同文字的自由配音记录。
3. 同一记录可以长期保存多个 ComfyUI 音频版本。
4. 选择角色会自动带出默认参考音色，也可以改选其他参考音色。
5. 生成中刷新页面不会丢失任务状态。
6. 每个成功版本都可以试听和下载。
7. “仅保留此版本”会永久删除其他版本的数据和存储音频。
8. 删除记录会删除其全部版本和存储音频。
9. 项目删除会清理自由配音音频。
10. 原有正式台词配音行为和测试保持不变。
