/**
 * SDK 事件层测试：验证 GROUP_MESSAGE_CREATE 补全与 group_openid 字段修复。
 *
 * 覆盖三处修复：
 * 1. QQEvent.GROUP_MESSAGE_CREATE 枚举存在且映射到 message.group
 * 2. EventParserMap 为其注册 MessageEvent.parse
 * 3. Intends.GROUP_MESSAGE_CREATE = 1<<25 已启用（原 SDK 被注释且误标 1<<24）
 * 4. GroupMessageEvent.group_id 取 group_openid（官方 v2 字段），兼容旧字段
 * 5. E8：官方 GROUP_MEMBER_EVENT = 1<<24 补齐（群成员进出 + 入群申请），
 *    以及 notice_id / timestamp 单位修复
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

// ---- E8：群成员变动与入群申请（官方 Intent GROUP_MEMBER_EVENT 1<<24）----

const noticeModule = require('../src/vendor/qq-group-bot/lib/event/notice.js')

/** 官方文档示例中的事件体（group_member_add / group_member_remove / group_join_request） */
const MEMBER_ADD_PAYLOAD = {
  timestamp: 1784276757,
  group_openid: 'B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5',
  member_openid: 'C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6',
  user_openid: 'C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6',
}
const JOIN_REQUEST_PAYLOAD = {
  group_openid: '30584554AA2BF4E72BD3B8F27A70339D',
  join_request_id: 'AVKiFWpdy0-q0rfCkpQFbWB9GvX7QPIe9hlsbVeO6TiurrZw1DHP0sXGnbUR4Xm79tKNpfl4zZynxeibVwwUD6h96RqiFB',
  member_openid: 'FE003FAF76C4817251FDC128A16753BB',
  username: '测试昵称',
  apply_at: '2026-08-05T16:21:40+08:00',
  apply_source: 'self_apply',
  verify_info: { method: 'verify_message', verify_message: '就快乐了' },
}

function makeNoticeBot() {
  const lines = []
  return {
    logger: { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) },
    lines,
  }
}

test('Intends 补齐官方 GROUP_MEMBER_EVENT = 1<<24', () => {
  assert.equal(Intends.GROUP_MEMBER_EVENT, 16777216, '官方 Intent 为 1<<24')
  assert.equal(Intends.GROUP_MEMBER_ADD, 16777216)
  assert.equal(Intends.GROUP_MEMBER_REMOVE, 16777216)
  assert.equal(Intends.GROUP_JOIN_REQUEST, 16777216)
  assert.notEqual(Intends.GROUP_MEMBER_EVENT, Intends.GROUP_MESSAGE_CREATE,
    '群成员事件 1<<24 与群消息 1<<25 是两位，不能混')
})

test('群成员三类事件枚举与解析器注册', () => {
  assert.equal(QQEvent.GROUP_MEMBER_ADD, 'notice.group.member.increase')
  assert.equal(QQEvent.GROUP_MEMBER_REMOVE, 'notice.group.member.decrease')
  assert.equal(QQEvent.GROUP_JOIN_REQUEST, 'notice.group.join.request')

  const addParser = EventParserMap.get(QQEvent.GROUP_MEMBER_ADD)
  assert.ok(addParser, '未注册解析器会被 dispatchEvent 兜底成 system 丢弃')
  assert.equal(EventParserMap.get(QQEvent.GROUP_MEMBER_REMOVE), addParser)
  assert.equal(EventParserMap.get(QQEvent.GROUP_JOIN_REQUEST),
    noticeModule.GroupJoinRequestNoticeEvent.parse)
})

test('GROUP_MEMBER_ADD 解析出群/成员标识与秒级时间戳', () => {
  const bot = makeNoticeBot()
  const ev = EventParserMap.get(QQEvent.GROUP_MEMBER_ADD)
    .call(bot, QQEvent.GROUP_MEMBER_ADD, MEMBER_ADD_PAYLOAD)
  assert.equal(ev.notice_type, 'group')
  assert.equal(ev.sub_type, 'member.increase')
  assert.equal(ev.group_id, 'B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5')
  assert.equal(ev.user_id, 'C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6')
  assert.equal(ev.real_id, 'C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6')
  assert.equal(ev.time, 1784276757, '官方 timestamp 是 Unix 秒，不能再 /1000')
})

test('GROUP_MEMBER_REMOVE 解析为 member.decrease', () => {
  const bot = makeNoticeBot()
  const ev = EventParserMap.get(QQEvent.GROUP_MEMBER_REMOVE)
    .call(bot, QQEvent.GROUP_MEMBER_REMOVE, MEMBER_ADD_PAYLOAD)
  assert.equal(ev.sub_type, 'member.decrease')
  assert.equal(ev.group_id, MEMBER_ADD_PAYLOAD.group_openid)
})

test('GROUP_JOIN_REQUEST 保留审批所需的 join_request_id 与验证信息', () => {
  const bot = makeNoticeBot()
  const ev = EventParserMap.get(QQEvent.GROUP_JOIN_REQUEST)
    .call(bot, QQEvent.GROUP_JOIN_REQUEST, JOIN_REQUEST_PAYLOAD)
  assert.equal(ev.sub_type, 'join.request')
  assert.equal(ev.group_id, JOIN_REQUEST_PAYLOAD.group_openid)
  assert.equal(ev.user_id, JOIN_REQUEST_PAYLOAD.member_openid)
  assert.equal(ev.username, '测试昵称')
  assert.equal(ev.join_request_id, JOIN_REQUEST_PAYLOAD.join_request_id,
    '审批接口需原样回传 join_request_id')
  assert.equal(ev.apply_source, 'self_apply')
  assert.deepEqual(ev.verify_info, JOIN_REQUEST_PAYLOAD.verify_info)
  assert.equal(ev.notice_id, JOIN_REQUEST_PAYLOAD.join_request_id)
})

test('群成员事件带稳定 notice_id（R6 去重依赖，SDK 原版缺失）', () => {
  const bot = makeNoticeBot()
  const a = EventParserMap.get(QQEvent.GROUP_MEMBER_ADD)
    .call(bot, QQEvent.GROUP_MEMBER_ADD, MEMBER_ADD_PAYLOAD)
  const b = EventParserMap.get(QQEvent.GROUP_MEMBER_ADD)
    .call(makeNoticeBot(), QQEvent.GROUP_MEMBER_ADD, MEMBER_ADD_PAYLOAD)
  assert.ok(a.notice_id, 'notice_id 为空会让 Core 侧 markProcessed(undefined) 去重失效')
  assert.equal(a.notice_id, b.notice_id, '同一事件重放应得到相同的去重键')
})

test('既有 notice 事件也补上了 notice_id 与秒级 timestamp', () => {
  const bot = makeNoticeBot()
  const friend = noticeModule.FriendChangeNoticeEvent.parse
    .call(bot, 'notice.friend.increase', { openid: 'u_1', timestamp: 1784570534 })
  assert.ok(friend.notice_id, 'FriendChangeNoticeEvent 原版不设 notice_id')
  assert.equal(friend.time, 1784570534, '原实现 /1000 会得到 1784570（1970 年）')

  const group = noticeModule.GroupChangeNoticeEvent.parse
    .call(bot, 'notice.group.increase',
      { group_openid: 'g_1', op_member_openid: 'op_1', timestamp: 1784570534 })
  assert.ok(group.notice_id, 'GroupChangeNoticeEvent 原版不设 notice_id')
  assert.equal(group.time, 1784570534)

  // 官方 C2C_MSG_RECEIVE 的 timestamp 为 integer（Unix 秒，文档示例 1784570617），
  // 该类原实现与 FriendChange 同源同错，上一轮漏修
  const receive = noticeModule.FriendReceiveNoticeEvent.parse
    .call(bot, 'notice.friend.receive_open', { openid: 'u_1', timestamp: 1784570617 })
  assert.ok(receive.notice_id, 'FriendReceiveNoticeEvent 原版不设 notice_id')
  assert.equal(receive.time, 1784570617, 'C2C_MSG_RECEIVE 的 /1000 是错算')
})

test('入群申请事件把 RFC3339 apply_at 归一为秒级 time', () => {
  const ev = noticeModule.GroupJoinRequestNoticeEvent.parse
    .call(makeNoticeBot(), 'notice.group.join.request', JOIN_REQUEST_PAYLOAD)
  // 2026-08-05T16:21:40+08:00 → 秒
  assert.equal(ev.time, Math.floor(Date.parse(JOIN_REQUEST_PAYLOAD.apply_at) / 1000))
  assert.equal(ev.apply_at, JOIN_REQUEST_PAYLOAD.apply_at, '原字符串同时保留，供插件直接展示')
  // 2026-08-05T16:21:40+08:00 → UTC 08:21:40，验证时区归一正确
  assert.equal(new Date(ev.time * 1000).toISOString(), '2026-08-05T08:21:40.000Z')
})

test('apply_at 非法时不应把 time 写成 NaN', () => {
  const ev = noticeModule.GroupJoinRequestNoticeEvent.parse.call(makeNoticeBot(),
    'notice.group.join.request', { ...JOIN_REQUEST_PAYLOAD, apply_at: 'not-a-date' })
  assert.equal(ev.time, undefined, '无法解析的时间应缺省，而不是污染出 NaN')
  assert.ok(ev.notice_id, '无 apply_at 时仍要有稳定去重键')
})