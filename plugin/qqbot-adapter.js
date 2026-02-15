import plugin from '../../../src/infrastructure/plugins/plugin.js'
import ConfigLoader from '../../../src/infrastructure/commonconfig/loader.js'

const getTasker = () => Bot.tasker.find(t => t.id === 'QQBot')

const getConfigInstance = () => ConfigLoader.get('qqbot')

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
  }

  async listAccounts(e) {
    try {
      const config = getConfigInstance()
      if (!config) {
        await e.reply('QQBot配置实例未找到')
        return false
      }
      
      const accounts = await config.listAccounts()
      const tasker = getTasker()
      
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
      const config = getConfigInstance()
      if (!config) {
        await e.reply('QQBot配置实例未找到')
        return false
      }
      
      const account = {
        name: appId,
        appId,
        clientSecret,
        enabled: true,
        markdownSupport: false
      }
      
      const accounts = await config.addAccount(account)
      const tasker = getTasker()
      
      if (tasker) {
        const existingAccount = accounts.find(a => a.appId === appId)
        if (existingAccount && existingAccount.enabled !== false) {
          await tasker.disconnect(appId)
        }
        const success = await tasker.connect(account)
        if (success) {
          await e.reply(`QQBot账号 ${appId} 已添加并连接成功`)
        } else {
          await e.reply(`QQBot账号 ${appId} 已添加，但连接失败`)
        }
      } else {
        await e.reply(`QQBot账号 ${appId} 已添加`)
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
      const config = getConfigInstance()
      if (!config) {
        await e.reply('QQBot配置实例未找到')
        return false
      }
      
      const accounts = await config.listAccounts()
      if (accounts.length === 0) {
        await e.reply('暂无可删除的QQBot账号')
        return true
      }

      const account = accounts.find(a => a.appId === appId || a.name === appId)
      if (!account) {
        await e.reply(`未找到QQBot账号 ${appId}`)
        return true
      }
      
      await config.removeAccount(account.appId)
      
      const tasker = getTasker()
      if (tasker) {
        await tasker.disconnect(account.appId)
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
      const config = getConfigInstance()
      if (!config) {
        await e.reply('QQBot配置实例未找到')
        return false
      }
      
      const accounts = await config.listAccounts()
      if (accounts.length === 0) {
        await e.reply('暂无QQBot账号配置')
        return true
      }

      const account = accounts.find(a => a.appId === appId || a.name === appId)
      if (!account) {
        await e.reply(`未找到QQBot账号 ${appId}`)
        return true
      }
      
      account.enabled = enabled
      await config.addAccount(account)
      
      const tasker = getTasker()
      if (tasker) {
        if (enabled) {
          const success = await tasker.connect(account)
          if (success) {
            await e.reply(`QQBot账号 ${appId} 已启用并连接成功`)
          } else {
            await e.reply(`QQBot账号 ${appId} 已启用，但连接失败`)
          }
        } else {
          await tasker.disconnect(account.appId)
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
