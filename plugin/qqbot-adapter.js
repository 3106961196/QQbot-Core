import PluginBase from '../../../src/infrastructure/plugins/plugin-base.js'
import ConfigLoader from '../../../src/infrastructure/commonconfig/loader.js'
import { normalizeError } from '../../../src/utils/normalize-error.js'

const getTasker = () => AgentRuntime.tasker.find(t => t.id === 'QQBot')
const getConfigInstance = () => ConfigLoader.get('qqbot')
const botIdOf = (account) => account.name || account.appId

export class QQBotAdapter extends PluginBase {
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
      ],
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
        const id = botIdOf(acc)
        const isOnline = tasker && tasker.bots.has(id)
        const status = isOnline ? '🟢 在线' : (acc.enabled !== false ? '⚪ 离线' : '❌ 禁用')
        const md = acc.markdownSupport ? ' [MD]' : ''
        msg.push(`${i + 1}. [${acc.name || acc.appId}] ${status}${md}`)
        msg.push(`   AppID: ${acc.appId}`)
      }

      await e.reply(msg.join('\n'))
      return true
    } catch (err) {
      await e.reply(`获取账号列表失败: ${normalizeError(err).message}`)
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
        markdownSupport: false,
      }

      await config.addAccount(account)
      const tasker = getTasker()

      if (tasker) {
        const botId = botIdOf(account)
        if (tasker.bots.has(botId)) await tasker.disconnect(botId)
        const success = await tasker.connect(account)
        await e.reply(
          success
            ? `QQBot账号 ${appId} 已添加并连接成功`
            : `QQBot账号 ${appId} 已添加，但连接失败`,
        )
      } else {
        await e.reply(`QQBot账号 ${appId} 已添加`)
      }

      return true
    } catch (err) {
      await e.reply(`添加账号失败: ${normalizeError(err).message}`)
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

      const tasker = getTasker()
      if (tasker) await tasker.disconnect(botIdOf(account))
      await config.removeAccount(account.appId)

      await e.reply(
        tasker
          ? `QQBot账号 ${appId} 已删除并断开连接`
          : `QQBot账号 ${appId} 已删除`,
      )
      return true
    } catch (err) {
      await e.reply(`删除账号失败: ${normalizeError(err).message}`)
      return false
    }
  }

  async enableAccount(e) {
    return this.toggleAccount(e, true)
  }

  async disableAccount(e) {
    return this.toggleAccount(e, false)
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
        const botId = botIdOf(account)
        if (enabled) {
          const success = await tasker.connect(account)
          await e.reply(
            success
              ? `QQBot账号 ${appId} 已启用并连接成功`
              : `QQBot账号 ${appId} 已启用，但连接失败`,
          )
        } else {
          await tasker.disconnect(botId)
          await e.reply(`QQBot账号 ${appId} 已禁用并断开连接`)
        }
      } else {
        await e.reply(`QQBot账号 ${appId} 已${enabled ? '启用' : '禁用'}`)
      }

      return true
    } catch (err) {
      await e.reply(`操作失败: ${normalizeError(err).message}`)
      return false
    }
  }
}
