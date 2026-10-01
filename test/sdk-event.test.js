/**
 * SDK 事件层测试：验证 GROUP_MESSAGE_CREATE 补全与 group_openid 字段修复。
 *
 * 覆盖三处修复：
 * 1. QQEvent.GROUP_MESSAGE_CREATE 枚举存在且映射到 message.group
 * 2. EventParserMap 为其注册 MessageEvent.parse
 * 3. Intends.GROUP_MESSAGE_CREATE = 1<<24 已启用（原 SDK 被注释）
 * 4. GroupMessageEvent.group_id 取 group_openid（官方 v2 字段），兼容旧字段
 *
 * SDK 是 CommonJS 产物（vendor），直接 require 加载。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const eventIndex = require('../src/vendor/qq-group-bot/lib/event/index.js')
const constans = require('../src/vendor/qq-group-bot/lib/constans.js')

const { QQEvent, EventParserMap } = eventIndex
const { Intends } = constans

// ---- 1. 事件枚举 ----

test('GROUP_MESSAGE_CREATE 枚举存在且映射为 message.group', () => {
  assert.equal(QQEvent.GROUP_MESSAGE_CREATE, 'message.group')
  assert.equal(QQEvent.GROUP_AT_MESSAGE_CREATE, 'message.group',
    '全量群消息与 @ 群消息同属群消息场景')
})

test('GROUP_MESSAGE_CREATE 注册了 MessageEvent.parse', () => {
  assert.ok(EventParserMap.has(QQEvent.GROUP_MESSAGE_CREATE),
    '未注册解析器的事件会被 dispatchEvent 兜底成 system 丢弃')
  assert.equal(
    EventParserMap.get(QQEvent.GROUP_MESSAGE_CREATE),
    EventParserMap.get(QQEvent.GROUP_AT_MESSAGE_CREATE),
    '应与 GROUP_AT_MESSAGE_CREATE 使用同一解析器',
  )
})

// ---- 2. intents ----

test('Intends.GROUP_MESSAGE_CREATE 已启用（官方 GROUP_AND_C2C_EVENT = 1<<25）', () => {
  // 官方文档：GROUP_MESSAGE_CREATE 的 Intent 为 GROUP_AND_C2C_EVENT (1<<25)，
  // 与 GROUP_AT_MESSAGE_CREATE / C2C_MESSAGE_CREATE 同一位。
  assert.equal(Intends.GROUP_MESSAGE_CREATE, 33554432)
  assert.equal(Intends.GROUP_MESSAGE_CREATE, Intends.GROUP_AT_MESSAGE_CREATE,
    '官方文档：与 @ 消息共用 GROUP_AND_C2C_EVENT 位')
  assert.equal(Intends.GROUP_MESSAGE_CREATE, Intends.C2C_MESSAGE_CREATE)
})

test('GROUP_MESSAGE_CREATE intents 位可被 getValidIntends 正确聚合', () => {
  // 与 GROUP_AT_MESSAGE_CREATE 同一位：同时订阅不产生额外位，也不会冲突
  const value = Intends.GROUP_AT_MESSAGE_CREATE | Intends.C2C_MESSAGE_CREATE | Intends.GROUP_MESSAGE_CREATE
  assert.equal(value, 33554432, '同一位聚合后仍是 1<<25')
})

// ---- 3. group_openid 字段解析 ----

/** 最小 bot 桩（MessageEvent.parse 需要 self_id / logger / config / removeAt） */
function makeBot() {
  return {
    self_id: 'B1',
    config: {},
    logger: { info: () => {} },
    removeAt(payload) {
      // 与 QQBot.removeAt 同逻辑：仅在 content 含 <@!self_id> 且 mentions 命中时裁剪
      if (this.config.removeAt === false) return
      const reg = new RegExp(`<@!${this.self_id}>`)
      const isAtMe = reg.test(payload.content) && payload.mentions.some((mention) => mention.id === this.self_id)
      if (!isAtMe) return
      payload.content = payload.content.replace(reg, '').trimStart()
    },
  }
}

test('GroupMessageEvent.group_id 取官方 group_openid 字段', async () => {
  const { MessageEvent } = require('../src/vendor/qq-group-bot/lib/event/message.js')
  const payload = {
    content: 'hello',
    id: 'msg-gm-1',
    group_openid: 'g_openid_ABC',
    author: { id: 'u_openid_1', username: '张三', user_openid: 'u_openid_1' },
    timestamp: '2026-09-30T22:00:00+08:00',
  }
  const ev = MessageEvent.parse.call(makeBot(), 'message.group', payload)
  assert.equal(ev.group_id, 'g_openid_ABC',
    '官方 v2 事件用 group_openid，旧代码读 payload.group_id 得到 undefined')
  assert.equal(ev.message_type, 'group')
})

test('group_openid 缺失时回落旧 group_id 字段（向后兼容）', async () => {
  const { MessageEvent } = require('../src/vendor/qq-group-bot/lib/event/message.js')
  const payload = {
    content: 'hi',
    id: 'msg-gm-2',
    group_id: 'legacy_gid',
    author: { id: 'u_openid_1', username: '李四', user_openid: 'u_openid_1' },
    timestamp: '2026-09-30T22:00:00+08:00',
  }
  const ev = MessageEvent.parse.call(makeBot(), 'message.group', payload)
  assert.equal(ev.group_id, 'legacy_gid')
})

test('group_openid 优先级高于 group_id（两者同存时用官方字段）', async () => {
  const { MessageEvent } = require('../src/vendor/qq-group-bot/lib/event/message.js')
  const payload = {
    content: 'hi',
    id: 'msg-gm-3',
    group_openid: 'official_openid',
    group_id: 'legacy_gid',
    author: { id: 'u_openid_1', username: '王五', user_openid: 'u_openid_1' },
    timestamp: '2026-09-30T22:00:00+08:00',
  }
  const ev = MessageEvent.parse.call(makeBot(), 'message.group', payload)
  assert.equal(ev.group_id, 'official_openid')
})

test('群消息 user_id 从 author.id 提取', async () => {
  const { MessageEvent } = require('../src/vendor/qq-group-bot/lib/event/message.js')
  const payload = {
    content: 'hi',
    id: 'msg-gm-4',
    group_openid: 'g_openid_1',
    author: { id: 'u_openid_XYZ', username: '赵六', user_openid: 'u_openid_XYZ' },
    timestamp: '2026-09-30T22:00:00+08:00',
  }
  const ev = MessageEvent.parse.call(makeBot(), 'message.group', payload)
  assert.equal(ev.user_id, 'u_openid_XYZ')
  assert.equal(ev.message_id, 'msg-gm-4')
})