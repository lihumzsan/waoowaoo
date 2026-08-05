<!-- architecture-module: creative-skills -->

# Creative Skills

## 为什么是这样

Codex app-server 是唯一 Agent Runtime，Wao 不维护第二套 Creative Worker 循环。但专业创作也不依赖
主 Agent 的上下文或 Skill 语义猜测：服务端 registry 把每个 workerKind 确定性绑定到一个 custom
agent 和固定 Skill 集，Runtime 启动时把 Skill 正文只注入对应子 Agent。

首版曾把全部 Skill 安装给主 Agent 并允许它"自己读取或委派"，这让 Skill 选择变成 best-effort 语义
猜测，主上下文重新承担全部专业方法，而每 Turn 的 inventory 校验只证明文件加载、不证明选对。

## 不变量

- **CS-01 — Skill identity 单一。** registry 是 Skill id、版本和磁盘正文的唯一声明；加载器只读取
  registry 中声明的文件。
- **CS-02 — Worker 路由确定。** registry 穷尽 `workerKind → agentType → 固定 Skill 集 → 固定
  outputKind → strict JSON schema → Workspace schemaId`。Skill description 只供解释，不参与
  正确性、隐式路由或 fallback。
- **CS-03 — 主 Agent 零 Skill。** Wao Skill 不进入项目文件树、Runtime skills 目录、主 Agent 指令
  或工具 schema；Runtime 自带的原生 Skills 也全部禁用。不做每 Turn 的 Skill inventory 准入；
  smoke 发现任何 enabled Skill 都失败。
- **CS-04 — 子 Agent 固定注入。** 每个 custom agent 只收到"核心 Skill + 一个专业 Skill"的完整
  正文，不得发现或加载其他 Skill。子 Agent 的业务 MCP 必须使用合法 transport 配置并显式禁用——
  只写 `enabled=false` 而缺 transport 会让整个 agent role 被判为无效。
- **CS-05 — 专业内容单 writer。** 被选定的子 Agent 独占其交付文件。主 Agent 只检查文件存在、路径
  和提交前置条件，不复制、续写或改写专业内容。并行子 Agent 必须写互斥路径。
- **CS-06 — 固定 JSON 文件交付。** 每个角色只写一个被分派的 `.json`，根 outputKind 和完整内容
  必须通过同一 strict schema；checkpoint 原子校验并登记对应 schemaId。没有第二份 Markdown 正式
  交付、Skill output 或 Worker Task。
- **CS-07 — Manifest 是执行连接件。** 生产 Manifest 本身就是可执行 JSON，不存在"设计文档 + 另一份
  执行 JSON"。它把完整最终 Prompt、创作身份、显式参数和 Placement 写在同一 schema；主 Agent 只有
  一条新媒体生产入口。视频/音乐角色必须读取只读能力投影，不从示例或模型名猜能力。服务端只校验、
  冻结和执行，不补写创作内容。
- **CS-08 — 原生生命周期。** 创建、等待、中断和完成只消费原生 Subagent 事件并投影到现有 UI；
  不恢复旧 Worker 卡片或第二状态机。
- **CS-09 — 语言由用户决定。** Skill 可以使用适合模型的知识语言，但用户可见文本和工作区交付遵循
  当前 locale 或用户明确要求。
- **CS-10 — 真人与写实风格是正常创作能力。** 不在 Skill 或指令里注入真人、公众人物或相似度禁令。
  Provider 若拒绝具体输入，由 adapter 的 typed failure 如实投影，不得把拒绝文案复制回 Skill 形成
  第二套能力政策。
- **CS-11 — 专业委派无需用户知道 Subagent。** 普通创作请求即可由主 Agent 自主委派；该授权只存在于
  Runtime 物化的全局指令面，专业路由仍只来自 Worker registry。不能通过提升全部 Turn 的推理等级、
  伪造用户消息或让主 Agent 自行创作来绕过。

## 固定角色

| workerKind | agentType | Skill 集 | outputKind |
| --- | --- | --- | --- |
| story | `wao_story` | core + story-development | `screenplay` |
| long_form | `wao_long_form` | core + long-form-production | `long_form_plan` |
| direction | `wao_direction` | core + creative-direction | `creative_direction` |
| assets | `wao_assets` | core + asset-development | `asset_manifest` |
| video | `wao_video` | core + video-direction | `video_prompt_set` |
| music | `wao_music` | core + music-direction | `music_direction` |

## 权威入口

- Skill identity 与正文、Worker 路由、输出契约：`src/lib/creative-skills/**`
- Runtime 配置物化与主 Agent 边界：`src/lib/assistant-runtime/runtime-persistence.ts`、
  `runtime-access.ts`
- 专业交付落地：WorkspaceResource checkpoint；媒体提交：Production Manifest 入口

## 踩过的坑

- 服务端曾按 schemaId 猜资产类型、拼接创作 Prompt 并覆盖画幅 → 形成第二个创作 writer，也让验证
  无法区分 Skill 效果 → 子 Agent 写完整 Prompt 与显式参数，服务端只严格验证与冻结（CS-05）。
- 固定 Worker 首版只绑定 agentType 与 Skill，自然语言交付说明没有绑定机器 outputKind：Skill 要求
  的字段被付费入口的 strict schema 禁止，错误投影又丢弃字段级 issue 并把所有路径错误归成同一个
  字段，模型于是把正确的相对路径改成必然过期的绝对路径反复提交 → 同一契约两份表示 → 六个 worker
  一对一绑定六个 strict schema，同一 schema 同时注入 agent、登记 checkpoint、复验提交（CS-06）。
- "必须委派"曾写在普通开发者指令里，没有落到 Runtime 默认多代理策略认可的指令面，真实创作请求
  因此处于"主 Agent 不能写、子 Agent 又不能自动启动"的死锁 → 授权写错了层 → 由全局指令面提供
  唯一自主委派授权（CS-11）。
- 同一首版为 custom agent 写了 `enabled=false` 却没提供必需的 transport，Runtime 判为 invalid
  transport 并忽略整份 agent role，而只匹配配置字符串的 smoke 仍然通过 → 字符串 smoke 不是协议
  证据 → 使用可解析但禁用的空 transport，并由真实启动检查解析结果（CS-04）。
