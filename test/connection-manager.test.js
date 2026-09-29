import test from 'node:test'
import assert from 'node:assert/strict'
import { ConnectionManager } from '../tasker/connection-manager.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

test('连接成功：attempt 归零并上报 connected', async () => {
  const events = []
  let calls = 0
  const cm = new ConnectionManager({
    connectFn: async () => { calls++; return true },
    onStatus: (s, d) => events.push([s, d]),
    retries: { backoff: [0.01, 0.02] },
  })
  cm.start({ appId: 'A1' })
  await sleep(30)
  assert.equal(calls, 1)
  assert.deepEqual(events.filter(e => e[0] === 'connected').map(e => e[1].key), ['A1'])
})

test('连接失败：按退避重试，直到成功或 give-up', async () => {
  const events = []
  let calls = 0
  const cm = new ConnectionManager({
    connectFn: async () => { calls++; return calls >= 3 },  // 前两次失败，第三次成功
    onStatus: (s, d) => events.push([s, d]),
    retries: { backoff: [0.01, 0.01, 0.01], maxRetries: 5 },
  })
  cm.start({ appId: 'A2' })
  await sleep(120)
  assert.ok(calls >= 3, `calls=${calls} 应至少重试到成功`)
  const kinds = events.map(e => e[0])
  assert.ok(kinds.includes('retrying'), '应上报 retrying')
  assert.ok(kinds.includes('connected'), '最终应 connected')
})

test('连接持续失败：超过 maxRetries 后 give-up 不再重试', async () => {
  const events = []
  let calls = 0
  const cm = new ConnectionManager({
    connectFn: async () => { calls++; return false },
    onStatus: (s, d) => events.push([s, d]),
    retries: { backoff: [0.005, 0.005], maxRetries: 2 },
  })
  cm.start({ appId: 'A3' })
  await sleep(80)
  const kinds = events.map(e => e[0])
  assert.ok(kinds.includes('give-up'), `应 give-up，实际 ${kinds.join(',')}`)
  const after = calls
  await sleep(60)
  assert.equal(calls, after, 'give-up 后不应再重试')
})

test('限速：5s 窗口内断连 ≥3 次 → rate-limited，强制冷却后重试', async () => {
  const events = []
  let calls = 0
  const cm = new ConnectionManager({
    connectFn: async () => { calls++; return true },
    onStatus: (s, d) => events.push([s, d]),
    retries: { backoff: [0.01], rateLimitCooldownMs: 40, rateLimitThreshold: 3 },
  })
  cm.start({ appId: 'A4' })
  await sleep(20)
  cm.reportDisconnect('A4')
  cm.reportDisconnect('A4')
  cm.reportDisconnect('A4')  // 第 3 次 → rate-limited
  await sleep(10)
  assert.ok(events.some(e => e[0] === 'rate-limited'), '应上报 rate-limited')
  const before = calls
  await sleep(80)  // 冷却 40ms 后应再连
  assert.ok(calls > before, '冷却后应恢复连接')
})

test('stop：停止后不再重试', async () => {
  let calls = 0
  const cm = new ConnectionManager({
    connectFn: async () => { calls++; return false },
    retries: { backoff: [0.01, 0.01], maxRetries: 10 },
  })
  cm.start({ appId: 'A5' })
  await sleep(20)
  cm.stop('A5')
  const after = calls
  await sleep(50)
  assert.equal(calls, after, 'stop 后不应再重试')
})

test('start 幂等：同一账号不重复编排', async () => {
  let calls = 0
  const cm = new ConnectionManager({
    connectFn: async () => { calls++; return true },
  })
  cm.start({ appId: 'A6' })
  cm.start({ appId: 'A6' })
  await sleep(20)
  assert.equal(calls, 1)
})

test('reportDisconnect 未达阈值：立即重连', async () => {
  const events = []
  let calls = 0
  const cm = new ConnectionManager({
    connectFn: async () => { calls++; return true },
    onStatus: (s, d) => events.push([s, d]),
    retries: { backoff: [10, 20], rateLimitThreshold: 3 },
  })
  cm.start({ appId: 'A7' })
  await sleep(20)
  cm.reportDisconnect('A7', '网络抖动')
  await sleep(120)  // 0.05s 延迟后应重连
  assert.ok(calls >= 2, `calls=${calls} 应重连`)
  assert.ok(events.some(e => e[0] === 'reconnecting'), '应上报 reconnecting')
})

test('adopt：登记后 DEAD 断连受自动重连保护', async () => {
  let calls = 0
  const cm = new ConnectionManager({
    connectFn: async () => { calls++; return true },
  })
  cm.adopt({ appId: 'A8' })
  assert.ok(cm.has('A8'), 'adopt 后应纳入编排')
  cm.reportDisconnect('A8')
  await sleep(120)
  assert.equal(calls, 1, 'adopt 不触发连接，但断连后重连')
})

test('stop：手动断开后不再自动重连', async () => {
  let calls = 0
  const cm = new ConnectionManager({
    connectFn: async () => { calls++; return true },
  })
  cm.start({ appId: 'A9' })
  await sleep(20)
  cm.stop('A9')
  cm.reportDisconnect('A9')
  const after = calls
  await sleep(80)
  assert.equal(calls, after, 'stop 后 reportDisconnect 不应重连')
})
