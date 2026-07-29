<!-- architecture-module: audio-production -->

# 独立音乐生成、混音与角色音色

## 设计理念

音乐是可自由组合的音频 Resource，不是视频流水线中的固定阶段。音乐方向等创意判断由 `music-direction` Skill + `creative_work(outputKind=music_direction)` 完成；Primary 也可在用户意图已经充分明确时直接调用独立媒体 Operation。系统不自动从剧本生成 BGM plan，不在音乐 Task 完成后启动渲染，也不保存第二套声音工作流。

最终混音仍是确定性执行能力：它只消费调用方显式给出的精确视频/音频 Resources 与时间线。角色音色继续是独立的 `project.voice_reference` Resource，不自动进入对白或最终混音；只有 Primary 读取精确角色 Binding、Creative Worker 在唯一最终视频 Prompt 中显式引用且视频执行冻结该声音 Resource 时，才作为视频模型的参考音色。

## 不变量

- **AP-01 — 创意方向只有 Skill + Creative Worker。** 不存在 `BGM_DESIGN_PLAN`、固定 BgmDesign writer、`plan_episode_bgm_design` 或“规划完成后生成”链。需要专业音乐方向时，Primary 显式委派 `music_direction`；完整结果保存在 Creative Task/Resource，其 `score` 字段是唯一最终配乐执行指令（null=刻意不配乐）。后续是否生成仍由 Primary 另一次显式调用决定，但执行只传引用（`create_audio.request.kind=music_direction`），Primary 不改写、不压缩、不补充配乐指令。
- **AP-02 — 音乐生成是独立 Operation，且只铸造 BGM。** `create_audio` 每次调用恰好创建一个 `project.bgm_audio` Resource/Task：`schemaId` 不是 Agent 输入，由服务端固定；`generic.audio` 已从词汇表删除；音频请求没有 `count`/候选扇出（`supportsCandidates=false`，候选机制只保留在图片与视频），需要多条音频时由调用方发起多次独立请求。`request.kind=new` 只消费本次完整输入和显式 context Resources；`request.kind=music_direction` 是同一 planner 内的引用执行窄分支（CR-22）：只传完成的 `music_direction` Resource ID 与精确目标视频，服务端原样读取非空 `score.generationPrompt`、从视频真实时长导出 duration，null score、时长缺失或超出能力范围原地失败。`project.voice_reference` 属于专属入口词汇，只由 `generate_voice` 铸造，通用生成词汇表在 schema registry 用 dedicated-origin 排除集穷尽声明。两种输入都不要求 Chapter、Creative Direction 或固定剧本状态，也不自动调用混音。成功、失败和重试继续服从通用 Resource/Task 契约。
- **AP-03 — 没有隐藏媒体分析。** 除非用户明确请求一种分析能力，音乐方向不得观看视频帧、分析原生波形或最终混音来写第二份状态；输入 Resource 只按其显式用途和 lineage 被消费。
- **AP-04 — Provider 能力不是创作流程。** Agent-facing Operation 不接受 provider/model；模型由服务端配置解析。FAL Lyria 的 120–180 秒连续能力属于单次执行约束：短目标可生成后确定性裁切，范围内按目标生成，超范围调用原地失败或由 Primary 显式拆成多个独立请求。该限制不得被解释为 `>180s` 自动 Chapter/Story Canon/连续性分支。
- **AP-05 — 最终混音只消费精确输入。** 混音必须显式列出有序视频 Resource ID、可选音乐 Resource ID、时间范围和 automation；stitched video duration 是输出时长权威。所有输入先由服务端回库验证 owner/scope/content，统一 48 kHz、pad/trim/reset PTS 和显式 `-t`。不得从“当前 BGM”“最近音乐”或旧 BgmDesign 推断。
- **AP-06 — 声音能力不产生后续链。** 音乐 Task 终态只恢复 Primary；Choice 只处理当前音频选择决定；采用某个音频 Resource 不渲染视频。收费 Approval 只授权当前精确媒体计划，不能授权未来混音或渲染。
- **AP-07 — 被删除能力不得残留入口。** 旧固定 BGM plan/generate、环境音/音效规划、专用 Canvas stage、TaskType、worker writer、状态字段和 Workflow recommendation 必须删除；历史名字只可出现在迁移删除语句或历史说明。
- **AP-08 — 音色生成只有一个入口和固定模型。** `generate_voice` 每次创建一个新的不可变音色 Resource；Agent 只提交描述、试听文字、语言、显示名与可选绑定目标。服务端解析正式 Voice Design 模型，报价和结算按同一冻结试听文字计算。
- **AP-09 — 音色 Resource 与角色 Binding 解耦。** 音色事实只存在于 `CreativeResource(mediaType=audio,schemaId=project.voice_reference)`；`bind_voice` 复用 Binding service CAS 写 `role=character_voice + slotKey=characterId`。生成期间发生较新换绑时保留新 Resource 并返回显式 conflict。
- **AP-11 — 跨镜头稳定音色由 Primary 显式组合。** 同一角色的说话声音将出现在两个或以上不同镜头或独立视频生成段时，Primary 把稳定音色视为当前创作真正需要的身份参考；在委派最终 `video_prompt_set` 前检查 `character_voice` Binding，已有绑定则读取精确 Resource，缺失则按剧本、用户要求和已有角色事实调用 `generate_voice target=character`，Task 成功终态后重新读取精确 Binding。Primary 把声音 Resource 与音色设计描述作为 Worker source material，Worker 把精确 Resource ID 写入 Prompt Set，执行层按顺序映射为 `@AudioN`；试听文字不得成为剧情对白。单个孤立说话镜头不强制生成音色；执行层不设置有对白即必须绑定的门禁，只校验、冻结和传输调用方显式选择的 Resource，也不从角色名、最新音色或试听内容推断引用。
- **AP-10 — 删除不物理清理媒体。** `delete_asset(kind=voice)` 只允许删除未生成中、未绑定且未被 Lineage 引用的音色 Resource；MediaObject 仍由独立生命周期拥有。
- **AP-12 — 视频条件音乐生成由 capability registry 唯一裁决。** `create_audio` 只可在 `videoReference` 携带恰好一个 ready 视频 Resource 作为音乐模型的画面条件输入；是否允许只由生产 music capability 的 `maxReferenceVideos` 声明（缺失即不支持，提交前原地失败）。视频引用作为 `videoInputPositions` 冻结进 Task payload，worker 回库校验 owner/ready/mediaType 后经共享 outbound media 入口投影为有界 HTTPS 签名 URL，再交给 provider adapter；相对 route、storageKey 和 Data URL 均不得进入 Gateway。soundtrack 的时间边界跟随该视频的真实时长。整片配乐一次生成，不得拆段分别生成再拼接；不存在从“最近视频”或历史消息推断条件输入的路径。

## 权威入口

- 音乐创意知识与输出：`src/lib/creative-skills/skills/music-direction/**`、`src/lib/creative-worker/output-registry.ts`。
- 独立音频 Operation：`src/lib/operations/domains/creative-resource/generation-ops.ts` 的 `create_audio`（含 `request.kind=music_direction` 引用执行窄分支）；媒体执行复用通用 Task、Provider Gateway、计费与 Resource materializer。
- 音乐 Task 执行与视频条件装载：`src/lib/workers/music.worker.ts`；视频条件 soundtrack 的唯一 provider adapter：`src/lib/ai-providers/mureka/**`（上传、soundtrack/instrumental 提交与 `MUREKA:MUSIC` 轮询协议）。
- 模型时长能力：生产 capability registry 与 provider adapter；调用方不得复制范围。
- 确定性混音 primitive：`src/lib/video-compose/video-merge-audio.ts`；只由通用 `merge_videos` Resource Task 显式消费，没有固定最终渲染阶段。
- 角色音色：`src/lib/operations/domains/voice/voice-ops.ts`、`src/lib/voice/voice-resource-service.ts` 与共享 Binding service。

## 验证

- Toolset/Task conformance 应证明只有独立音乐生成入口，没有固定 BGM planner/generator pair 或自动下游提交。
- Provider contract 继续验证模型选择由服务端拥有、单次 120–180 秒能力及 wire contract；这不作为创作流程证据。
- Billing/Task/Resource 场景验证精确计划、冻结输入、失败重试和 Resource lineage。
- FFmpeg Critical 场景验证显式视频/音频 Resources 的确定性混音，不依赖旧 BgmDesign 当前状态。
- 自由组合 Golden 应覆盖“无音乐完成视频”“先生成音乐但不渲染”“显式混音”三种合法组合。

## 历史回归

- BGM 与环境音最初分别持久规划和生成；第一次收敛为 BgmDesign 一个 writer、一个生成 Operation 和一个混音 bus，虽然减少双轨，仍把“规划 → 两个候选 → 最终渲染”固化为连续流程。Skill + Subagent 上线后该 planner 又与 `music_direction` 并存。当前删除固定 BGM creative writer，只保留独立音乐 Resource 生成和确定性混音。
- 音乐模型时长曾被调用方复制成离散 options。当前连续范围只由 capability registry 声明；它约束一次 provider 请求，不决定作品是否需要 Chapter 或全局连续性。
- 最终混音曾因 AAC priming、不同 EOF 和 `-shortest` 挂起或截短。确定性执行仍统一服从 stitched duration、显式 `-t` 和 bounded FFmpeg；删除固定 BGM plan 不削弱该技术防线。
- 旧声音提案曾观看/听取最终视频并写语义状态，形成第二事实解释器。当前音乐创意只来自显式 Creative Task 输入，混音只处理技术事实。
- `music_direction` 初版 strict 输出只有 cue 时间线与总述，没有最终生成指令字段，music-direction Skill 却已教授「面向视频条件单次生成的最终描述」；Primary 只能把 cue 时间线压缩改写成一条 `create_audio` prompt，成为方向 Worker 之外的第二个配乐创意 writer，且「原样使用」无契约保证。当前 strict 输出新增必填可空 `score`（唯一最终配乐指令，null=刻意不配乐），执行改为 `create_audio.request.kind=music_direction` 引用窄分支：服务端直读 `score.generationPrompt`、按目标视频真实时长导出 duration、按 `maxReferenceVideos` 决定是否冻结视频条件输入（AP-12 权威不变）。配乐创意 writer 收敛为 1；真实模型对 `score` 契约的服从度仍是生成复验盲区。
- 角色音色与视频引用首次接入时只覆盖“已有 `character_voice` Binding 则传入”的条件分支。真实完整制作中，同一角色的对白跨多个镜头，但项目没有 Voice Resource、Binding 或 `generate_voice` Task；Primary 仍委派只含图片的 `video_prompt_set`，随后所有视频 Task 都以 `generateAudio=true + audioInputPositions=[]` 合法提交，现有 Tool conformance、Binding lifecycle 与媒体传输测试均未反证这个决策缺口。当前防线由双语 Primary Prompt 明确“跨镜头复用声音”是生成并绑定稳定音色的创作信号，同时保留单镜头自由组合和无执行层门禁；Prompt semantic guard 防止该判断静默丢失。真实外部模型是否稳定遵循仍是发布验证盲区。
- 固定流水线删除（skills 重构）时，final-render 的 BGM 混音基元被改名保留为 `video-merge-audio.ts`，但新架构只接回了分段源音频路径：`muxVideoMergeAudio` 等 BGM 函数失去全部生产调用方，Primary 能设计并生成整片配乐，却没有任何 Operation 能把 BGM 混入成片，双语 Prompt 也在“生成整片配乐”处断链且明确禁止主动配乐。集成测试只验证基元本身，未反证“能力仍有生产入口”。当前 `merge_videos` 按 AP-05 增加可选 `music` 输入（`role=bgm_audio` 冻结进 inputs/lineage，音量冻结在 generationOptions），worker 在 BGM 分支复用同一混音基元；双语 Prompt 把超过 60 秒完整成片的配乐设为默认交付评估（spotting 判断可得出刻意不配乐），并把混音步骤显式接到 `merge_videos music`。真实端到端组合（生成 BGM → 混音 → Canvas 展示）仍是未验证盲区。
- 固定 Qwen Voice Design 初次上线时，能力、价格、adapter 与 Binding 生命周期测试全部通过，但运行时启用模型清单没有登记该 `voice` identity，且 provider contract mock 掉了真实 runtime selection；首个真实三音色批次因此全部在 Provider HTTP 前失败。当前固定模型由 FAL production identity 同时进入 platform/API runtime catalog，真实 catalog selection 成为 provider contract 的前置断言。
- `generate_voice` 初版用两个同级可选字段表达新建与重生成，后来虽改成 `new|regenerate` 分支，仍把新的不可变内容挂到旧 Resource identity。当前每次生成只创建新 Resource；当前角色音色只由 Binding CAS 决定，不再存在原位重生成协议。

## 修改检查表

1. 是否只有 Skill + Creative Worker 负责音乐方向，没有固定 BGM planner？
2. 音乐生成是否是独立 Operation，终态不自动启动混音或渲染？
3. provider 的单次时长能力是否只作为执行约束，而非创作分支？
4. 混音是否只消费显式精确 Resources 与时间线？
5. 是否仍有旧 BgmDesign/环境音 Workflow、Task、Canvas 或 writer 回流？
6. 音色是否仍只由 `generate_voice` 与 Binding service 拥有，且 Primary 会为跨镜头复用的说话声音先取得精确 Binding、不会把单个孤立对白变成固定门禁？
