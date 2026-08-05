<!-- architecture-module: billing-approval -->

# 计费与审批

## 为什么是这样

所有收费 Operation 先形成不可变 PlanSnapshot 和 quote，再由用户逐次批准或预算授权，最后才创建
Task 并扣费。Web、MCP 与未来 CLI 调用同一 planning/submit service；渠道不拥有价格、余额、冻结
或重试语义。

价格只有一份表示。历史上"运行时读 TypeScript catalog、校验脚本读 JSON 镜像"的双轨让镜像停在
52 条而运行时已有 70 条，脚本始终报 OK——"校验通过"完全不能说明用户被收了多少钱。

## 不变量

- **BA-01 — 价格唯一且只有一份表示。** 价格目录、模型/参数和输入数量经 billing policy 计算；
  模型、UI、MCP schema 与客户端不得自行估价。不存在第二份 JSON、文档或脚本副本；校验脚本必须
  加载与计费同一个运行时目录。
- **BA-01A — 成本与零售是同一条目的两面。** 每个条目同时声明供应商成本与用户零售价；手写零售价
  必须与成本同 mode、同 unit、同 tier 顺序与条件。计费只解析零售价，成本只服务毛利报表。注册期
  必须校验每个价格点在最深折扣下仍高于最低毛利线，不满足即启动失败。
- **BA-01B — 同一产品能力跨 provider 同价。** 同一模型经不同 provider 提供时成本可以不同，
  零售价必须由共享声明拥有并完全一致。
- **BA-01C — 可选模型必须有价。** 模型 identity 分布在能力、价格、API 配置与平台预设多张表，
  靠字符串三元组联接。注册末尾必须穷尽校验"用户可选的模型都有价格"，缺价在注册期失败，不得
  留到用户选中后才在计费时报错。
- **BA-01D — 计价单位必须是真实计价基准。** 按 token 计价的模型不得把"每百万 token 单价"注册成
  整次金额。价格档位必须能由报价时已冻结的输入穷尽解析；无法表达的计价基准必须缺档并 fail
  closed，不得声明近似档位。
- **BA-02 — 计划先于副作用。** 付费前完成权限、模型、参数、资源引用、服务端 Placement、输出数量
  与路径冲突校验；PlanSnapshot 创建前不得提交 Provider 或创建 pending Resource。
- **BA-03 — 冻结同一输入。** Snapshot 冻结实际读取的资源 id + 内容版本 + 路径、Operation
  revision、模型参数、服务端派生 Placement 与 quote。执行快照就是该 Snapshot，不建立第二份冻结。
- **BA-05 — 授权精确。** Grant 只授权一个 Snapshot，或明确金额/范围/期限的预算。shell/patch
  审批不能授权消费，普通用户输入请求也不能。
- **BA-06 — 提交幂等。** 同一 request identity、Snapshot 与 execution identity 重放返回同一
  Task/批次；输入或契约版本不同则 typed conflict，不能再扣费。
- **BA-07 — 账本唯一。** Billing ledger 是冻结、扣减、退回和展示的唯一 writer；Task、Provider
  回调、UI 和 Agent 都不能直接改余额。
- **BA-08 — attempt 与业务收费分离。** Provider attempt 可重试，但同一业务执行只持有一份授权
  和费用。未提交 Provider 的失败释放冻结。
- **BA-09 — 批量仍是一次计划。** 整个批次一次校验/报价/授权，再以稳定 item identity 扇出。
  失败项续跑复用原 Snapshot，不重新收费成功项。
- **BA-11 — 报价消费 canonical 字段。** planner、billing policy 与 handler 消费同一冻结 payload；
  时长等公共字段只有一个 canonical 名字，各边界只在自己的映射处翻译，不从自由 options 另行解释。
- **BA-12 — 破坏性审批冻结精确输入。** 非计费删除在展示审批卡前先按 schema 规范化输入；approval
  identity 必须包含 canonical input hash。只绑定 Turn/call/operation 的通用"确认删除"不能授权
  另一组目标。
- **BA-13 — 取消或清空先到则不得开始副作用。** 取消与 pending 交互在 Project 锁下原子关闭；
  审批证明要求同 Turn 未取消且 Thread 未进入 clear。所有 effect 事务按同一锁序获取同一 fence。
- **BA-15 — 余额是两个池，订阅池先花。** 订阅池按周期发放、周期末过期；充值池永久有效。冻结记录
  各池出资额，结算与回滚按原出资归还；周期已过期后释放的订阅额度必须作废并落流水，不得复活。
  过期只能在读取时按到期时间判定（lazy），正确性不依赖定时任务是否按时执行。取消订阅只结束
  订阅池，绝不动充值池。
- **BA-16 — 每期发放只有一个幂等写入者。** 发放身份是 `(订阅, 期次)`；重投回调、重放 Activity
  与并发 sweep 只发放一次。发放替换而非累加，上期余额在同一事务作废并落流水。套餐只能从我们在
  下单时写入的 metadata 读取，禁止从支付平台的价格 id 或金额反推。
- **BA-17 — LLM 后付、按日聚合、事前只做门禁。** 模型价格跑完才知道，不进入 plan/quote/freeze
  链路。用量如实记录，按"用户 × 自然日"聚合为一次扣费，只结算已完整过去的日期，小数全天累计后
  统一向上取整一次。事前只检查"是否还有可用额度"，不得伪造预估报价来拒绝工作。供应商回报的成本
  只作为观测事实，永远不得成为扣费金额。
- **BA-18 — 确定性 preflight 全部先于 Plan。** 模型选择、凭证与 endpoint 存在性、项目能力默认与
  覆盖、option 兼容性、引用模态与数量、目标文件夹路径/名称派生的 Placement 与输出数量，都必须在创建 Snapshot、报价、
  pending Resource 或 Task 之前完成。任何可由 registry 或本地配置判定的错误都返回结构化可纠正
  字段，不得让 Worker 或 Provider fence 成为第一位发现者。
- **BA-19 — 限额付费活动只有一个席位裁判。** 容量与去重参与身份由同一 admission service 拥有，
  所有套餐与充值在创建支付对象前必须经过它。支付回调在与账本相同的事务内写已付；UI、回跳参数与
  轮询都不能占位或授予权益。释放未付款席位必须先由支付平台证明对应会话已过期或取消，禁止仅凭
  本地 timer 回收后又接受晚到付款。

## 权威入口

| 事实或动作 | 唯一入口 |
| --- | --- |
| 价格条目、派生与毛利保险丝 | `src/lib/ai-registry/pricing-*.ts` |
| quote、冻结、结算、退回、两池裁决 | `src/lib/billing/**` |
| PlanSnapshot 与 request identity | `src/lib/operations/planning.ts`、`operation-plan-snapshot.ts` |
| Grant 与执行重验证 | approval routes + `operation-plan-revalidation.ts` |
| Task/批次原子提交 | `src/lib/task/approved-plan-submitter.ts`、`transactional-create.ts` |

## 踩过的坑

- 按每百万 token 计价的视频模型被注册成 `per_call` 整次金额，4 秒和 15 秒同价，真实成本 ¥9.94
  实收 ¥46（超收 4.6 倍，5 秒时 9 倍）。项目同时实现了完整 token 估算契约却零消费者 → 旧防线
  只断言"计算函数返回目录里的数"，与目录同源，无法反证单位语义错误 → 现在计价单位必须能由冻结
  输入穷尽解析，无法表达的基准 fail closed（BA-01D）。
- 价格长期两份表示（运行时 TS catalog / 校验脚本读 JSON 镜像），镜像停在 52 条而运行时 70 条，
  脚本始终报 OK → 校验对象不是计费对象 → 删除镜像，脚本加载同一运行时目录（BA-01）。
- 四张模型表只靠字符串三元组联接，无任何校验：有的模型能被选中但价格为 null，用户选完才在计费时
  撞错 → 与更早的"幽灵目录项导致整笔配置保存被拒"是同一根因的换形式复发 → 注册末尾穷尽校验
  价格覆盖（BA-01C）。
- Runtime 与 MCP 首次接通时，短期 bearer 被同时当作"可调用能力"和"用户已批准"的证明；容器内代码
  取得 bearer 即可伪造 accept → 传输凭据被当成授权凭据 → bearer 只授予传输能力，每次计费或破坏性
  执行必须再验证浏览器侧已持久化的同 Turn 决定。
- 破坏性审批证明首次只绑定 Turn/call/operation，客户端可复用同一 request identity 替换目标输入
  → approval identity 不含输入 → canonical input hash 纳入 identity（BA-12）。
- 图片生成的新 producer 绕过既有能力编译器，只把画幅写进 Task，价格目录按分辨率+质量+画幅匹配
  因而报"找不到价格" → 新实例漏接既有编译入口 → 所有图片 producer 走同一 payload builder。
