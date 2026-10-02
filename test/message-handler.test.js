/**
 * message-handler 测试：验证 P1 修复 R4（按钮回调双入口）/ R5（notice 结构化）/ R6（事件去重）。
 *
 * 关键手法：message-handler.js 用裸名 `AgentRuntime`（运行时全局），
 * 测试须在 import 前把它挂到 globalThis，否则模块内引用会 ReferenceError。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

// ---- 必须在 import message-handler 之前挂全局（ESM import 提升）----
const logs = []
const emitted = []
globalThis.AgentRuntime = {
  makeLog: (level, msg, ...rest) => logs.push([level, msg, ...rest]),
  String: o => { try { return JSON.stringify(o) } catch { return String(o) } },
  em: (name, data) => emitted.push({ name, data }),
  'B1': { callback: {}, fl: new Map(), gl: new Map(), gml: new Map() },
}

const { MessageHandler } = await import('../tasker/message-handler.js')

/** 最小 tasker 桩 */
function makeHandler() {
  const tasker = { config: {}, sep: ':', bind_user: {} }
  return new MessageHandler(tasker)
}

/** 造一条 QQ 群消息事件（模拟 SDK GroupMessageEvent） */
function groupMsgEvent(msgid = 'msg-1') {
  return {
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: msgid,
    message: [{ type: 'text', text: 'hi' }],
    raw_message: 'hi',
    group_id: 'g_openid_1',
    sender: { user_id: 'u_openid_1', nickname: '张三' },
  }
}

/** 造一条按钮点击（action）事件 */
function actionEvent(notice_type, extra = {}) {
  const ev = new EventEmitter()
  ev.replied = false
  ev.sub_type = 'action'
  ev.notice_type = notice_type
  ev.event_id = 'evt-btn-1'
  ev.notice_id = 'notice-btn-1'
  ev.operator_id = 'op_openid_1'
  ev.data = { resolved: { button_id: 'btn-1', button_data: '点我' } }
  ev.reply = async () => { ev.replied = true }
  Object.assign(ev, extra)
  return ev
}

// ============ R6：事件去重（稳定 event_id）============

test('R6：消息事件带稳定 event_id（供底层 markProcessed 去重）', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeMessage('B1', groupMsgEvent('msg-42'))
  assert.equal(emitted.length, 1, '应 emit 一次')
  const d = emitted[0].data
  assert.equal(d.event_id, 'msg-42', 'event_id 应等于 message_id，使重放可被识别')
})

test('R6：相同 message_id 的重放产生相同 event_id（去重前提）', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeMessage('B1', groupMsgEvent('msg-dup'))
  await h.makeMessage('B1', groupMsgEvent('msg-dup'))
  assert.equal(emitted.length, 2, 'Tasker 层两次都 emit（去重在 Listener 层做）')
  const ids = emitted.map(e => e.data.event_id)
  assert.equal(ids[0], ids[1], '两次的 event_id 必须相同，否则底层无法识别为重复')
})

test('R6：按钮回调带稳定 event_id', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeCallback('B1', actionEvent('friend'))
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].data.event_id, 'event_evt-btn-1', '回调 event_id 派生自 event_id')
})

test('GROUP_MESSAGE_CREATE：非@群消息不插 at 段', async () => {
  emitted.length = 0
  const h = makeHandler()
  // 模拟 SDK 解析出的 GroupMessageEvent（dispatchEvent 挂 _raw_event + _isAtBot）
  await h.makeMessage('B1', {
    ...groupMsgEvent('msg-gmc-1'),
    _raw_event: 'GROUP_MESSAGE_CREATE',
    _isAtBot: false,
  })
  const d = emitted[0].data
  assert.equal(d.message_type, 'group')
  assert.ok(!d.message.some(m => m.type === 'at' && m.qq === 'B1'),
    '群内全量消息（未被@）不应伪造 at 段，否则插件误判为被@')
})

test('GROUP_MESSAGE_CREATE：全量模式下 @ 机器人的消息仍插 at 段（mentions 判定）', async () => {
  emitted.length = 0
  const h = makeHandler()
  // 全量模式下 @ 消息事件名也是 GROUP_MESSAGE_CREATE，只能靠 _isAtBot 区分
  await h.makeMessage('B1', {
    ...groupMsgEvent('msg-gmc-at-1'),
    _raw_event: 'GROUP_MESSAGE_CREATE',
    _isAtBot: true,
  })
  const d = emitted[0].data
  assert.ok(d.message.some(m => m.type === 'at' && m.qq === 'B1'),
    '全量模式下被 @ 的消息应补 at 标记（mentions 命中）')
})

test('GROUP_AT_MESSAGE_CREATE：@群消息保留 at 段（兼容现有行为）', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeMessage('B1', {
    ...groupMsgEvent('msg-gat-1'),
    _raw_event: 'GROUP_AT_MESSAGE_CREATE',
    _isAtBot: true,
  })
  const d = emitted[0].data
  assert.ok(d.message.some(m => m.type === 'at' && m.qq === 'B1'),
    '@ 群消息保持原有 at 标记行为')
})

test('旧事件（无 _raw_event）：保持原有 at 行为（向后兼容）', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeMessage('B1', groupMsgEvent('msg-legacy-1'))
  const d = emitted[0].data
  assert.ok(d.message.some(m => m.type === 'at' && m.qq === 'B1'))
})

test('R6：notice 事件带稳定 event_id（notice_id）', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeNotice('B1', {
    post_type: 'notice',
    notice_type: 'friend',
    sub_type: 'increase',
    notice_id: 'ntc-1',
    user_id: 'u_openid_9',
    time: 1700000000,
  })
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].data.event_id, 'ntc-1')
})

// ============ R5：notice 结构化映射 ============

test('R5：friend.increase → friend_add 并透出 user_id', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeNotice('B1', {
    // 模拟 SDK FriendChangeNoticeEvent（已解析字段）
    post_type: 'notice', notice_type: 'friend', sub_type: 'increase',
    notice_id: 'n1', user_id: 'u_openid_9', time: 1700000000,
  })
  const d = emitted[0].data
  assert.equal(d.post_type, 'notice')
  assert.equal(d.notice_event, 'friend_add', '应映射为 OneBot 风格 friend_add')
  assert.equal(d.user_id, 'u_openid_9', '应透出 user_id（来自 openid）')
})

test('R5：group.increase → group_increase 且 group_id 带 bot 前缀', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeNotice('B1', {
    // 模拟 SDK GroupChangeNoticeEvent（已解析字段）
    post_type: 'notice', notice_type: 'group', sub_type: 'increase',
    notice_id: 'n2', group_id: 'g_openid_7', operator_id: 'op_openid_3',
    time: 1700000000,
  })
  const d = emitted[0].data
  assert.equal(d.notice_event, 'group_increase')
  assert.equal(d.group_id, 'B1:g_openid_7', 'group_id 应加 "<self_id>:" 前缀（与消息侧一致）')
  assert.equal(d.operator_id, 'op_openid_3')
})

test('R5：guild.member.increase → group_member_increase 且带 user_id', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeNotice('B1', {
    // 模拟 SDK GuildMemberChangeNoticeEvent（已解析字段）
    post_type: 'notice', notice_type: 'guild', sub_type: 'member.increase',
    notice_id: 'n3', guild_id: 'guild_1', user_id: 'u_qg_1',
    user_name: '李四', is_bot: false, operator_id: 'op_1', time: 1700000000,
  })
  const d = emitted[0].data
  assert.equal(d.notice_event, 'group_member_increase')
  assert.equal(d.guild_id, 'guild_1')
  assert.equal(d.user_id, 'u_qg_1', '应取 user.id 作为 user_id')
  assert.equal(d.operator_id, 'op_1')
})

test('E8：group.member.increase → group_member_increase 且带 user_id/real_id', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeNotice('B1', {
    // 模拟 SDK GroupMemberChangeNoticeEvent（官方 GROUP_MEMBER_ADD 解析结果）
    post_type: 'notice', notice_type: 'group', sub_type: 'member.increase',
    notice_id: 'g_1.m_1.1784276757',
    group_id: 'g_openid_7', user_id: 'm_openid_3', real_id: 'u_openid_3',
    time: 1784276757,
  })
  const d = emitted[0].data
  assert.equal(d.notice_event, 'group_member_increase')
  assert.equal(d.group_id, 'B1:g_openid_7', 'group_id 应加 bot 前缀（与消息侧一致）')
  assert.equal(d.user_id, 'm_openid_3', 'user_id 取官方 member_openid')
  assert.equal(d.real_id, 'u_openid_3', 'real_id 取官方 user_openid')
})

test('E8：group.member.decrease → group_member_decrease', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeNotice('B1', {
    post_type: 'notice', notice_type: 'group', sub_type: 'member.decrease',
    notice_id: 'g_1.m_1.1784276759',
    group_id: 'g_openid_7', user_id: 'm_openid_3', real_id: 'u_openid_3',
    time: 1784276759,
  })
  const d = emitted[0].data
  assert.equal(d.notice_event, 'group_member_decrease')
  assert.equal(d.user_id, 'm_openid_3')
})

test('E8：group.join.request → group_join_request 且透出 join_request_id', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeNotice('B1', {
    post_type: 'notice', notice_type: 'group', sub_type: 'join.request',
    notice_id: 'AVKiFWpdy0-req-id',
    group_id: 'g_openid_9', user_id: 'm_openid_9', username: '申请人',
    join_request_id: 'AVKiFWpdy0-req-id', apply_source: 'self_apply',
    verify_info: { method: 'verify_message', verify_message: '就快乐了' },
  })
  const d = emitted[0].data
  assert.equal(d.notice_event, 'group_join_request')
  assert.equal(d.group_id, 'B1:g_openid_9')
  assert.equal(d.join_request_id, 'AVKiFWpdy0-req-id',
    '审批接口需原样回传该 id，插件要能直接取到')
  assert.equal(d.username, '申请人')
  assert.equal(d.apply_source, 'self_apply')
  assert.deepEqual(d.verify_info, { method: 'verify_message', verify_message: '就快乐了' })
})

test('R5：未知 notice 记录 warn 但仍 emit（插件可见，不静默吞）', async () => {
  emitted.length = 0
  logs.length = 0
  const h = makeHandler()
  await h.makeNotice('B1', {
    post_type: 'notice', notice_type: 'forum', sub_type: 'weird',
    notice_id: 'n4',
  })
  assert.ok(logs.some(l => l[0] === 'warn'), '应记 warn')
  assert.equal(emitted.length, 1, '仍应 emit，让插件有机会自行处理')
})

// ============ R4：按钮回调双入口 ============

test('R4：friend 按钮回调 message_type 归一为 private（与消息侧一致）', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeCallback('B1', actionEvent('friend'))
  const d = emitted[0].data
  assert.equal(d.message_type, 'private', "SDK 的 'friend' 应归一为 'private'，不再 fallthrough 到 default")
  assert.equal(typeof d.reply, 'function', '应提供 reply')
})

test('R4：group 按钮回调 message_type=group 且带前缀 group_id', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeCallback('B1', actionEvent('group', { group_id: 'g_openid_1' }))
  const d = emitted[0].data
  assert.equal(d.message_type, 'group')
  assert.equal(d.group_id, 'B1:g_openid_1')
})

test('R4：guild 按钮回调不再被丢弃（原先 case "guild": break）', async () => {
  emitted.length = 0
  logs.length = 0
  const h = makeHandler()
  await h.makeCallback('B1', actionEvent('guild', { guild_id: 'guild_9', channel_id: 'ch_1' }))
  const d = emitted[0].data
  assert.equal(d.message_type, 'group', '频道回调与频道消息统一为 group 语义')
  assert.equal(d.group_id, 'qg_guild_9-ch_1', 'guild 用 qg_ 前缀，与 makeGuildMessage 一致')
  assert.equal(typeof d.reply, 'function', '原先空 break 导致无 reply，插件无法回复')
  assert.ok(!logs.some(l => l[0] === 'warn'), '不应记未知类型 warn')
})

test('R4：makeNotice 遇 action 时委派 makeCallback（单一回调入口）', async () => {
  emitted.length = 0
  const h = makeHandler()
  await h.makeNotice('B1', actionEvent('friend'))
  assert.equal(emitted.length, 1, 'action 应经 makeCallback emit，且只 emit 一次')
  assert.equal(emitted[0].data.sub_type, 'callback')
})
