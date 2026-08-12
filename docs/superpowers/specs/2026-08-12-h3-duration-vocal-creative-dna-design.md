# H3 4–15 秒、口型意图与导演机制增强设计

## 背景

Waoowaoo 已通过 `comfyui::minimax-h3-fast` 支持 MiniMax H3 的 `first_frame` 与 `first_last_frame` 视频生成，并由唯一的 `video-direction` Skill 直接编写 Provider-ready Prompt。当前实现仍有三处缺口：

1. H3 capability、adapter 和 workflow profile 把最小时长声明为 5 秒，而用户已经在当前本机 ComfyUI H3 节点验证 4 秒可以提交并生成对应时长产物。
2. 视频生成合同没有区分“原生对白”“为后期替换配音生成口型”“画外音”“完全无声且无口型”。后期 `audioMode=mute` 只能删除音轨，不能消除视频生成阶段已经产生的嘴部运动。
3. 外部 `minimax-h3-prompt-skill-T8` 仓库包含有价值的可行性、连续性、因果和修复机制，但也混合了当前项目不支持的输入模式、其他模型语法和多份输出格式，不能直接安装。

本设计在既有单 Agent、单视频专业 Skill 和 Provider 原样执行边界内补齐以上能力。

## 目标

- 将当前 ComfyUI H3 的合法整数时长统一为 4–15 秒。
- 为每个视频 Segment 显式建模声音表演与口型意图，默认保持现有原生对白行为。
- 让项目可持久化默认口型意图，单个视频生成 item 可显式覆盖。
- 让最终解析后的口型意图进入任务冻结输入和 Resource provenance，但不作为 Provider generation option 发送。
- 将外部仓库中跨题材、跨模型有效的导演机制压缩进现有 `video-direction`，使视频导演运行时自动使用。
- 保持 H3 Prompt 的 `non_diegetic_music: N/A` 和独立 BGM 生产链路不变。

## 非目标

- 不安装或复制外部 Skill 仓库。
- 不增加 H3 的 T2VA、L2VA、Ref2VA 或普通 reference 输入模式。
- 不引入 Seedance 或其他视频模型的 Prompt 语法。
- 不让 Provider adapter 编译、修补或重写 Prompt。
- 不让后期 `audioMode` 反向推断视频生成阶段的口型意图。
- 不自动创建替换配音文件，也不改变现有视频合成操作的音频模式合同。
- 不重复提交真实 4 秒 ComfyUI 任务；该运行时事实采用用户已经完成的验证。
- 不在本次变更中调整跨 Shot 对白的 `<scenetrans>` 写法；该细节继续沿用当前已交付规则，待独立真实 A/B 结果后再决定。

## 权威边界

- `src/lib/ai-providers/comfyui/models.ts` 拥有当前 H3 可选择的离散时长能力。
- `src/lib/ai-providers/comfyui/adapter.ts` 和 `profiles.ts` 拥有 Provider 提交与 workflow graph 的确定性时长校验。
- `Project` 保存项目级导演默认值；`ProjectProductionContext.productionDefaults` 将其只读投影给当前 Turn。
- `video_generation_batch.items[*].vocalPerformanceMode` 是单 Segment 的显式覆盖。
- create-video Planner 解析 `item override ?? project default`，冻结最终模式并把它纳入输入指纹。
- `video-direction` 是唯一负责根据最终模式编写 Prompt 画面、对白和口型指令的专业 Skill。
- `generationOptions` 只保存和传递 Provider 选项。`vocalPerformanceMode` 是导演意图，必须使用独立字段，不能混入 Provider 选项。
- `video-merge audioMode` 只控制最终合成音轨；它不改变已经生成的画面表演。

## 采用方案

采用“项目默认 + item 覆盖 + Planner 冻结 + 单 Skill 执行”的分层方案。

拒绝仅修改 Skill 文本，因为服务端无法确定任务采用了哪种口型策略，也无法稳定重试和审计。拒绝直接安装外部 Skill，因为其支持范围和输出合同大于当前 Wao 运行时，并会与严格 `video_generation_batch` 冲突。拒绝把模式放入 `generationOptions`，因为视频 handler 会把其中的标量继续传给 Provider。

## 数据模型与合同

### `VocalPerformanceMode`

在视频生成合同附近定义并复用以下穷尽类型与 Zod schema：

```ts
export const VOCAL_PERFORMANCE_MODES = [
  'native_dialogue',
  'lip_sync_for_replacement',
  'voiceover',
  'silent_no_lip',
] as const

export type VocalPerformanceMode = (typeof VOCAL_PERFORMANCE_MODES)[number]
```

语义如下：

| 模式 | H3 Prompt 行为 | 可见人物口型 | 后期音频建议 |
| --- | --- | --- | --- |
| `native_dialogue` | 来源有对白时使用原文 `<d>` | 对白说话人自然口型 | `preserve` 或 `mix` |
| `lip_sync_for_replacement` | 使用最终替换配音的逐字文本 `<d>` | 与替换文本对应的口型 | `replace` |
| `voiceover` | 画外来源使用 `<d>` | 所有可见人物保持闭嘴 | `preserve`、`mix` 或 `replace` |
| `silent_no_lip` | 禁止 `<d>`、`<cutoff>`，明确闭嘴 | 无对白口型 | `mute` |

后期建议是导演与合成阶段的一致性规则，不是 create-video 自动副作用。系统不得因为最终 merge 选择了 `mute`，就假设此前生成的视频没有口型。

### 项目默认

`Project` 增加非空字段。数据库和项目配置使用带 `video` 前缀的名称，避免与音乐生成的 `vocalMode` 混淆：

```prisma
videoVocalPerformanceMode String @default("native_dialogue") @db.VarChar(32)
```

项目配置读取结果增加同名强类型字段。数据库中的未知值必须作为配置错误拒绝，不能静默回落。迁移使用 `native_dialogue` 回填既有项目，因此旧项目行为不变。

`update_project_config` 增加显式 `video_vocal_performance_mode` command 和 `videoVocalPerformanceMode` API 字段。只有四个枚举值合法。它是产品导演默认而非自带凭据的 Provider 配置，因此本地与云端部署均允许修改。

### 项目生产上下文

`ProjectProductionContext` 增加与能力分离的默认值区域：

```ts
readonly productionDefaults: {
  readonly video: {
    readonly vocalPerformanceMode: VocalPerformanceMode
  }
}
```

上下文 schemaVersion 从 6 升为 7。`productionCapabilities.video` 不增加该字段，因为它不是模型能力。上下文版本 hash 自然包含默认值变化。

### 视频生成 item

新建与失败修订 item 均增加可选覆盖：

```ts
vocalPerformanceMode: vocalPerformanceModeSchema.optional()
```

字段保持可选是为了接受旧保存文档和旧调用方。`video-direction` 对新生成的 `video_generation_batch` 必须在每个 item 中显式写出已选择模式；Planner 仍以项目默认兜底，不能依赖 Agent 总是正确填写。

`videoGenerationBatchOutputSchema.schemaVersion` 保持 2。该变更是向后兼容的可选字段扩展，无需让既有保存文档因版本字面值失效。

### 冻结任务与 Resource provenance

Planner 对每个视频 item 计算：

```ts
const resolvedMode = item.vocalPerformanceMode
  ?? projectProductionDefaults.video.vocalPerformanceMode
```

解析后的值必须：

- 进入 `WorkspaceResourceGenerationTaskPayload.vocalPerformanceMode`，并且对视频任务为必需、对非视频任务禁止。
- 进入 `generationInputFingerprint`，确保同 Prompt、同 Provider 选项但口型意图不同的请求不会共享 dedupe identity。
- 在 pending Resource 与最终 Resource provenance 中保存到独立 `vocalPerformanceMode` 字段。
- 被 `revise_failed` 和 `rerun_failed` 保留；显式修订覆盖优先于原冻结值，未覆盖时使用原冻结值，而不是读取可能已经变化的项目默认。
- 不进入 `generationOptions`，视频 task handler 也不把它传给 AI Provider。

`WorkspaceResource` 增加 nullable `vocalPerformanceMode`，用于兼容历史资源和非视频资源。新视频 Resource 必须写入非空合法值；非视频 Resource 保持 null。Resource view contract 投影该字段，便于后续合成决策和审计。

## H3 时长统一

当前 H3 的权威整数时长集合改为：

```text
[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
```

同步修改：

- capability catalog 的 `durationOptions`。
- ComfyUI H3 adapter 的 duration validator：`min=4, max=15`。
- H3 profile 的 `H3_DURATION_MIN_SECONDS=4`。
- 项目生产上下文由 capability 自动得到 `minSegmentDurationSeconds=4`。

帧数继续使用现有 24fps、`17k+5` 网格对齐公式。4 秒的最小帧数为 96，对齐后为 107 帧。3 秒和 16 秒必须在确定性校验中拒绝。

## Prompt 行为

`video-direction` 先从项目默认和用户本轮明确要求决定每段模式，再把最终模式写入 item，并按该模式生成 Prompt。

### 原生对白

- 有来源对白时逐字使用 `<d>[Language]...</d>`。
- 保留稳定说话人 ID 和自然口型。
- 没有来源对白时不得为了满足模式凭空增加对白。

### 为替换配音生成口型

- 只有存在最终替换配音逐字稿时才使用该模式。
- `<d>` 中的文字必须与最终替换配音逐字一致；不能使用近义改写或临时占位台词。
- Prompt 仍允许 H3 产生原生音轨，但后期必须显式选择 `replace` 才能交付替换音频。
- 缺少最终逐字稿时停止构造该 item，并要求补充文本或改用其他模式。

### 画外音

- 使用明确的 off-screen voiceover 来源和 `<d>` 原文。
- 每个可见人物在相关时间块保持嘴唇完全闭合。
- 允许环境声和动作声；是否保留或替换画外音由后期显式决定。

### 无声且无口型

- Prompt 禁止 `<d>`、`<cutoff>` 和任何可听对白描述。
- 所有可见人物嘴唇保持闭合，不做说话、哼唱、耳语或跟读动作。
- `overall_soundscape: N/A`，`non_diegetic_music: N/A`。
- 如果来源包含对白，不能删除剧情事实后假装无事发生；在 batch `warnings` 中明确说明对白因用户选择没有交给视频模型执行。
- Planner 对 H3 `silent_no_lip` 增加最小结构校验：Prompt 中出现 `<d>`、`</d>` 或 `<cutoff>` 时拒绝。闭嘴表演和完整语义仍由 Skill 负责，不通过脆弱的英文固定句匹配校验。

ComfyUI H3 仍需要 `generateAudio=true`，所以 create-video 不尝试传递 false。无声交付由后期 `audioMode=mute` 保证；Prompt 约束负责避免生成对白和口型。

## 从外部仓库吸收的导演机制

不复制案例库和模型专用模板，只把以下短规则加入现有 `video-direction`：

### 可行性闸门

- 所有新动作、镜头和对白必须在 Segment 终点前完成并留下可读落点。
- 终点不能才开始建立新的镜头、动作或信息。
- 时间不足时优先删除镜头、伴随动作、手势或停顿，不压缩对白到不自然语速。

### 连续性与空间证明

- 需要时使用前景遮挡、视差、脚部接触、移动光影和连续环境声，证明主体真实处于空间中。
- 摄影机遵循人物位置、银幕方向和动作路线，不做与人物地理关系无关的漂移。
- 混合媒介继续明确轮廓、材质、比例、地面接触和场景光照稳定。

### 因果证明

- 先建立正常基线，再显示原因或证据，最后呈现人物反应。
- 反应必须由当前或前一可见事件触发；不从无信息画面直接跳到结果。
- 升级幅度有边界，并在动作或反应之后保留可读落点。

### 身份锚点

- 主要人物选取 2–3 个区分度高且互不冲突的稳定锚点。
- 避免堆叠大量相近、矛盾或会导致模型重新设计人物的审美形容词。

### 故障修复与反复制

- 对白拥挤：减少镜头、手势和停顿；不改写来源对白。
- 第二镜来不及出现：把切点提前，仍无空间时删除第二镜。
- 人物漂浮：补充遮挡、视差、脚部接触或移动光影中的必要证据。
- 运镜混乱：只保留一种主运镜。
- 手部穿插：明确接触几何，或换成不依赖复杂接触的动作。
- 身份漂移：减少形容词并强化少量稳定锚点。
- 借鉴案例只复用叙事机制；必须改变人物类别或关系、地点、路线几何、服装、对白目的、摄影、光线、道具接触和结尾中的足够多项，不能复刻案例表面内容。

这些规则直接进入 `video-direction`，因此 Wao 视频导演运行时会自动获得；不新增 Skill 路由，也不要求 Agent 另外调用外部能力。

## 错误处理

- H3 时长不在 4–15：Provider preflight 使用现有 invalid option 路径拒绝。
- 项目默认值未知：读取项目生产上下文失败，不能回退到 `native_dialogue`。
- item 覆盖值未知：Zod 在规划前拒绝。
- `lip_sync_for_replacement` 缺少最终逐字稿：Skill 停止构造可执行 item。
- H3 `silent_no_lip` 含对白标签：Planner 在报价和副作用前拒绝，并返回可由 Agent 修正的字段错误。
- 后期音频模式与建议不一致：不静默修改；由导演或合成请求明确告警并要求用户确认最终音频选择。

## 文件范围

预计修改：

- `prisma/schema.prisma` 及对应迁移：项目默认和 Resource provenance 字段。
- `src/lib/workspace-resource/generation-request.ts`：枚举、item override、输出 schema v3。
- `src/lib/workspace-resource/generation-contract.ts`：冻结任务字段与严格跨媒体校验。
- `src/lib/config-service.ts`、`src/lib/operations/domains/config/config-ops.ts`：项目默认读取和本地/云端写入。
- `src/lib/project-production-context.ts`：`productionDefaults` 和 schema v7。
- `src/lib/operations/domains/workspace-resource/generation-ops.ts`：解析、冻结、指纹、修订与重跑语义。
- `src/lib/workspace-resource/persistence.ts`、contracts/view projection：Resource provenance。
- `src/lib/ai-providers/comfyui/models.ts`、`adapter.ts`、`profiles.ts`：4–15 秒。
- `src/lib/creative-skills/skills/video-direction/SKILL.md` 和 registry 版本：四模式与通用导演机制。
- 对应 contract、unit 和 integration tests。

不修改 H3 workflow JSON，不改变 H3 模型文件、节点类型、分辨率、首帧/首尾帧引用合同或 BGM 生产链路。

## 验证策略

### 确定性自动验证

1. `resolveH3DurationFrames(4) === 107`；3 和 16 拒绝；既有 5、10、15 结果不变。
2. capability 声明完整包含 4–15，adapter 接受 4 并拒绝边界外值。
3. H3 项目上下文暴露最小时长 4、项目默认 `native_dialogue` 和 schemaVersion 7。
4. 项目配置只接受四个枚举值，迁移后既有项目使用 `native_dialogue`。
5. 新视频 item 显式覆盖优先；缺失覆盖使用项目默认。
6. 冻结任务、输入指纹、失败修订、失败重跑和 Resource view 保留解析后的模式。
7. `vocalPerformanceMode` 不出现在 Provider `generationOptions`，task handler 不把它发送给 Provider。
8. H3 `silent_no_lip` Prompt 含 `<d>`、`</d>` 或 `<cutoff>` 时在副作用前失败。
9. 现有 `native_dialogue` 请求缺失 item 字段时仍可规划，保持向后兼容。
10. 运行受影响 Vitest、Prisma generate/check、TypeScript typecheck 和 creative runtime materialization tests。

### Skill 行为评估

按 `writing-skills` 的压力场景先记录旧 Skill 基线，再使用同一组场景验证增强后的行为：

- 4 秒中文对白且同时要求转身和第二镜，检查是否主动降复杂度。
- 来源对白但选择 `silent_no_lip`，检查无 `<d>`、闭嘴、双 `N/A` 和 warning。
- 替换配音口型模式但没有最终逐字稿，检查是否停止而不是编造台词。
- 画外音覆盖可见人物反应，检查画外音原文保留且可见人物闭嘴。
- 人物在写实空间中漂浮风险，检查是否加入必要空间证明而非堆砌描述。
- 原因不可见但反应强烈，检查是否先补足来源已有的因果证据或停止，而非发明剧情。
- 给出外部案例要求“照着做”，检查是否只复用机制并改变表面创作要素。

行为评估使用清楚的违规判据和人工复核，不用搜索 Skill 是否含固定散文字符串代替效果验证。

### 明确跳过

- 不提交真实 ComfyUI 4 秒任务，不重复测量产物时长；用户已验证。
- 不把 `<scenetrans>` 新语法纳入本次验收。
- 不宣称 Prompt 规则能消除模型随机性；真实画面质量仍需后续小样观察。

## 完成定义

- 所有 H3 时长入口一致接受 4–15 秒并拒绝边界外值。
- 项目默认、单段覆盖、任务冻结、重试和 Resource provenance 对同一 `vocalPerformanceMode` 语义一致。
- 默认 `native_dialogue` 保持旧项目与旧请求行为。
- `silent_no_lip` 在 Prompt、口型意图和最终合成建议上明确无声，并且不会因后期静音掩盖已经生成的对白标签。
- Provider 只收到已有合法 generation options，不收到导演意图字段。
- 现有视频导演自动获得经过筛选的通用机制，不新增或安装外部 Skill。
- 聚焦测试与 typecheck 通过；任何仓库基线或环境失败单独如实报告。

## 参考

- 用户提供的本地 PDF：`C:\work\knowledge\手把手教你写 MiniMax-H3 提示词：从小白到出片高手，附赠一个系统提示词，让 AI 帮你写.pdf`
- 外部 Creative DNA 仓库：<https://github.com/T8mars/minimax-h3-prompt-skill-T8>
- MiniMax H3 Prompt Writing：<https://github.com/MiniMax-AI/H3-Prompt-Writing-Skill>
