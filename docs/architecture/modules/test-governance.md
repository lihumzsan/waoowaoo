<!-- architecture-module: test-governance -->

# 测试治理

## 为什么是这样

自动化测试不是交付税，也不是代码变化的影子副本。仓库只保留少量能以独立 oracle 反证高损失错误的
测试；其余验证优先使用类型、静态检查、代码审查、真实运行观察和人工产品复验。

测试文件数、覆盖率、通过数量和目录齐全度都不是质量目标。旧测试系统长期把这些当目标，大量 route
测试在鉴权 mock 后即返回，业务路径从未执行——它们与生产代码同步变化，却从未独立发现过真实缺陷。

## 不变量

- **TG-01 — 默认不写测试。** 功能、修复、重构、架构或文档变化均不自动要求新增、修改或补齐测试；
  不得因为同目录已有测试、历史流程或 CI 形式而同步一份实现副本。
- **TG-02 — 独立 oracle。** 合法期望只能来自数学/算法规格、公开协议、持久事务事实、安全隔离或
  生产 registry。当前实现输出、mock 返回、调用次数、源码字符串、文件存在、测试名称和旧 fixture
  都不是 oracle。
- **TG-03 — 仅四类准入。**
  1. 非平凡纯逻辑：parser、resolver、reducer、policy、状态机、算法、canonical identity；
  2. 关键基础设施：真实数据库/Redis/外部 wire 边界上的资金、事务、并发、幂等、权限、retry、
     late/replay、补偿或恢复；
  3. Registry conformance：直接从生产 registry 穷尽枚举 identity、capability 与 policy；
  4. 最小浏览器安全：未登录拒绝、会话恢复、跨用户项目隔离、跨项目资产拒绝。
- **TG-04 — 禁止自证。** 不得 mock 被测系统自己的 route、service、状态机、数据库、队列、worker、
  SSE 或 projector 后断言该 mock；不得以"被调用过"、当前映射/默认值/展示快照、getter、透传或
  组件内部实现充当行为证据。
- **TG-05 — Critical 使用真实 owner。** 关键基础设施测试必须走生产事务、持久 owner 和正式协议
  入口，只允许在一个明确外部边界注入故障；依赖不可用时显式失败，不得降级为内存替身。
- **TG-06 — conformance 不维护第二清单。** 必须从生产 registry 枚举全集并检查每个成员的必需声明。
  手写实例名单、当前字段快照和特定示例属于重复实现，应删除。
- **TG-07 — 浏览器只保留安全边界。** 不用脚本模型、脚本媒体 Provider 或复杂产品 Journey 模拟创作
  行为。创作质量与自由组合流程由人工真实复验，自动化不得声称覆盖未知模型行为。
- **TG-08 — 失败先审计测试。** 现有测试失败时先证明它到达了有效 oracle。若 fixture 腐烂、语义已
  删除、断言只复述实现或维护成本高于风险，删除测试及其文档/CI 引用；禁止修改生产代码迎合无效
  测试。
- **TG-09 — 同一作者不等于独立证据。** 实现者可以编写符合准入的测试，但必须说明 oracle 的外部
  来源和会被拒绝的错误实现。说不清就不写。
- **TG-10 — harness fail closed。** 保留集合的必需用例缺失、skip/todo、依赖不可用或报告不完整
  必须显式失败；未运行只能报告未验证。harness 启动的长期进程必须持有 canonical process identity，
  只有整个进程树确认退出才算清理完成——只发信号或只看直接子进程退出不算。
- **TG-11 — 无隐式挂载。** Git hooks 不运行测试。CI 只运行本模块列出的保留集合；新增测试必须先
  更新本模块的准入说明，而不是靠目录匹配自动扩张。
- **TG-12 — 如实交付。** 只列实际执行的命令、结果和盲区。不得用未执行、已删除或只自证的测试暗示
  产品行为已验证。
- **TG-13 — 静态检查必须覆盖真实入口。** typecheck 除应用源码外，还必须穷尽覆盖 `package.json`
  实际以 `tsx` 运行的运维、迁移、备份、校验与测试服务入口。不得以已删除脚本、生成文件或空 include
  让第二段检查表面成功。

## 保留集合

| 类别 | 入口 | 保留理由 |
| --- | --- | --- |
| Logic | `npm run test:logic` | 独立规格的纯逻辑、状态机、算法、identity |
| Conformance | `npm run test:conformance` | 从生产 registry 穷尽检查接线 |
| Provider Critical | `npm run test:critical:provider` | 真实 adapter/wire 协议、零隐式重提 |
| Task Critical | `npm run test:critical:task` | 真实 DB/Redis 的提交原子性、幂等、并发与账本边界 |
| Temporal Critical | `npm run test:critical:temporal` | 真实执行平面的 Worker 丢失、heartbeat、ACK 丢失与重放 |
| Billing Critical | `npm run test:critical:billing`、`:billing-concurrency` | 余额、冻结、结算、逆向资金事件与并发账本 |
| Security Critical | `npm run test:critical:security` | 真实 owner/scope、媒体读取与跨项目写入拒绝 |
| Browser Security | `npm run test:security` | 最小 authenticated/unauthenticated 权限边界 |

`npm run test:critical` 只聚合上述 Critical 子集。仓库没有 journey 入口、golden scenario
registry、脚本模型 Provider 或创作行为自动化。依赖或 namespace 未就绪必须失败，禁止退回 mock
server 或内存替身。

新增测试前只需回答四个问题，答不清就不新增：属于哪一类准入？独立 oracle 来自哪里？会拒绝哪一种
具体且高损失的错误实现？为什么现有类型、静态检查、人工复验或保留测试不足？

## 踩过的坑

- Golden Journey 用脚本模型和脚本媒体 Provider 重放预先写好的创作顺序 → 只能证明 harness 与自身
  fixture 一致，却持续要求业务变更同步 scenario/driver/oracle/provider policy → 整体删除。
- CI 长期常红后仍继续开发 → 红灯失去阻塞语义 → 保留集合必须始终可解释：失败要么修复真实缺陷，
  要么删除失效测试。
- 精简 Journey 时保留了浏览器安全用例，却同时删掉了环境协调器与超时强制终止；已脱离的 dev server
  进程组因直接子进程先退出而成为孤儿，长期占用 CPU 与内存 → 清理只看直接子进程 → 由环境进程持有
  process-group identity 并等待整个进程树退出（TG-10）。
- 删除某个脚本后，第二段 typecheck 的 include 仍只指向已删除文件和未跟踪的生成声明；工作区恰好
  有该生成文件时检查"成功"却没检查任何 runtime script，干净 worktree 才暴露 → 空输入冒充静态
  验证 → 直接枚举真实入口（TG-13）。首次真正检查随即发现两份脚本仍引用已删除的旧 Task 类型。
