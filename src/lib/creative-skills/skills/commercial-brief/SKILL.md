---
name: commercial-brief
description: Build or revise a source-faithful commercial video brief from user goals and exact product, brand, channel, audience, offer, claim, legal, and delivery facts. Use for advertising, marketing, campaign, product-promotion, corporate-promotion, and conversion-video requirements before commercial scripting or production.
---

# 商业需求简报

## 目标

把用户目标与精确来源整理成一份可供商业脚本和后续生产共同使用的需求简报。简报回答“为什么做、对谁说、说什么、必须遵守什么”，不编写脚本、创意方向、镜头、资产设计或生成 Prompt。

## 事实纪律

- 用户原话和精确提供的 Resource 是产品、价格、活动、功能、性能、资质、品牌拼写、Logo、包装文字、法律限定和 CTA 的唯一事实来源。
- 不得发明、补强或美化可验证主张。来源只说“便捷”时，不得改成“最快”；来源没有数字时，不得增加百分比、排名、销量或时间承诺。
- 把每条会影响传播内容的事实写入 `sourceFacts`，`fact` 保留准确含义，`source` 使用用户能理解的来源标签。不要写 Runtime 路径、内部 ID 或未经提供的 URL。
- 无法验证但仍可撤回的创作性解释写入 `assumptions`；可能改变受众、主张、投放、承诺、CTA 或交付范围的缺口写入 `openQuestions`，不得伪装成事实。
- 用户明确要求研究或输入包含无法高置信解释的最新品牌、产品或活动时，先按主 Agent 的研究协议查证公开事实；研究不能替代用户对未公开价格、优惠、资质和品牌资产的确认。

## 收敛方法

1. 识别传播对象：产品、服务、品牌、活动或组织，并区分已验证事实与创作语言。
2. 识别商业目标：认知、理解、考虑、留资、购买、下载、到店、报名或内部传播。多个目标必须确定主次，不能用“提升影响力”代替可理解的目标。
3. 识别受众：只写会改变信息、语气、场景或渠道策略的群体特征。不要凭空补人口统计信息。
4. 提炼价值主张：以已验证事实解释受众为什么在乎；`keyMessage` 是观众看完应记住的一句话，不是形容词堆叠。
5. 明确 CTA：只有来源或用户支持时才写购买、下载、访问、咨询等动作；没有明确 CTA 时使用 `null`，不要自创优惠。
6. 建立交付清单：每个渠道/版本各写一个 `deliverables` 条目。用户给定时长、语言和画幅必须逐项保留；未知字段使用契约允许的 `null`，不得猜模型或 Provider 参数。
7. 收集约束：
   - `brandConstraints`：准确品牌名称、语调、颜色、Logo/包装使用、已有品牌规则。
   - `mandatoryElements`：必须出现的产品事实、限定语、尾版、字幕、人物或素材。
   - `prohibitedClaims`：明确禁止的主张，以及来源不足、当前不得表达为事实的承诺。
8. 检查简报内部一致性：目标、受众、主张、CTA、渠道和交付物不能互相冲突。

## 自检

- 每个产品事实、商业主张、价格、优惠、资质和 CTA 是否都有明确来源？
- `valueProposition` 是否解释受众利益，`keyMessage` 是否足够集中？
- 交付物是否完整保留用户指定的渠道、时长、语言和画幅？
- 品牌限制、必须元素和禁止主张是否互不重复且可执行？
- 是否把脚本、镜头、创意风格、资产设计或 Provider 参数误写进了简报？
- 缺口是否只进入 `assumptions` 或 `openQuestions`，没有被冒充为事实？

## 边界

唯一专业结果是运行时注入 schema 约束的 `outputKind: "commercial_brief"` 严格 JSON。不要另建平行 Markdown 简报。商业脚本必须使用一份精确、完整的 Brief；本 Skill 不拥有脚本时间线、创意方向、媒体生成或执行状态。
