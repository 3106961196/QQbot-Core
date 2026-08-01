import EnhancerBase from '../../../src/infrastructure/plugins/enhancer-base.js'

/**
 * QQBot 事件增强：挂载 friend / group / member，统一 isQQBot
 */
export default class QQBotEnhancer extends EnhancerBase {
  constructor() {
    super({
      name: 'QQBot',
      dsc: 'QQBot 事件增强与实体绑定',
      event: 'qqbot.*',
      tasker: 'qqbot',
      priority: 100,
    })
  }

  isTargetEvent(e, taskerName) {
    return taskerName === 'qqbot' || e.isQQBot === true
  }

  enhanceEvent(e) {
    super.enhanceEvent(e)
    // 框架对未知 tasker 会生成 isQqbot；本 Core 统一用 isQQBot
    e.isQQBot = true
    if (e.isQqbot != null) delete e.isQqbot
    e.isPrivate = e.message_type === 'private' || (!e.group_id && !!e.user_id)
    e.isGroup = e.message_type === 'group' || !!e.group_id
    this.bindBotEntities(e)
  }
}
