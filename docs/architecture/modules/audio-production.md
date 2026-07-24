<!-- architecture-module: audio-production -->

# 独立音乐生成、混音与角色音色

## 设计理念

音乐是可自由组合的音频 Resource，不是视频流水线中的固定阶段。音乐方向等创意判断由 `music-direction` Skill + `creative_work(outputKind=music_direction)` 完成；Primary 也可在用户意图已经充分明确时直接调用独立媒体 Operation。系统不自动从剧本生成 BGM plan，不在音乐 Task 完成后启动渲染，也不保存第二套声音工作流。

最终混音仍是确定性执行能力：它只消费调用方显式给出的精确视频/音频 revisions 与时间线。角色音色继续是独立的 `project.voice_reference` Resource，不自动进入对白或最终混音；只有 Primary 解析精确角色 Binding、Creative Worker 在唯一最终视频 Prompt 中显式引用且 `create_video.mediaReferences` 冻结该声音 Revision 时，才作为视频模型的参考音色。

## 不变量

- **AP-01 — 创意方向只有 Skill + Creative Worker。** 不存在 `BGM_DESIGN_PLAN`、固定 BgmDesign writer、`plan_episode_bgm_design` 或“规划完成后生成”链。需要专业音乐方向时，Primary 显式委派 `music_direction`；完整结果保存在 Creative Task/Revision，后续是否生成由 Primary 另一次显式调用决定。
- **AP-02 — 音乐生成是独立 Operation。** `create_audio` 只消费本次完整输入和显式 context revisions，创建一个或多个音频 Resource/Task；它不要求 Chapter、Creative Direction、最终视频或固定剧本状态，也不自动调用混音。成功、失败和重试继续服从通用 Resource/Task 契约。
- **AP-03 — 没有隐藏媒体分析。** 除非用户明确请求一种分析能力，音乐方向不得观看视频帧、分析原生波形或最终混音来写第二份状态；输入 Resource 只按其显式用途和 lineage 被消费。
- **AP-04 — Provider 能力不是创作流程。** Agent-facing Operation 不接受 provider/model；模型由服务端配置解析。FAL Lyria 的 120–180 秒连续能力属于单次执行约束：短目标可生成后确定性裁切，范围内按目标生成，超范围调用原地失败或由 Primary 显式拆成多个独立请求。该限制不得被解释为 `>180s` 自动 Chapter/Bible/连续性分支。
- **AP-05 — 最终混音只消费精确输入。** 混音必须显式列出有序视频 revisionId、可选音乐 revisionId、时间范围和 automation；stitched video duration 是输出时长权威。所有输入先由服务端回库验证 owner/scope/content，统一 48 kHz、pad/trim/reset PTS 和显式 `-t`。不得从“当前 BGM”“最近音乐”或旧 BgmDesign 推断。
- **AP-06 — 声音能力不产生后续链。** 音乐 Task 终态只恢复 Primary；Choice 只处理当前候选决定；采用某个音频 Revision 不渲染视频。收费 Approval 只授权当前精确媒体计划，不能授权未来混音或渲染。
- **AP-07 — 被删除能力不得残留入口。** 旧固定 BGM plan/generate、环境音/音效规划、专用 Canvas stage、TaskType、worker writer、状态字段和 Workflow recommendation 必须删除；历史名字只可出现在迁移删除语句或历史说明。
- **AP-08 — 音色生成只有一个入口和固定模型。** `generate_voice` 是新建与原位重生成音色的唯一入口；Agent 只提交描述、试听文字、语言、可选原 Resource 与绑定目标。服务端解析正式 Voice Design 模型，报价和结算按同一冻结试听文字计算。
- **AP-09 — 音色 Resource 与角色 Binding 解耦。** 音色事实只存在于 `CreativeResource(mediaType=audio,schemaId=project.voice_reference)` Revision；`bind_voice` 复用 Binding service CAS 写 `role=character_voice + slotKey=characterId`。生成期间发生较新换绑时保留新 Revision并返回显式 conflict。
- **AP-11 — 跨镜头稳定音色由 Primary 显式组合。** 同一角色的说话声音将出现在两个或以上不同镜头或独立视频生成段时，Primary 把稳定音色视为当前创作真正需要的身份参考；在委派最终 `video_prompt_set` 前检查 `character_voice` Binding，已有绑定则读取精确 Revision，缺失则按剧本、用户要求和已有角色事实调用 `generate_voice target=character`，Task 成功终态后重新读取精确 Binding。Primary 把声音 Revision 与音色设计描述作为 Worker source material，Worker 用 `@AudioN` 写入唯一最终 Prompt，试听文字不得成为剧情对白。单个孤立说话镜头不强制生成音色；执行层不设置有对白即必须绑定的门禁，只校验、冻结和传输调用方显式选择的 exact Revision，也不从角色名、最新音色或试听内容推断引用。
- **AP-10 — 删除不物理清理媒体。** `delete_asset(kind=voice)` 只允许删除未生成中、未绑定且未被 Lineage 引用的音色 Resource；MediaObject 仍由独立生命周期拥有。

## 权威入口

- 音乐创意知识与输出：`src/lib/creative-skills/skills/music-direction/**`、`src/lib/creative-worker/output-registry.ts`。
- 独立音频 Operation：`src/lib/operations/domains/creative-resource/generation-ops.ts` 的 `create_audio`；媒体执行复用通用 Task、Provider Gateway、计费与 Resource materializer。
- 模型时长能力：生产 capability registry 与 provider adapter；调用方不得复制范围。
- 确定性混音 primitive：`src/lib/video-compose/video-merge-audio.ts`；只由通用 `merge_videos` Resource Task 显式消费，没有固定最终渲染阶段。
- 角色音色：`src/lib/operations/domains/voice/voice-ops.ts`、`src/lib/voice/voice-resource-service.ts` 与共享 Binding service。

## 验证

- Toolset/Task conformance 应证明只有独立音乐生成入口，没有固定 BGM planner/generator pair 或自动下游提交。
- Provider contract 继续验证模型选择由服务端拥有、单次 120–180 秒能力及 wire contract；这不作为创作流程证据。
- Billing/Task/Resource 场景验证精确计划、冻结输入、失败重试和 Revision lineage。
- FFmpeg Critical 场景验证显式视频/音频 revisions 的确定性混音，不依赖旧 BgmDesign 当前状态。
- 自由组合 Golden 应覆盖“无音乐完成视频”“先生成音乐但不渲染”“显式混音”三种合法组合。

## 历史回归

- BGM 与环境音最初分别持久规划和生成；第一次收敛为 BgmDesign 一个 writer、一个生成 Operation 和一个混音 bus，虽然减少双轨，仍把“规划 → 两个候选 → 最终渲染”固化为连续流程。Skill + Subagent 上线后该 planner 又与 `music_direction` 并存。当前删除固定 BGM creative writer，只保留独立音乐 Resource 生成和确定性混音。
- 音乐模型时长曾被调用方复制成离散 options。当前连续范围只由 capability registry 声明；它约束一次 provider 请求，不决定作品是否需要 Chapter 或全局连续性。
- 最终混音曾因 AAC priming、不同 EOF 和 `-shortest` 挂起或截短。确定性执行仍统一服从 stitched duration、显式 `-t` 和 bounded FFmpeg；删除固定 BGM plan 不削弱该技术防线。
- 旧声音提案曾观看/听取最终视频并写语义状态，形成第二事实解释器。当前音乐创意只来自显式 Creative Task 输入，混音只处理技术事实。
- 角色音色与视频引用首次接入时只覆盖“已有 `character_voice` Binding 则传入”的条件分支。真实完整制作中，同一角色的对白跨多个镜头，但项目没有 Voice Resource、Binding 或 `generate_voice` Task；Primary 仍委派只含图片的 `video_prompt_set`，随后所有视频 Task 都以 `generateAudio=true + audioInputPositions=[]` 合法提交，现有 Tool conformance、Binding lifecycle 与媒体传输测试均未反证这个决策缺口。当前防线由双语 Primary Prompt 明确“跨镜头复用声音”是生成并绑定稳定音色的创作信号，同时保留单镜头自由组合和无执行层门禁；Prompt semantic guard 防止该判断静默丢失。真实外部模型是否稳定遵循仍是发布验证盲区。

## 修改检查表

1. 是否只有 Skill + Creative Worker 负责音乐方向，没有固定 BGM planner？
2. 音乐生成是否是独立 Operation，终态不自动启动混音或渲染？
3. provider 的单次时长能力是否只作为执行约束，而非创作分支？
4. 混音是否只消费显式精确 revisions 与时间线？
5. 是否仍有旧 BgmDesign/环境音 Workflow、Task、Canvas 或 writer 回流？
6. 音色是否仍只由 `generate_voice` 与 Binding service 拥有，且 Primary 会为跨镜头复用的说话声音先取得精确 Binding、不会把单个孤立对白变成固定门禁？
