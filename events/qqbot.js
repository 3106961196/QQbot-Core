import ListenerBase from '../../../src/infrastructure/listener/base.js'
import { normalizeError } from '../../../src/utils/normalize-error.js'

/** Tasker 发 qqbot.* → 插件链（属性增强见 qqbot-enhancer） */
export default class QQBotEvent extends ListenerBase {
  constructor() {
    super('qqbot')
  }

  async init() {
    const bot = this.bot || AgentRuntime
    for (const t of ['message', 'notice', 'connect', 'disconnect']) {
      bot.on(`qqbot.${t}`, e => this.handleEvent(e))
    }
  }

  async handleEvent(e) {
    if (!e) return
    try {
      // bot 由 AgentRuntime.prepareEvent / makeMessage 挂载（可能只读），勿再赋值
      if (!e.bot && e.post_type === 'message') {
        AgentRuntime.makeLog('warn', `账号不存在，忽略: ${e.self_id}`, e.self_id)
        return
      }
      this.ensureEventId(e)
      if (!this.markProcessed(e)) return
      this.markAdapter(e, { isQQBot: true })
      if (!e.msg && e.raw_message) e.msg = e.raw_message
      await this.plugins.deal(e)
    } catch (err) {
      const error = normalizeError(err)
      AgentRuntime.makeLog('error', `QQBot 事件失败: ${error.message}`, e?.self_id, error)
    }
  }
}
