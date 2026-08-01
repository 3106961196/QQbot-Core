import ListenerBase from '../../../src/infrastructure/listener/base.js'
import { normalizeError } from '../../../src/utils/normalize-error.js'

/**
 * QQBot 官方机器人事件监听
 * Tasker 发出 qqbot.message / qqbot.notice / qqbot.connect 后由此进入插件链
 */
export default class QQBotEvent extends ListenerBase {
  constructor() {
    super('qqbot')
  }

  async init() {
    const bot = this.bot || AgentRuntime
    for (const t of ['message', 'notice', 'connect', 'disconnect']) {
      bot.on(`qqbot.${t}`, (e) => this.handleEvent(e))
    }
  }

  async handleEvent(e) {
    if (!e) return
    try {
      if (!this.normalizeEventBase(e)) return
      await this.plugins.deal(e)
    } catch (err) {
      const error = normalizeError(err)
      AgentRuntime.makeLog('error', `处理 QQBot 事件失败: ${error.message}`, e?.self_id, error)
    }
  }

  normalizeEventBase(e) {
    e.bot = e.bot || (e.self_id ? AgentRuntime[e.self_id] : null)
    if (!e.bot && e.post_type === 'message') {
      AgentRuntime.makeLog('warn', `AgentRuntime 账号不存在，忽略事件：${e.self_id}`, 'QQBotEvent')
      return false
    }

    this.ensureEventId(e)
    if (!this.markProcessed(e)) return false
    this.markAdapter(e, { isQQBot: true })

    if (!e.raw_message && Array.isArray(e.message) && e.message.length > 0) {
      e.raw_message = e.message
        .map(seg => {
          if (seg.type === 'text') return seg.text || ''
          if (seg.type === 'at') return `@${seg.qq || seg.user_id || ''}`
          if (seg.type === 'image') return '[图片]'
          if (seg.type === 'face') return '[表情]'
          if (seg.type === 'record') return '[语音]'
          if (seg.type === 'video') return '[视频]'
          if (seg.type === 'reply') return `[回复:${seg.id || ''}]`
          return `[${seg.type}]`
        })
        .join('')
    }

    if (!e.msg && e.raw_message) e.msg = e.raw_message
    if (!e.self_id && e.bot?.uin) e.self_id = e.bot.uin

    e.isPrivate = e.message_type === 'private' || (!e.group_id && !!e.user_id)
    e.isGroup = e.message_type === 'group' || !!e.group_id

    return true
  }
}
