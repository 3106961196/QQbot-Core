/**
 * vendor SDK 接缝测试：验证 P0-2 修复的协议行为。
 * 全部使用 mock bot / mock ws，不发起真实网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { SessionManager } from '../src/vendor/qq-group-bot/lib/sessionManager.js'

/** 构造可测的 SessionManager：注入 mock bot（logger/config），并隔离网络 */
function makeManager(config = {}) {
  const logs = []
  const bot = {
    config: { appid: 'TEST_APP', secret: 'TEST_SECRET', maxRetry: 10, ...config },
    logger: {
      trace() {}, debug() {}, info() {}, mark() {}, warn() {}, error: (...a) => logs.push(a), fatal() {},
    },
  }
  const sm = new SessionManager(bot)
  // 隔离网络：start()/checkNeedToRestart() 会调用这两个方法（真实实现走 axios）
  sm.getAccessToken = async () => ({ access_token: 'tok', expires_in: 7200 })
  sm.getWsUrl = async () => { sm.wsUrl = 'wss://example.invalid' }
  sm._logs = logs
  return sm
}

/** 覆盖 connect()：不真实 new WebSocket（每次返回新 mock ws 并绑定） */
function noRealConnect(sm) {
  // checkNeedToRestart 直接放行（不比对 url/token，也不 stop 原 ws）
  sm.checkNeedToRestart = async () => true
  sm.connect = () => { sm.bot.ws = makeWs(); sm.startListen() }
}

/** 构造 mock ws：记录 send，暴露事件触发 */
function makeWs() {
  const sent = []
  const ws = new EventEmitter()
  ws.sent = sent
  ws.send = data => sent.push(JSON.parse(data))
  ws.close = () => ws.emit('close', 1000)
  ws.readyState = 1
  return ws
}

/** 让 startListen 绑定到指定 mock ws */
function attach(sm, ws) {
  sm.bot.ws = ws
  sm.wsUrl = 'wss://example.invalid'
  sm.startListen()
}

/** 触发一条服务端消息（模拟收到 DISPATCH/HEARTBEAT 等） */
function recv(ws, payload) {
  ws.emit('message', JSON.stringify(payload))
}

const HELLO = { op: 10, d: { heartbeat_interval: 30000 } }
const READY = { t: 'READY', s: 5, d: { session_id: 'sess-1', user: { id: 'bot-1', username: 'Tester' } } }

test('首次连接：HELLO 后走 IDENTIFY', () => {
  const sm = makeManager()
  const ws = makeWs()
  attach(sm, ws)

  recv(ws, HELLO)
  assert.equal(ws.sent.length, 1, 'HELLO 后应发一条消息')
  assert.equal(ws.sent[0].op, 2, '首次连接应发 IDENTIFY(op=2)，而非 RESUME')
})

test('P0-2 修复：4008 断连走 RESUME（原先错误走 IDENTIFY）', { timeout: 3000 }, () => {
  const sm = makeManager()
  noRealConnect(sm)
  const ws = makeWs()
  attach(sm, ws)

  recv(ws, READY)  // 建立会话，sessionRecord.seq=5
  assert.equal(sm.isReconnect, false)

  // 模拟 4008 断连
  ws.emit('close', 4008)
  assert.equal(sm.isReconnect, true, '4008 应标记为可 Resume')

  // 新连接收到 HELLO 后应发 RESUME
  const ws2 = makeWs()
  attach(sm, ws2)
  recv(ws2, HELLO)
  assert.equal(ws2.sent[0].op, 6, '4008 重连应发 RESUME(op=6)')
  assert.equal(ws2.sent[0].d.session_id, 'sess-1', '应携带原 session_id')
  assert.equal(ws2.sent[0].d.seq, 5, '应携带原 seq')
})

test('4009 断连走 RESUME（原有正确行为不回归）', { timeout: 3000 }, () => {
  const sm = makeManager()
  noRealConnect(sm)
  const ws = makeWs()
  attach(sm, ws)
  recv(ws, READY)

  ws.emit('close', 4009)
  assert.equal(sm.isReconnect, true, '4009 应标记为可 Resume')
})

test('4007 断连走 IDENTIFY（seq 错误应重新鉴权）', { timeout: 3000 }, () => {
  const sm = makeManager()
  noRealConnect(sm)
  const ws = makeWs()
  attach(sm, ws)
  recv(ws, READY)

  ws.emit('close', 4007)
  assert.equal(sm.isReconnect, false, '4007 不应 Resume，应重新 IDENTIFY')
})

test('P0-2 修复：op=9 INVALID_SESSION 降级为 IDENTIFY（原先完全未处理）', () => {
  const sm = makeManager()
  const ws = makeWs()
  attach(sm, ws)
  recv(ws, READY)
  assert.equal(sm.isReconnect, false)

  // 模拟 RESUME 过程中收到 INVALID_SESSION(d=true → 应重新鉴权)
  sm.isReconnect = true
  recv(ws, { op: 9, d: true })

  assert.equal(sm.isReconnect, false, '收到 INVALID_SESSION 后应置 isReconnect=false')
  assert.equal(ws.sent.length, 2, '应额外发出一条消息')
  assert.equal(ws.sent[1].op, 2, 'INVALID_SESSION 后应发 IDENTIFY(op=2) 而非继续 Resume')
})

test('DISPATCH 更新 seq（RESUME 正确性前提）', () => {
  const sm = makeManager()
  const ws = makeWs()
  sm.bot.dispatchEvent = () => {}
  attach(sm, ws)
  recv(ws, READY)  // seq=5

  recv(ws, { op: 0, t: 'MESSAGE_CREATE', s: 42, d: {} })
  assert.equal(sm.sessionRecord.seq, 42, 'DISPATCH 应更新 seq')
  assert.equal(sm.heartbeatParam.d, 42, '心跳唯一值应同步')
})

test('重试超限触发 DEAD（供 Tasker 上报断连）', { timeout: 3000 }, () => {
  const sm = makeManager({ maxRetry: 1 })
  noRealConnect(sm)
  const ws = makeWs()
  let deadMsg = null
  sm.on('DEAD', d => { deadMsg = d })
  attach(sm, ws)

  // 第一次断连：重试 0 < 1 → 重连
  ws.emit('close', 4009)
  // 第二次断连：重试 1 >= 1 → DEAD
  ws.emit('close', 4009)
  assert.ok(deadMsg, '超过 maxRetry 应触发 DEAD')
  assert.match(deadMsg.msg, /连接已死亡/)
})
