/**
 * request.js 单元测试：验证 R8 通用 API 入口（限频 / NotImplemented / 透传 / 错误规范化）。
 * 不联网：mock sdk.request 的 axios 实例。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { attachRequest, QQBotRequestError, NotImplementedError } from '../tasker/request.js'

/** 构造 mock bot：sdk.request 为 axios 风格实例（.request() 方法） */
function makeBot(handler) {
  const bot = { uin: 'B1', sdk: { request: { request: handler } } }
  return bot
}

test('正常请求：透传 method/path/payload，返回 data', async () => {
  const calls = []
  const bot = makeBot(async cfg => {
    calls.push(cfg)
    return { data: { ok: true, code: 0 }, status: 200 }
  })
  attachRequest(bot)

  const res = await bot.request('put', '/guilds/G1/members/U1/mute', { mute_seconds: 600 })
  assert.deepEqual(res, { ok: true, code: 0 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'put')
  assert.equal(calls[0].url, '/guilds/G1/members/U1/mute')
  assert.deepEqual(calls[0].data, { mute_seconds: 600 })
})

test('限频：同一 key 超过 5 次/秒抛 QQBotRequestError，其余 key 不受影响', async () => {
  let n = 0
  const bot = makeBot(async () => ({ data: { ok: true }, status: 200 }))
  attachRequest(bot, { rate: { windowMs: 10000, max: 3 } })  // 放宽窗口便于断言

  for (let i = 0; i < 3; i++) await bot.request('get', '/channels/C1/pins')
  n = 0
  await assert.rejects(
    () => bot.request('get', '/channels/C1/pins'),
    err => err instanceof QQBotRequestError && /限频/.test(err.message),
    '第 4 次同 key 应限频',
  )
  // 不同 key 不受影响
  const res = await bot.request('get', '/channels/C2/pins')
  assert.deepEqual(res, { ok: true })
})

test('NotImplemented：音频/帖子/日程等长尾路径显式报错', async () => {
  const bot = makeBot(async () => ({ data: {}, status: 200 }))
  attachRequest(bot)

  await assert.rejects(
    () => bot.request('post', '/channels/C1/audio'),
    err => err instanceof NotImplementedError,
    '音频能力应 NotImplemented',
  )
  await assert.rejects(
    () => bot.request('get', '/channels/C1/threads/t1'),
    err => err instanceof NotImplementedError,
    '帖子应 NotImplemented',
  )
})

test('错误规范化：SDK 抛错转 QQBotRequestError 并带 API 标识', async () => {
  const bot = makeBot(async () => { throw new Error('request "/guilds/G1/roles" error with code(11298): 无权限') })
  attachRequest(bot)

  await assert.rejects(
    () => bot.request('post', '/guilds/G1/roles', {}),
    err => {
      assert.ok(err instanceof QQBotRequestError)
      assert.equal(err.api, 'POST /guilds/G1/roles')
      assert.match(err.message, /11298/)
      return true
    },
  )
})

test('rate=null 关闭限频', async () => {
  const bot = makeBot(async () => ({ data: { ok: true }, status: 200 }))
  attachRequest(bot, { rate: null })
  for (let i = 0; i < 20; i++) {
    await bot.request('get', '/channels/C1/pins')
  }
  // 若未限频则不会抛错，能执行到此处即通过
})