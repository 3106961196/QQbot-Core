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
          reg: '^#QQBot添加账号\\s*(\\S+):(\\S+)$',
          fnc: 'addAccount',
          permission: 'master',
        },
        {
          reg: '^#QQBot删除账号\\s*(\\S+)$',
          fnc: 'removeAccount',
          permission: 'master',
        },
        {
          reg: '^#QQBot启用\\s*(\\S+)$',
          fnc: 'enableAccount',
          permission: 'master',
        },
        {
          reg: '^#QQBot禁用\\s*(\\S+)$',
          fnc: 'disableAccount',
          permission: 'master',
        },
      ]
    })
    this.configInstance = null
  }

  getTasker() {
    return Bot.tasker.find(t => t.id === 'QQBot')
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
      const accounts = config.accounts || []
      const tasker = this.getTasker()
      
      if (accounts.length === 0) {
        await e.reply('暂无QQBot账号配置\n使用 #QQBot添加账号 AppID:ClientSecret 添加账号')
        return true
      }

      const msg = ['QQBot账号列表:', '']
      for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i]
        const isOnline = tasker && tasker.bots.has(acc.appId)
        const status = isOnline ? '🟢 在线' : (acc.enabled !== false ? '⚪ 离线' : '❌ 禁用')
        const md = acc.markdownSupport ? ' [MD]' : ''
        msg.push(`${i + 1}. [${acc.name}] ${status}${md}`)
        msg.push(`   AppID: ${acc.appId}`)
      }
      
      await e.reply(msg.join('\n'))
      return true
    } catch (err) {
      await e.reply(`获取账号列表失败: ${err.message}`)
      return false
    }
  }

  async addAccount(e) {
    try {
      const match = e.msg.match(/^#QQBot添加账号\s*(\S+):(\S+)$/)
      if (!match) {
        await e.reply('格式: #QQBot添加账号 AppID:ClientSecret')
        return true
      }

      const [, appId, clientSecret] = match
      const config = await this.getConfig()
      
      if (!config.accounts) config.accounts = []
      
      const existingIndex = config.accounts.findIndex(a => a.appId === appId)
      
      const account = {
        name: appId,
        appId,
        clientSecret,
        enabled: true,
        markdownSupport: false
      }
      
      const tasker = this.getTasker()
      
      if (existingIndex >= 0) {
        config.accounts[existingIndex] = { ...config.accounts[existingIndex], ...account }
        await this.saveConfig(config)
        
        if (tasker) {
          await tasker.disconnect(appId)
          const success = await tasker.connect(account)
          if (success) {
            await e.reply(`QQBot账号 ${appId} 已更新并重新连接`)
          } else {
            await e.reply(`QQBot账号 ${appId} 已更新，但连接失败`)
          }
        } else {
          await e.reply(`QQBot账号 ${appId} 已更新`)
        }
      } else {
        config.accounts.push(account)
        await this.saveConfig(config)
        
        if (tasker) {
          const success = await tasker.connect(account)
          if (success) {
            await e.reply(`QQBot账号 ${appId} 已添加并连接成功`)
          } else {
            await e.reply(`QQBot账号 ${appId} 已添加，但连接失败`)
          }
        } else {
          await e.reply(`QQBot账号 ${appId} 已添加`)
        }
      }
      
      return true
    } catch (err) {
      await e.reply(`添加账号失败: ${err.message}`)
      return false
    }
  }

  async removeAccount(e) {
    try {
      const match = e.msg.match(/^#QQBot删除账号\s*(\S+)$/)
      if (!match) return false
      
      const appId = match[1]
      const config = await this.getConfig()
      
      if (!config.accounts || config.accounts.length === 0) {
        await e.reply('暂无可删除的QQBot账号')
        return true
      }

      const beforeLen = config.accounts.length
      config.accounts = config.accounts.filter(a => a.appId !== appId && a.name !== appId)
      
      if (config.accounts.length === beforeLen) {
        await e.reply(`未找到QQBot账号 ${appId}`)
        return true
      }
      
      await this.saveConfig(config)
      
      const tasker = this.getTasker()
      if (tasker) {
        await tasker.disconnect(appId)
        await e.reply(`QQBot账号 ${appId} 已删除并断开连接`)
      } else {
        await e.reply(`QQBot账号 ${appId} 已删除`)
      }
      
      return true
    } catch (err) {
      await e.reply(`删除账号失败: ${err.message}`)
      return false
    }
  }

  async enableAccount(e) {
    return await this.toggleAccount(e, true)
  }

  async disableAccount(e) {
    return await this.toggleAccount(e, false)
  }

  async toggleAccount(e, enabled) {
    try {
      const match = e.msg.match(/^#QQBot(启用|禁用)\s*(\S+)$/)
      if (!match) return false
      
      const appId = match[2]
      const config = await this.getConfig()
      
      if (!config.accounts) {
        await e.reply('暂无QQBot账号配置')
        return true
      }

      const account = config.accounts.find(a => a.appId === appId || a.name === appId)
      if (!account) {
        await e.reply(`未找到QQBot账号 ${appId}`)
        return true
      }
      
      account.enabled = enabled
      await this.saveConfig(config)
      
      const tasker = this.getTasker()
      if (tasker) {
        if (enabled) {
          const success = await tasker.connect(account)
          if (success) {
            await e.reply(`QQBot账号 ${appId} 已启用并连接成功`)
          } else {
            await e.reply(`QQBot账号 ${appId} 已启用，但连接失败`)
          }
        } else {
          await tasker.disconnect(appId)
          await e.reply(`QQBot账号 ${appId} 已禁用并断开连接`)
        }
      } else {
        await e.reply(`QQBot账号 ${appId} 已${enabled ? '启用' : '禁用'}`)
      }
      
      return true
    } catch (err) {
      await e.reply(`操作失败: ${err.message}`)
      return false
    }
  }
}
