import plugin from '../../../src/infrastructure/plugins/plugin.js'
import ConfigLoader from '../../../src/infrastructure/commonconfig/loader.js'

export class QQBotAdapter extends plugin {
  constructor() {
    super({
      name: 'QQBotAdapter',
      dsc: 'QQBot 适配器设置',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#QQBot账号$',
          fnc: 'listAccounts',
          permission: 'master',
        },
        {
          reg: '^#QQBot设置[0-9]+:[0-9]+:.+:.+:([01]:[01]|2)$',
          fnc: 'setToken',
          permission: 'master',
        },
        {
          reg: '^#QQBot删除[0-9]+$',
          fnc: 'removeToken',
          permission: 'master',
        },
        {
          reg: '^#QQBotM(?:ark)?D(?:own)?[0-9]+:',
          fnc: 'setMarkdown',
          permission: 'master',
        },
        {
          reg: '^#QQBot绑定用户.+$',
          fnc: 'bindUser',
        },
      ]
    })
    this.configInstance = null
  }

  async init() {
    this.configInstance = ConfigLoader.get('qqbot')
  }

  async getConfig() {
    if (!this.configInstance) {
      this.configInstance = ConfigLoader.get('qqbot')
    }
    if (!this.configInstance) {
      throw new Error('QQBot配置实例未找到')
    }
    return await this.configInstance.read()
  }

  async saveConfig(data) {
    if (!this.configInstance) {
      this.configInstance = ConfigLoader.get('qqbot')
    }
    return await this.configInstance.write(data)
  }

  async listAccounts(e) {
    try {
      const config = await this.getConfig()
      const tokens = config.token || []
      
      if (tokens.length === 0) {
        await e.reply('暂无QQBot账号配置')
        return true
      }

      const msg = [`QQBot账号列表 (共${tokens.length}个):`, '']
      for (let i = 0; i < tokens.length; i++) {
        const parts = tokens[i].split(':')
        const display = `${i + 1}. ID: ${parts[0]} | AppID: ${parts[1]} | 群消息: ${parts[4] === '1' ? '开启' : '关闭'} | 频道消息: ${parts[5] === '1' ? '开启' : '关闭'}`
        msg.push(display)
      }
      
      await e.reply(msg.join('\n'))
      return true
    } catch (err) {
      await e.reply(`获取账号列表失败: ${err.message}`)
      return false
    }
  }

  async setToken(e) {
    try {
      const token = e.msg.replace(/^#QQBot设置/, '').trim()
      const config = await this.getConfig()
      
      if (!config.token) config.token = []
      
      const parts = token.split(':')
      const botId = parts[0]
      const existingIndex = config.token.findIndex(t => t.startsWith(`${botId}:`))
      
      if (existingIndex >= 0) {
        config.token[existingIndex] = token
        await this.saveConfig(config)
        await e.reply(`QQBot账号 ${botId} 已更新，重启后生效`)
      } else {
        config.token.push(token)
        await this.saveConfig(config)
        await e.reply(`QQBot账号 ${botId} 已添加，重启后生效`)
      }
      
      return true
    } catch (err) {
      await e.reply(`设置账号失败: ${err.message}`)
      return false
    }
  }

  async removeToken(e) {
    try {
      const botId = e.msg.replace(/^#QQBot删除/, '').trim()
      const config = await this.getConfig()
      
      if (!config.token || config.token.length === 0) {
        await e.reply('暂无可删除的QQBot账号')
        return true
      }

      const beforeLen = config.token.length
      config.token = config.token.filter(t => !t.startsWith(`${botId}:`))
      
      if (config.token.length === beforeLen) {
        await e.reply(`未找到QQBot账号 ${botId}`)
        return true
      }
      
      await this.saveConfig(config)
      await e.reply(`QQBot账号 ${botId} 已删除，重启后生效`)
      return true
    } catch (err) {
      await e.reply(`删除账号失败: ${err.message}`)
      return false
    }
  }

  async setMarkdown(e) {
    try {
      let token = e.msg.replace(/^#QQBotM(?:ark)?D(?:own)?/, '').trim().split(':')
      const botId = token.shift()
      const templateId = token.join(':')
      
      const config = await this.getConfig()
      if (!config.markdown) config.markdown = { template: 'abcdefghij' }
      config.markdown[botId] = templateId
      
      await this.saveConfig(config)
      await e.reply(`QQBot ${botId} Markdown模板已设置为 ${templateId}`)
      return true
    } catch (err) {
      await e.reply(`设置Markdown失败: ${err.message}`)
      return false
    }
  }

  async bindUser(e) {
    try {
      const id = e.msg.replace(/^#QQBot绑定用户(确认)?/, '').trim()
      
      if (id === e.user_id) {
        await e.reply('请切换到对应Bot进行绑定')
        return true
      }

      const tasker = Bot.tasker.find(t => t.id === 'QQBot')
      if (!tasker) {
        await e.reply('QQBot Tasker 未加载')
        return true
      }

      tasker.bind_user[e.user_id] = id
      
      await e.reply([
        `绑定 ${id} → ${e.user_id}`,
        { type: 'button', data: [[{ text: '确认绑定', callback: `#QQBot绑定用户确认${e.user_id}`, permission: e.user_id }]] }
      ])
      return true
    } catch (err) {
      await e.reply(`绑定用户失败: ${err.message}`)
      return false
    }
  }
}
