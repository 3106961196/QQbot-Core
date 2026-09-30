/**
 * R9 syncBots 单元测试：配置热重载增量同步（加/删/改账号）。
 *
 * 不联网：不实例化 QQBotTasker（其依赖主仓运行时 + SDK），
 * 而是从 QQBotTasker.js 源码提取 syncBots 方法体，绑定到最小 mock 对象上测三向 diff。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ---- 提取 syncBots 方法体（QQBotTasker.js 内类方法，直接 eval 绑定到 mock）----
const src = readFileSync(new URL('../tasker/QQBotTasker.js', import.meta.url), 'utf8')
const match = src.match(/async syncBots\(\) \{[\s\S]*?\n    \}/)
assert.ok(match, '应从 QQBotTasker.js 提取到 syncBots 方法体')
// 剥离方法签名 `async syncBots() {` 与结尾 `}`，只保留函数体（new Function 内用函数表达式包裹）
const syncBotsBody = match[0]
  .replace(/^async syncBots\(\) \{/, '')
  .replace(/\n    \}$/, '')

/** 最小 Tasker mock：带 syncBots 所需全部状态 */
function makeTasker(accounts, { online = [], secrets = {} } = {}) {
  const started = []      // connectionManager.start 调用记录
  const stopped = []      // disconnect 调用记录（id）
  const tasker = {
    config: { accounts },
    bots: new Map(),
    appid: {},
    connectionManager: {
      start: account => started.push(account),
      stop: () => {},
    },
    async disconnect(id) { stopped.push(id); this.bots.delete(id) },
    makeLog: () => {},
    // syncBots 方法体内的 AgentRuntime 是模块级裸名（QQBotTasker.js 顶部全局），
    // 在此以 mock 形式注入
    AgentRuntime: { makeLog: () => {}, LOG: 'QQBot' },
  }
  for (const id of online) {
    tasker.bots.set(id, {})
    tasker.appid[id] = { info: { secret: secrets[id] } }
  }
  tasker._started = started
  tasker._stopped = stopped
  // 把 syncBots 方法体绑定到 mock 上；方法体内引用 AgentRuntime / botIdOf，
  // 通过 new Function 闭包注入（源码里这两个是模块级裸名 / 模块函数）
  tasker.syncBots = new Function(
    'AgentRuntime', 'botIdOf', 'tasker', 'LOG',
    `return async function () {${syncBotsBody}}.bind(tasker)`,
  )(tasker.AgentRuntime, botIdOf, tasker, 'QQBot')
  return tasker
}

const botIdOf = a => String(a.appId || '')

// ============ R9：三向 diff ============

test('R9：无账号变更时零操作', async () => {
  const t = makeTasker([{ appId: 'A1', clientSecret: 's1', enabled: true }], { online: ['A1'], secrets: { A1: 's1' } })
  await t.syncBots()
  assert.equal(t._started.length, 0, '不应启动新连接')
  assert.equal(t._stopped.length, 0, '不应断开已有连接')
})

test('R9：新增账号 → connectionManager.start', async () => {
  const t = makeTasker([{ appId: 'A1', clientSecret: 's1', enabled: true }, { appId: 'A2', clientSecret: 's2', enabled: true }], { online: ['A1'], secrets: { A1: 's1' } })
  await t.syncBots()
  assert.equal(t._started.length, 1)
  assert.equal(t._started[0].appId, 'A2')
})

test('R9：删除账号 → disconnect', async () => {
  const t = makeTasker([{ appId: 'A1', clientSecret: 's1', enabled: true }], { online: ['A1', 'A2'], secrets: { A1: 's1', A2: 's2' } })
  await t.syncBots()
  assert.deepEqual(t._stopped, ['A2'], '应断开配置中已移除的 A2')
  assert.equal(t.bots.has('A2'), false, 'disconnect 后 bots 应移除')
})

test('R9：clientSecret 变更 → 断开并重连', async () => {
  const t = makeTasker([{ appId: 'A1', clientSecret: 's1-new', enabled: true }], { online: ['A1'], secrets: { A1: 's1-old' } })
  await t.syncBots()
  assert.deepEqual(t._stopped, ['A1'], 'secret 变更应断开旧连接')
  assert.equal(t._started.length, 1, '断开后应重新编排连接')
  assert.equal(t._started[0].clientSecret, 's1-new')
})

test('R9：disabled 账号不自动连接', async () => {
  const t = makeTasker([{ appId: 'A1', clientSecret: 's1', enabled: true }, { appId: 'A2', clientSecret: 's2', enabled: false }], { online: ['A1'], secrets: { A1: 's1' } })
  await t.syncBots()
  assert.equal(t._started.length, 0, 'enabled:false 不应启动连接')
})

test('R9：新账号缺 clientSecret → 跳过并记录', async () => {
  const t = makeTasker([{ appId: 'A1', clientSecret: 's1', enabled: true }, { appId: 'A3', enabled: true }], { online: ['A1'], secrets: { A1: 's1' } })
  await t.syncBots()
  assert.equal(t._started.length, 0, '缺 clientSecret 的新账号不应启动')
})

test('R9：混合场景（加 A2 + 删 A3 + A1 改密）', async () => {
  const t = makeTasker([
    { appId: 'A1', clientSecret: 's1-new', enabled: true },
    { appId: 'A2', clientSecret: 's2', enabled: true },
  ], { online: ['A1', 'A3'], secrets: { A1: 's1-old', A3: 's3' } })
  await t.syncBots()
  assert.deepEqual(t._stopped.sort(), ['A1', 'A3'], '删 A3、改密重连 A1')
  assert.equal(t._started.length, 2, 'A1 重连 + A2 新增')
  const startedIds = t._started.map(a => a.appId).sort()
  assert.deepEqual(startedIds, ['A1', 'A2'])
})
