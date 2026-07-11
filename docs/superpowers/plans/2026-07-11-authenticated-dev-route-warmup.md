# 开发环境登录态路由预热实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在完整 `npm run dev` 启动期间，用固定内部用户预热首次访问链路，使真实浏览器打开 `/zh`、session、`/zh/home` 和项目列表时直接使用热编译结果。

**Architecture:** 新增一个只运行一次的 TypeScript 预热程序。程序先等待本机 Next 服务可访问，再完成 NextAuth CSRF + credentials 登录，维护 Cookie，并依次请求关键路由；预热失败只记录结果并正常退出。`package.json` 把它作为第五个并行开发进程接入，生产命令不调用它。

**Tech Stack:** Node.js 22 原生 `fetch`、TypeScript、tsx、Vitest、NextAuth v4、concurrently。

## Global Constraints

- 保留 Next、Worker、Watchdog、Bull Board 和 storage 初始化的现有启动行为。
- 预热目标只允许 `http://127.0.0.1:3000` 或 `http://localhost:3000`。
- `NODE_ENV=production` 时拒绝运行。
- 固定内部账号凭据只存在开发预热脚本中，任何日志不得输出密码、CSRF Token 或 Cookie。
- 除 NextAuth 登录所需 POST 外，只发送 GET 请求，不创建、修改或删除项目数据。
- 任何预热失败都不得终止完整开发环境。

---

### Task 1: 登录态预热核心流程

**Files:**
- Create: `scripts/dev-warmup.ts`
- Create: `tests/unit/scripts/dev-warmup.test.ts`

**Interfaces:**
- Produces: `assertWarmupEnvironment(baseUrl: string, nodeEnv: string | undefined): void`
- Produces: `mergeResponseCookies(current: Map<string, string>, response: Response): Map<string, string>`
- Produces: `runDevWarmup(options: WarmupOptions): Promise<WarmupResult[]>`
- `WarmupOptions` 注入 `fetchImpl`、`sleep`、超时和日志函数，生产入口使用 Node 原生实现，测试使用受控 fake fetch。

- [ ] **Step 1: 写本机及生产环境限制的失败测试**

```ts
import { describe, expect, test } from 'vitest'
import { assertWarmupEnvironment } from '../../../scripts/dev-warmup'

describe('assertWarmupEnvironment', () => {
  test('拒绝非本机地址', () => {
    expect(() => assertWarmupEnvironment('https://example.com', 'development'))
      .toThrow('本机')
  })

  test('拒绝生产环境', () => {
    expect(() => assertWarmupEnvironment('http://127.0.0.1:3000', 'production'))
      .toThrow('生产环境')
  })
})
```

- [ ] **Step 2: 运行测试并确认因为模块不存在而失败**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup.test.ts`

Expected: FAIL，提示无法加载 `scripts/dev-warmup.ts`。

- [ ] **Step 3: 实现最小环境限制函数**

```ts
export function assertWarmupEnvironment(baseUrl: string, nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') throw new Error('开发预热不能在生产环境运行')
  const url = new URL(baseUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('开发预热只允许访问本机 HTTP 服务')
  }
}
```

- [ ] **Step 4: 运行限制测试并确认通过**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup.test.ts`

Expected: 2 tests PASS。

- [ ] **Step 5: 写 Cookie 合并和真实请求顺序的失败测试**

测试 fake fetch 必须模拟：首次 `/zh` 连接失败、第二次成功；CSRF 返回 token 和 Cookie；登录返回 session Cookie；后续 session、home、projects 收到登录 Cookie。断言 URL 顺序如下：

```ts
expect(calls).toEqual([
  '/zh',
  '/zh',
  '/api/auth/csrf',
  '/api/auth/callback/credentials',
  '/api/auth/session',
  '/zh/home',
  '/api/projects?page=1&pageSize=5',
])
expect(authenticatedCalls.every((call) => call.cookie.includes('next-auth.session-token='))).toBe(true)
expect(logLines.join('\n')).not.toContain('123456')
```

- [ ] **Step 6: 运行测试并确认因为预热函数未实现而失败**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup.test.ts`

Expected: FAIL，提示 `runDevWarmup` 或 `mergeResponseCookies` 不存在。

- [ ] **Step 7: 实现最小登录态预热流程**

实现内容必须包括：

```ts
export type WarmupResult = {
  path: string
  status: number | 'error'
  elapsedMs: number
}

export type WarmupOptions = {
  baseUrl: string
  username: string
  password: string
  nodeEnv?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  startupTimeoutMs?: number
  requestTimeoutMs?: number
  log?: (message: string) => void
}
```

流程要求：

1. 反复 GET `/zh`，连接失败时等待后重试，直到成功或启动超时。
2. GET `/api/auth/csrf` 并解析 `{ csrfToken }`。
3. POST `/api/auth/callback/credentials`，body 使用 `URLSearchParams`，字段为 `csrfToken`、`username`、`password`、`callbackUrl`、`json=true`。
4. 从所有 `Set-Cookie` 响应中只保留 `name=value` 并合并为请求 `Cookie`。
5. 登录成功后依次 GET session、home、projects。
6. 单个路由错误记录为 `status: 'error'` 后继续，不抛到顶层。
7. 日志只包含 path、status、elapsedMs。

- [ ] **Step 8: 运行核心测试并确认通过**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup.test.ts`

Expected: 全部 PASS，日志断言确认没有凭据或 Cookie。

- [ ] **Step 9: 增加失败不阻断测试**

覆盖 CSRF 失败和登录失败：公开 `/zh` 结果仍被返回；不请求 authenticated projects；函数 resolve 而不是 reject。

- [ ] **Step 10: 运行完整预热测试**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup.test.ts`

Expected: 全部 PASS。

- [ ] **Step 11: 提交核心流程**

```powershell
git add scripts/dev-warmup.ts tests/unit/scripts/dev-warmup.test.ts
git commit -m "feat: add authenticated dev route warmup"
```

---

### Task 2: 接入完整开发启动命令

**Files:**
- Modify: `package.json`
- Create: `tests/unit/scripts/dev-warmup-wiring.test.ts`

**Interfaces:**
- Consumes: `scripts/dev-warmup.ts` 可执行入口。
- Produces: `npm run dev:warmup` 和包含该进程的完整 `npm run dev`。

- [ ] **Step 1: 写 package scripts 接线失败测试**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

test('完整开发命令包含一次性登录态预热', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
  expect(pkg.scripts['dev:warmup']).toBe('tsx --env-file=.env scripts/dev-warmup.ts')
  expect(pkg.scripts.dev).toContain('npm run dev:warmup')
  expect(pkg.scripts['dev:warmup']).not.toContain('watch')
  expect(pkg.scripts.start).not.toContain('dev:warmup')
})
```

- [ ] **Step 2: 运行接线测试并确认失败**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup-wiring.test.ts`

Expected: FAIL，`dev:warmup` 为 undefined。

- [ ] **Step 3: 在 package.json 添加一次性预热进程**

```json
{
  "scripts": {
    "dev": "npm run storage:init && concurrently \"npm run dev:next\" \"npm run dev:worker\" \"npm run dev:watchdog\" \"npm run dev:board\" \"npm run dev:warmup\"",
    "dev:warmup": "tsx --env-file=.env scripts/dev-warmup.ts"
  }
}
```

脚本入口固定使用本机地址和项目所有者指定的内部账号；捕获所有顶层异常，输出脱敏警告，并保持退出码为 0。

- [ ] **Step 4: 运行接线测试和核心测试**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup-wiring.test.ts tests/unit/scripts/dev-warmup.test.ts`

Expected: 全部 PASS。

- [ ] **Step 5: 运行类型检查**

Run: `npm.cmd run typecheck`

Expected: exit 0。

- [ ] **Step 6: 提交启动接线**

```powershell
git add package.json tests/unit/scripts/dev-warmup-wiring.test.ts
git commit -m "chore: prewarm authenticated routes during dev startup"
```

---

### Task 3: 完整运行验证与性能验收

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: `npm run dev`、warmup 日志、浏览器关键请求耗时。
- Produces: 验证证据和与原始日志的对照结果。

- [ ] **Step 1: 运行目标测试和类型检查**

Run: `npm.cmd exec vitest run tests/unit/scripts/dev-warmup.test.ts tests/unit/scripts/dev-warmup-wiring.test.ts`

Expected: 全部 PASS。

Run: `npm.cmd run typecheck`

Expected: exit 0。

- [ ] **Step 2: 启动完整开发栈**

Run: `npm.cmd run dev`

Expected: Next、Worker、Watchdog、Bull Board 正常启动；warmup 依次报告 `/zh`、session、home、projects，随后自身正常退出。

- [ ] **Step 3: 验证首次真实浏览器请求**

在 warmup 完成后用新会话访问 `/zh`，确认服务端日志不再出现关键路由的长时间首次编译等待；记录 `/zh`、session、home、projects 的耗时，与原始 5.8s、25.8s、4.9s、2.3s 基线对比。

- [ ] **Step 4: 检查安全和变更范围**

Run: `git diff --check HEAD~2..HEAD`

Expected: 无空白错误；终端日志没有密码、CSRF Token 或 Cookie；`start`/生产命令未包含 warmup。

- [ ] **Step 5: 最终提交（仅在验证产生必要修正时）**

如验证发现并修正问题，只提交本功能文件；不得包含工作区已有的 Worker/Watchdog 改动。
