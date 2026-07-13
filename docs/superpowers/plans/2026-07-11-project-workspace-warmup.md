# 项目工作区深度预热实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展现有登录态 warmup，使“蛊真人后传”工作区及其默认剧集首屏数据在真实点击前完成编译和首次查询。

**Architecture:** 复用现有 Cookie 会话与 `requestOnce`。项目列表响应解析出目标项目 ID，项目数据响应解析出默认剧集 ID，然后串行预热页面、项目数据、剧集配置和运行状态接口；解析失败时安全跳过。

**Tech Stack:** TypeScript、Node.js fetch、NextAuth Cookie、Vitest。

## Global Constraints

- 只修改 `scripts/dev-warmup.ts` 和 `tests/unit/scripts/dev-warmup.test.ts`。
- 不硬编码项目或剧集 UUID，只固定项目名“蛊真人后传”。
- 除登录外只执行 GET，不产生业务写入。
- 项目、剧集或单个接口失败不得阻断开发服务。
- 不修改现有 Worker/Watchdog 未提交文件。

---

### Task 1: 动态解析并预热目标项目

**Files:**
- Modify: `scripts/dev-warmup.ts`
- Modify: `tests/unit/scripts/dev-warmup.test.ts`

**Interfaces:**
- Extend: `WarmupOptions` with optional `projectName?: string`，默认值为 `蛊真人后传`。
- Extend: `runDevWarmup(options): Promise<WarmupResult[]>`，在项目列表之后追加工作区链路结果。

- [ ] **Step 1: 写失败测试**

更新 fake fetch：项目列表返回目标项目；项目数据返回两个按顺序排列的剧集。断言追加请求顺序：

```ts
expect(paths).toContain('/zh/workspace/project-gu')
expect(paths).toContain('/api/projects/project-gu/data')
expect(paths).toContain('/zh/workspace/project-gu?episode=episode-1')
expect(paths).toContain('/api/novel-promotion/project-gu/episodes/episode-1?profile=config')
expect(paths).toContain('/api/runs?projectId=project-gu&workflowType=story_to_script_run&targetType=NovelPromotionEpisode&targetId=episode-1&episodeId=episode-1&limit=20&status=queued&status=running&status=canceling&_v=2')
```

同时断言这些请求均携带 session Cookie。

- [ ] **Step 2: 运行 RED**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup.test.ts`

Expected: FAIL，实际请求序列缺少工作区和项目 API。

- [ ] **Step 3: 实现项目列表响应解析**

保留 `/api/projects?page=1&pageSize=5` 的 `RequestOutcome`，解析：

```ts
type ProjectListPayload = { projects?: Array<{ id?: unknown; name?: unknown }> }
```

只接受同时具有字符串 `id` 和匹配 `projectName` 的项目。找不到时记录 `[dev:warmup] project=<name> skipped=not-found` 并正常返回。

- [ ] **Step 4: 实现项目数据和剧集解析**

请求 `/zh/workspace/:projectId` 和 `/api/projects/:projectId/data`。从以下结构选择数组第一个有效字符串 ID：

```ts
type ProjectDataPayload = {
  project?: {
    novelPromotionData?: {
      episodes?: Array<{ id?: unknown }>
    }
  }
}
```

无剧集时记录 skip，并保留已经完成的页面与项目数据预热结果。

- [ ] **Step 5: 实现剧集页面、配置和运行状态预热**

依次请求带 episode 的工作区、`profile=config` 和使用 `URLSearchParams` 构造的 `/api/runs`。所有请求复用登录 Cookie，逐项记录状态和耗时。

- [ ] **Step 6: 增加安全跳过测试**

覆盖目标项目不存在和项目无剧集两种情况，断言函数 resolve、未请求错误的动态路径、日志不包含 Cookie 或密码。

- [ ] **Step 7: 运行 GREEN**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup.test.ts tests/unit/scripts/dev-warmup-wiring.test.ts`

Expected: 全部 PASS。

- [ ] **Step 8: 类型与 lint 验证**

Run: `npm.cmd run typecheck`

Run: `npm.cmd run lint -- scripts/dev-warmup.ts tests/unit/scripts/dev-warmup.test.ts`

Expected: 两条命令 exit 0。

- [ ] **Step 9: 提交功能**

```powershell
git add scripts/dev-warmup.ts tests/unit/scripts/dev-warmup.test.ts
git commit -m "perf: prewarm primary project workspace"
```

- [ ] **Step 10: 重启并验收**

停止现有完整 dev 进程，重新执行 `npm run dev`。确认 warmup 中项目页面、项目数据、剧集配置、运行状态均为 200；再执行一次 warmup，记录热状态耗时并与 14.05s、6.88s、4.60s、12.99s 基线对比。
