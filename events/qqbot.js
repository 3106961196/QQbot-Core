import EventListenerBase from '../../../src/infrastructure/listener/base.js'

export default class QQBotEvent extends EventListenerBase {
  constructor() {
    super('qqbot')
    this.prefix = ''
    this.event = [
      'message.private.friend',
      'message.private.callback',
      'message.group.normal',
      'message.guild',
      'connect'
    ]
  }

  async execute(e) {
    if (!e) return false

    Bot.makeLog('debug', `QQBotEvent.execute: post_type=${e.post_type}, message_type=${e.message_type}, reply=${typeof e.reply}`, e.self_id)

    this.ensureEventId(e)
    if (!this.markProcessed(e)) return false

    this.markAdapter(e, { isQQBot: true })

    if (!this.normalizeEvent(e)) return false

    Bot.makeLog('debug', `QQBotEvent: 处理事件, reply=${typeof e.reply}, user_id=${e.user_id}`, e.self_id)

    return await this.plugins.deal(e)
  }

  normalizeEvent(e) {
    const bot = e.bot || (e.self_id ? Bot[e.self_id] : null)
    if (!bot) {
      Bot.makeLog('warn', `Bot对象不存在，忽略事件：${e.self_id}`, 'QQBotEvent')
      return false
    }

    try {
      if (!e.bot) {
        Object.defineProperty(e, 'bot', { value: bot, writable: true, configurable: true })
      }
    } catch {
      // 属性已存在，忽略
    }

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

    if (!e.msg && e.raw_message) {
      e.msg = e.raw_message
    }

    if (!e.self_id && bot.uin) {
      e.self_id = bot.uin
    }

    return true
  }
}
