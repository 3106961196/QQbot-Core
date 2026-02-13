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

    this.ensureEventId(e)
    if (!this.markProcessed(e)) return false

    this.markAdapter(e, { isQQBot: true })

    if (!this.normalizeEvent(e)) return false

    return await this.plugins.deal(e)
  }

  normalizeEvent(e) {
    // 部分事件对象是只读的，直接写 e.bot 会报错，这里改为使用局部变量
    const bot = e.bot || (e.self_id ? Bot[e.self_id] : null)
    if (!bot) {
      Bot.makeLog('warn', `Bot对象不存在，忽略事件：${e.self_id}`, 'QQBotEvent')
      return false
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

    if (!e.self_id && bot && bot.uin) {
      e.self_id = bot.uin
    }

    if (e.post_type === 'connect') {
      Bot.makeLog('mark', `QQBot ${e.self_id} 已连接`, 'QQBotEvent')
      return false
    }

    return true
  }
}
