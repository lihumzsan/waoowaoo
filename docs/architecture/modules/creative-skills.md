<!-- architecture-module: creative-skills -->

# Creative Skills

## 为什么是这样

Codex app-server 是唯一 Agent Runtime，专业创作也由同一个主 Agent 完成。Wao 不维护第二套专业
Agent 循环，也不把专业结论跨线程交接。服务端 registry 仍然穷尽定义每个专业领域对应的 Skill、
outputKind 与 strict schema；Runtime 物化时把“核心方法 + 一个领域方法 + 该领域 schema”组装成一个
原生 Skill。主 Agent 为每个专业结果读取它唯一对应的 Skill；同一目标包含多个专业结果时按结果顺序
读取多个 Skill，而不是把不同领域混入同一个结果。

这样保留专业经验和机器契约的确定边界，同时删除 custom agent、项目上下文 hook、child Turn、重启
排空和第二套 UI 生命周期。Skill 选择由主 Agent 在现有上下文中完成，不另建服务端关键词路由或
fallback。

## 不变量

- **CS-01 — Skill identity 单一。** registry 是 Skill id、版本和磁盘正文的唯一声明；加载器只读取
  registry 中声明的文件。
- **CS-02 — 专业映射穷尽。** registry 穷尽 `domainKind → 一个专业 Skill → 固定 outputKind → strict
  JSON schema → 媒体 Operation 或可选保存 schemaId`。调用方不得另建同义路由、私有 schema 或根据
  文件存在猜能力。
- **CS-03 — 主 Agent 的 Wao Skill identity 单一。** Runtime 只在 workspace 内暴露 registry 声明的领域
  Skill；`creative-core` 只作为每个领域 Skill 的共同正文嵌入，不形成需要二次选择的独立入口。原生 Codex 系统 Skills
  属于用户 Home，Wao 不复制、禁用或清理它们；Wao registry 与 workspace inventory 不一致必须失败。
- **CS-04 — 每个 Skill 固定组装。** 一个物化 Skill 恰好包含核心正文、一个专业正文和该专业
  outputKind 的 registry schema；不得动态发现、混入其他领域 Skill，或从散文示例重建字段。
- **CS-05 — 专业内容单 writer。** 主 Agent 是当前专业结果的唯一 writer；校验修正、用户呈现、
  显式保存和媒体提交都使用同一个 in-turn 对象，禁止第二个 Agent、服务端 Prompt 编译或平行文件
  复制、续写、改写。
- **CS-06 — 单一类型结果。** 每次专业工作只构造一个根 outputKind 的 strict JSON 对象。该对象是
  当前 Turn 内的执行连接件，不要求作为最终回复裸输出，也不会因写入 scratch 自动持久化；用户明确
  要求保存文档时才通过正式 Operation 创建 Resource。
- **CS-07 — 生成 items 直接执行。** 图片、视频和音乐对象包含可直接传给对应媒体 Operation 的完整
  items，包括最终 Prompt、创作身份、创作参数和 Resource 版本引用。Project 画幅、资产格式、模型、
  能力校验、计费和 Task 仍由各自系统 owner 决定；服务端不得补写创作内容。
- **CS-08 — Wao 不创建 Agent 委派旁路。** 专业创作不得创建、等待、中断或恢复 child Thread，也不得保留
  child lifecycle、hook 或 UI 投影作为备用路径。原生 Codex agent 配置属于用户 Home，Wao 不通过 workspace placement
  改写它；Wao developer instructions 仍要求专业结果留在当前主 Turn。
- **CS-09 — 语言由用户决定。** Skill 可以使用适合模型的知识语言，但用户可见文本和工作区交付遵循
  当前 locale 或用户明确要求。
- **CS-10 — 真人与写实风格是正常创作能力。** 不在 Skill 或指令里注入真人、公众人物或相似度禁令。
  Provider 若拒绝具体输入，由 adapter 的 typed failure 如实投影，不得把拒绝文案复制回 Skill 形成
  第二套能力政策。
- **CS-11 — 项目能力只直接注入唯一 writer。** 当前项目生产上下文由服务端每 Turn 从唯一 resolver
  直接附加给主 Agent；它不是 workspace 文件、Skill 副本或可写状态。缺必需能力时原地失败，禁止
  refetch hook、跨 Agent 转发或猜测。

## 权威入口

- Skill identity、正文、领域映射与输出契约：`src/lib/creative-skills/**`
- Runtime Skill 配置物化与主 Agent 边界：`src/lib/assistant-runtime/runtime-persistence.ts`、
  `runtime-access.ts`
- 媒体提交：`create_image` / `create_audio` / `create_video`；显式文档保存：
  `save_project_document`

## 踩过的坑

- 服务端曾按 schemaId 猜资产类型、拼接创作 Prompt 并覆盖调用方画幅 → 形成第二个创作 writer，也让
  验证无法区分 Skill 效果 → 专业结果写完整 Prompt 与创作参数；Project 画幅和资产格式由各自系统
  owner 唯一解析，服务端只严格验证与冻结（CS-05/07）。
- 专业 Skill 曾各自手写输出字段，执行层 strict schema 又独立演化，真实结果因此被拒并触发猜字段
  重试 → 同一契约两份表示 → registry schema 直接组装进每个 Runtime Skill，并由同一执行入口验证
  （CS-02/04/06）。
