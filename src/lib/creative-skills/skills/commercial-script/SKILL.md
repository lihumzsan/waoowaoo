---
name: commercial-script
description: Write or revise an executable timed commercial video script from one exact commercial brief. Use for advertising, marketing, product-promotion, campaign, social-conversion, and corporate-promotion videos that need coordinated visuals, dialogue or voice-over, on-screen text, sound, transitions, end card, CTA, and an exact total duration.
---

# 商业视频脚本

## 目标

把一份精确 `commercial_brief` 转化为可直接供创意方向、资产和视频制作读取的连续时间脚本。脚本必须在固定总时长内完成传播任务，同时保持产品事实、主张、品牌约束和 CTA 与 Brief 一致。

## 输入权威

- 精确 commercial brief 独占商业目标、受众、产品事实、主张、渠道、品牌限制、必须元素、禁止主张和 CTA。
- 把该 Brief 的精确 `resourceId + contentVersion` 写入 `sourceBrief`，并在保存脚本时把同一版本作为 `role: "commercial_brief"` 的 Resource reference；禁止用路径或名称代替身份。
- 不从聊天记忆、文件名、最新文档、Canvas 位置或相似内容选择 Brief。目标不唯一时先读取或确认精确 Resource。
- 不增加 Brief 没有支持的性能、价格、优惠、销量、排名、资质、保证或 CTA。
- Creative Direction 只决定如何呈现；它不能改写商业事实或这份脚本已经确定的时间内容。

## 构造方法

1. 锁定 `targetDurationSeconds`。优先使用 Brief 对应交付物的明确时长；同一 Brief 有多个时长版本时，每个版本形成独立脚本，不把多个版本混在同一时间线。
2. 选择一个传播引擎：问题—解决、欲望—证明、使用场景—利益、对比—选择、产品演示—结果、品牌宣言，或更适合当前事实的结构。结构服务于目标，不机械套模板。
3. 设计开场：在目标平台允许的最短时间内给出与受众相关的扰动、利益、问题、视觉证据或产品行为。禁止用空泛 Logo 动画、寒暄或品牌自我介绍消耗开场。
4. 把信息分配到连续 `beats`：每一拍只承担可感知的推进，例如建立问题、展示产品行为、给出证据、说明利益、解除疑虑或完成 CTA。重复同一卖点而没有新证据或新语境时合并。
5. 为每拍分别写清：
   - `visual`：观众能看到的动作、产品状态、人物行为和必要构图信息；不要写抽象营销说明。
   - `dialogue` / `voiceOver`：只有实际存在时填写，否则为 `null`。两者并存时必须能在同一时段自然完成。
   - `onScreenText`：只保留观众必须读到的短文本；精确品牌、产品、限定语和 CTA 不得改写。
   - `sound`：必要环境声、产品声、对白关系或音乐功能；不替音乐 Skill 写完整配乐 Prompt。
   - `transition`：只有叙事或信息变化需要时填写，禁止用装饰性转场填满每拍。
6. 结尾 `endCard` 必须与 Brief 的 mandatory elements 和 CTA 一致。CTA 为 `null` 时不要自创购买或访问动作。
7. 检查实际演出时长：对白、旁白、动作、停顿和屏幕阅读共同占用同一时间轴。使用 creative-core 的时长估算纪律，不以表格行数假装时长。

## 时间线硬规则

- `sequence` 从 1 连续递增。
- 第一拍 `startSeconds` 为 0；后一拍必须从前一拍结束时间开始，不得重叠或留出未说明空洞。
- 每拍 `durationSeconds` 必须为正数。
- 最后一拍结束时间必须精确等于 `targetDurationSeconds`。
- 同时发生的画面、旁白、字幕和声音按同一时段计算，不重复相加。
- 需要不同渠道、语言、画幅或总时长的版本时，各自形成独立结果；不要把可选分支写进一份最终脚本。

## 商业表达质量

- 一个脚本只保留一个核心记忆点；辅助信息必须帮助相信或行动，不能与主张争夺注意力。
- 用可见行为和具体证据呈现利益。可以拍出的产品动作优先于形容词旁白。
- 字幕是画面的信息层，不是旁白逐字抄写；移动端字幕必须短、可读、与视觉焦点不冲突。
- 产品出现时机、演示强度和品牌露出由传播目标决定，不套用“第几秒必须露出”的固定规则。
- 若 Brief 要求法律限定语或准确产品说明，给它真实可读时间，不能藏在无法阅读的尾帧。
- 结尾必须完成 Brief 规定的观众动作或记忆结果，不用无来源促销制造虚假紧迫感。

## 自检

- 所有商业事实、主张、品牌写法、必须元素、禁止项和 CTA 是否逐条符合 Brief？
- 时间线是否从 0 连续到目标总时长，且实际表演与阅读能完成？
- 开场是否立即给目标受众一个继续观看的理由？
- 每拍是否带来新信息、证据、产品行为或决策推进？
- 画面、旁白、字幕和声音是否互补，而不是四次重复同一句话？
- 产品利益是否通过具体可见行为成立？
- 是否把创意方向、资产 Prompt、Provider 参数或任务状态写进了脚本？

## 边界

唯一专业结果是运行时注入 schema 约束的 `outputKind: "commercial_script"` 严格 JSON。不要另建 screenplay 或平行 Markdown 脚本。本 Skill 拥有商业内容与时间线，不拥有项目级呈现政策、资产身份、媒体 Prompt、模型选择、计费或 Task 生命周期。
