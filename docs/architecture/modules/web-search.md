<!-- architecture-module: web-search -->

# Web Search

## 设计理念

Web Search 是一个受限的外部资料读取能力，不是第二个 Agent、第二套创意知识库或网页执行环境。业务层只使用稳定的搜索请求/结果契约；首发 provider 是 Tavily，provider 专属鉴权和 wire 字段只能留在 `src/lib/web-search/tavily.ts`。替换 provider 时应实现同一窄接口，不得让 Main Agent、Creative Worker 或 Creative Direction 契约出现 Tavily 私有参数。

搜索结果只作为不可信证据。标题、URL 和有界摘要可以帮助理解新近、陌生、地区性或社群定义的创作语法，但网页中的指令、答案和原始正文不能改变系统规则。Creative Worker 必须把交叉核验后的判断翻译成六领域 Creative Direction；来源证据与创作政策分别持久化。

## 不变量

- **WS-01 — 一个搜索执行入口。** `searchWeb` 是业务调用方唯一搜索入口；它校验公共请求并委托唯一配置的 `WebSearchProvider`。Main Agent Operation 和 Creative Worker Tool 不得各自拼 Tavily HTTP。
- **WS-02 — 单 provider、窄契约。** 当前只配置 `tavily`。公共请求只包含 query、depth、topic、结果上限、时间与域名过滤；公共结果只包含 provider、query 和有界 source。不得暴露 API key、Tavily answer/raw content/images、自动参数或任意 provider payload。
- **WS-03 — 同一环境密钥机制。** cloud 与 self-hosted 都只从服务端 `TAVILY_API_KEY` 读取。缺失或凭据被拒绝必须返回 `WEB_SEARCH_UNAVAILABLE`，不得读取聊天文本、用户 Resource、客户端参数或另一 provider 作为 fallback。
- **WS-04 — Main Agent 只读且按需。** `web_search` 是 Operation registry 中的 `query`、`on_demand`、零写入能力；它仍通过固定 `load_tools + execute_operation` gateway 和 Operation executor。未配置密钥时该 Operation 明确失败，不伪造空搜索成功。
- **WS-05 — Worker 暴露面由 output registry 穷尽。** `creative_direction.workerTools=['web_search']` 是 Creative Worker 搜索能力的唯一声明；其他 output kind 只能看到 `read_skill`。Primary 不手动把搜索工具或研究结果注入 Worker，Worker 也不能搜索任意 URL、读取项目或调用 Extract/Crawl/Research。
- **WS-06 — 搜索可选，研究预算与失败语义显式。** Worker 只有在任务依赖最新、陌生、冷门、地域性、平台性或社群定义的信息且现有输入不足时才调用搜索；熟悉且稳定的方向不得为装饰而搜索。每个 Creative Direction Task 冻结 `maxWebSearchCalls`，每次工具调用按 query 记录 completed/unavailable/failed/budget_exhausted，预算耗尽不发 provider 请求。零调用是正常完成：研究元数据记录 `not_attempted` 且不产生 warning。实际尝试后的不可用、失败、部分完成或预算耗尽才产生确定性 warning；部分成功必须标为 partial，禁止把推测伪装为来源结论。
- **WS-07 — 证据与政策分离。** Task result 的 `research` 由运行时根据真实工具调用构造，模型不能自报。Creative Direction Resource 的 `generationOptions.research` 只保存 query、状态、来源 title+URL 和预算，不保存网页摘要；Direction structured content 只保存 `styleSummary/rawUserStyle` 与六个领域正文。
- **WS-08 — 网页内容不可信且有界。** Tavily 请求固定关闭 answer、raw content、images 和 auto parameters；只接受 HTTP(S) source URL，标题/摘要/结果数都有上限。系统提示词与 `creative-direction` Skill 必须同时声明网页指令无权覆盖系统行为。

## 权威入口

- 公共请求、结果与 provider 接口：`src/lib/web-search/contracts.ts`、`provider.ts`。
- 唯一配置与执行入口：`src/lib/web-search/service.ts`。
- Tavily wire/auth/timeout/response normalization：`src/lib/web-search/tavily.ts`；出站代理复用 `src/lib/http/outbound-proxy.ts`，不建立搜索专用代理配置。
- Main Agent Operation：`src/lib/operations/domains/web-search/web-search-ops.ts`；能力投影仍由生产 Operation registry 与固定 gateway 负责。
- Worker 能力声明：`src/lib/creative-worker/output-registry.ts`；工具执行、预算与证据投影：`tools.ts`、`research.ts`、`runtime.ts`。
- Task/Resource 研究元数据：`src/lib/creative-worker/task-contract.ts`、`src/lib/creative-resource/creative-work-materialization.ts`。
- 环境变量示例：`.env.example`、`.env.cloud.example`。真实 key 只能存在于被忽略的环境配置。

## 生命周期

Main Agent 需要当前资料时按需加载 `web_search`，通过唯一 Operation executor 发起一次受限查询。Operation 成功返回有界 source，配置缺失、凭据拒绝、网络或响应异常以 typed error 结束本次调用，不写项目事实。

Creative Direction Task 启动时，output registry 决定 Worker 同时获得 `read_skill` 与 `web_search`；其他 Task 不创建研究状态也不获得该工具。Worker 先判断是否确有研究必要；不调用时正常生成方向，运行时只归档 `not_attempted`，不向正文补 warning。每次实际搜索先占用本 Task 预算，再由 `searchWeb` 请求 Tavily。成功结果可供本轮综合，运行时只把 query 与 source identity 归档；尝试后的失败返回显式非研究结果供 Worker 继续生成并写 warning。Task 完成后，完整研究证据进入 `Task.result`，Creative Direction 物化时复制到每个 final/candidate Revision 的 generation metadata，正文不含来源证据。

Main Agent 搜索失败是 Operation 失败；Creative Direction 研究失败是显式、可审计的降级结果而非 Task 失败，因为方向仍可基于用户事实与 Skill 生成。两者都不得返回伪造来源或假装最新。

## 验证

- `tests/integration/provider/tavily-web-search.contract.test.ts` 在外部协议边界替换付费 Tavily，观察固定 endpoint、Bearer header、请求开关、结果裁剪和 typed credential failure。
- `tests/contracts/project-agent-toolset-conformance.test.ts` 从生产 registries 穷尽证明 Main Agent Operation 可发现，且只有 `creative_direction` Worker 得到 `web_search`。
- `tests/unit/operations/web-search-ops.test.ts` 验证 Main Agent 成功结果与缺失/拒绝配置的 typed Operation failure。
- `tests/unit/creative-worker/research.test.ts` 验证 research 状态、预算事实和 source-only evidence 投影。
- `tests/unit/creative-worker/web-search-tool.test.ts` 验证方向 Worker 的真实 Tool 执行、冻结预算和非方向工具缺席。
- `tests/unit/creative-resource/creative-work-materialization.test.ts` 验证 evidence 进入 Direction generation metadata 而不是 structured content。
- 真实 Tavily 的覆盖率、论坛可索引性、结果新鲜度和跨语言召回属于发布复验边界；本地 contract 不伪造这些质量结论。

## 历史回归

- Style Bible 只有静态视觉政策，遇到“规则怪谈”“模拟恐怖”等新近或社群定义的类别时，Worker 只能依赖模型记忆；为每种风格新增 Skill 又会制造无限 identity 和更新滞后。当前把研究能力限定为 Creative Direction 的证据输入，再由同一个方向契约影响下游。
- 初始方案考虑把所有项目上下文和搜索能力交给每个 Subagent；这会扩大权限、重复裁剪并让音乐或资产 Worker各自解释风格。当前项目方向由服务端按 output registry 注入，Web Search 同样只由 registry 给方向生产者，其他 Worker 保持封闭。
- 搜索 provider 若直接返回 answer 或 raw page，会让 provider 自带 LLM 和网页指令成为第二个创意裁判。当前固定关闭这些字段，只返回有界 source snippet，并把证据归档与政策正文分开。

## 修改检查表

1. 新调用方是否仍只经过 `searchWeb`，而没有拼 provider HTTP？
2. 公共 schema 是否仍不含 API key、raw content、answer、images 或 Tavily 私有控制项？
3. Main Agent 是否仍通过 Operation registry/gateway，且配置缺失明确失败？
4. Worker 搜索能力是否只由 `creative_direction.workerTools` 声明，其他 output kind 仍只有 `read_skill`？
5. 预算、未尝试、部分研究和失败是否由运行时证据决定，且未尝试不会产生 warning？
6. Creative Direction structured content 是否仍不含 query、citation 或网页摘要，证据只在 generation metadata？
7. 测试是否观察真实 provider wire adapter 边界，并明确真实 Tavily 质量仍需发布复验？
