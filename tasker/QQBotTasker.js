import { Bot as QQBotSDK } from "qq-group-bot"
import ConfigLoader from "../../../src/infrastructure/commonconfig/loader.js"
import BotUtil from "../../../src/utils/botutil.js"
import cfg from "../../../src/infrastructure/config/config.js"
import { MessageBuilder } from "./message-builder.js"
import { MessageHandler } from "./message-handler.js"

Bot.tasker.push(
  new (class QQBotTasker {
    id = "QQBot"
    name = "QQBot"
    path = this.name
    version = "qq-group-bot v1.1.0"
    sep = ":"

    config = null
    bots = new Map()
    bind_user = {}
    appid = {}
    toQRCodeRegExp = false
    sharp = null
    messageBuilder = null
    messageHandler = null

    async loadConfig() {
      const configInstance = ConfigLoader.get('qqbot')
      if (!configInstance) {
        throw new Error('QQBot配置实例未找到')
      }
      this.config = await configInstance.read()
      return this.config
    }

    async load() {
      try {
        await this.loadConfig()
        this.loadMasters()
        this.setupQRCodeRegex()
        await this.loadSharp()
        this.printWebUrl()
        this.initMessageModules()
        this.setupWebHook()
        this.scheduleBotConnection()
        Bot.makeLog('mark', `${this.name}(${this.id}) ${this.version} 加载完成`, 'QQBot')
      } catch (err) {
        Bot.makeLog('error', `QQBot加载失败: ${err.message}`, 'QQBot', err)
      }
    }

    scheduleBotConnection() {
      const doConnect = async () => {
        try {
          await this.setupBots()
        } catch (err) {
          Bot.makeLog('error', `QQBot 连接失败: ${err.message}`, 'QQBot')
        }
      }
      
      const timeout = 30000
      const timer = setTimeout(() => {
        Bot.makeLog('warn', `等待框架启动超时 (${timeout}ms)，尝试连接 QQBot`, 'QQBot')
        doConnect()
      }, timeout)
      
      const onOnline = () => {
        clearTimeout(timer)
        Bot.makeLog('debug', '框架启动完成，开始连接 QQBot', 'QQBot')
        doConnect()
      }
      
      if (Bot._online) {
        clearTimeout(timer)
        onOnline()
      } else {
        Bot.once('online', onOnline)
      }
    }

    loadMasters() {
      const masterQQ = cfg.chatbot?.master?.qq || []
      const list = Array.isArray(masterQQ) ? masterQQ : [masterQQ]
      BotUtil.master = list.map(m => String(m))
      Bot.makeLog('debug', `QQBot 主人列表已加载: ${BotUtil.master.length} 个`, 'QQBot')
    }

    async updateBotName(appId, nickname) {
      if (!nickname || nickname === appId) return
      try {
        const configInstance = ConfigLoader.get('qqbot')
        if (!configInstance) return
        const data = await configInstance.read()
        const account = (data.accounts || []).find(a => a.appId === appId)
        if (account && account.name !== nickname) {
          account.name = nickname
          await configInstance.write(data)
          Bot.makeLog('debug', `QQBot 配置已更新: ${appId} -> ${nickname}`, 'QQBot')
        }
      } catch (err) {
        Bot.makeLog('error', `更新机器人名称失败: ${err.message}`, 'QQBot', err)
      }
    }

    initMessageModules() {
      this.messageBuilder = new MessageBuilder(this)
      this.messageHandler = new MessageHandler(this)
      this.messageHandler.setMessageBuilder(this.messageBuilder)
    }

    printWebUrl() {
      const port = Bot.actualPort || Bot.httpPort || 8080
      const host = Bot.url || '127.0.0.1'
      const displayHost = host.replace(/^https?:\/\//, '').replace(/:\d+.*$/, '')
      const displayPort = (port === 80 || port === 443) ? '' : `:${port}`
      const protocol = port === Bot.actualHttpsPort ? 'https' : 'http'
      Bot.makeLog('mark', `QQBot 管理界面: ${protocol}://${displayHost}${displayPort}/core/QQbot-Core/`, 'QQBot')
    }

    setupQRCodeRegex() {
      switch (typeof this.config.toQRCode) {
        case 'boolean':
          this.toQRCodeRegExp = this.config.toQRCode ? /https?:\/\/[^\s]+/g : false
          break
        case 'string':
          this.toQRCodeRegExp = new RegExp(this.config.toQRCode, 'g')
          break
        case 'object':
          this.toQRCodeRegExp = /https?:\/\/[^\s]+/g
          break
      }
    }

    async loadSharp() {
      if (this.config.imageLength) {
        try {
          this.sharp = (await import("sharp")).default
        } catch (err) {
          Bot.makeLog('warn', 'sharp 导入错误，图片压缩关闭', 'QQBot', err)
        }
      }
    }

    async setupBots() {
      const accounts = this.config.accounts || []
      
      for (const account of accounts) {
        if (account.enabled !== false && account.appId && account.clientSecret) {
          if (account.autoConnect === false) {
            Bot.makeLog('info', `QQBot ${account.appId || account.name} 自动连接已禁用，跳过`, 'QQBot')
            continue
          }
          try {
            await this.connect(account)
          } catch (err) {
            Bot.makeLog('error', `QQBot ${account.appId} 连接失败: ${err.message}`, 'QQBot')
          }
        }
      }
    }

    setupWebHook() {
      Bot.express.use(`/${this.name}`, this.makeWebHook.bind(this))
      Bot.express.quiet.push(`/${this.name}`)
    }

    async checkNetwork() {
      const dns = await import('node:dns').then(m => m.promises)
      try {
        await dns.resolve('bots.qq.com')
        return true
      } catch (err) {
        return false
      }
    }

    async connect(account) {
      const id = account.name || account.appId
      const timeout = account.connectTimeout || this.config.connectTimeout || 10000
      const opts = {
        ...this.config.bot,
        appid: account.appId,
        secret: account.clientSecret,
        intents: [
          "GUILDS",
          "GUILD_MEMBERS",
          "GUILD_MESSAGE_REACTIONS",
          "DIRECT_MESSAGE",
          "INTERACTION",
          "MESSAGE_AUDIT",
          "GROUP_AT_MESSAGE_CREATE",
          "C2C_MESSAGE_CREATE",
          "PUBLIC_GUILD_MESSAGES",
        ],
      }

      Bot.makeLog('info', `正在连接 QQBot: ${id}, AppID: ${account.appId}`, 'QQBot')

      const networkOk = await this.checkNetwork()
      if (!networkOk) {
        Bot.makeLog('error', `${this.name}(${this.id}) ${this.version} 连接失败: 网络不可用，无法解析 bots.qq.com`, id)
        return false
      }

      const sdk = new QQBotSDK(opts)

      Bot[id] = {
        tasker: this,
        sdk,
        login() {
          return new Promise((resolve, reject) => {
            this.sdk.sessionManager.once("READY", resolve)
            this.sdk.sessionManager.once("DEAD", (err) => {
              reject(new Error(err?.msg || "连接失败"))
            })
            try {
              this.sdk.start()
            } catch (err) {
              reject(err)
            }
          })
        },
        _cleanup() {},
        logout() {
          return new Promise(resolve => {
            this.sdk.ws.once("close", resolve)
            this.sdk.stop()
          })
        },
        uin: id,
        info: {
          id,
          ...opts,
          avatar: `https://q.qlogo.cn/g?b=qq&s=0&nk=${id}`,
        },
        get nickname() { return this.info.username },
        get avatar() { return this.info.avatar },
        version: {
          id: this.id,
          name: this.name,
          version: this.version,
        },
        stat: { start_time: Date.now() / 1000 },
        pickFriend: user_id => this.messageHandler.pickFriend(id, user_id),
        get pickUser() { return this.pickFriend },
        fl: new Map(),
        pickMember: (group_id, user_id) => this.messageHandler.pickMember(id, group_id, user_id),
        pickGroup: group_id => this.messageHandler.pickGroup(id, group_id),
        gl: new Map(),
        gml: new Map(),
        callback: {},
      }

      Bot[id].sdk.logger = {}
      for (const i of ["trace", "debug", "info", "mark", "warn", "error", "fatal"]) {
        Bot[id].sdk.logger[i] = (...args) => {
          const msg = args.join(' ')
          if (msg?.startsWith?.("recv from")) return
          if (msg?.includes?.("1005")) {
            Bot.makeLog('debug', `连接被关闭`, id)
            return
          }
          if (msg?.includes?.("4009")) {
            Bot.makeLog('debug', `连接会话过期，正在重连...`, id)
            return
          }
          if (msg?.includes?.("[CLIENT]") || msg?.includes?.("connect to") || msg?.includes?.("鉴权")) {
            return Bot.makeLog(i, args, 'QQBot')
          }
          return Bot.makeLog(i, args, id)
        }
      }

      Bot[id].sdk.sessionManager.on("DEAD", (data) => {
        const errorMsg = data.msg || '连接断开'
        Bot.makeLog('info', `🔴 [设备下线] QQBot (${Bot[id]?.nickname || id}) - 原因: ${errorMsg}`, 'QQBot')
        Bot.makeLog('warn', `QQBot 连接断开: ${errorMsg}`, id)
        this.bots.delete(id)
        if (Bot[id]) {
          delete Bot[id]
          Bot.uin = Bot.uin.filter(u => u !== id)
        }
        Bot.em(`disconnect.${id}`, { self_id: id, reason: errorMsg })
      })

      try {
        await Bot[id].login()
        Object.assign(Bot[id].info, await Bot[id].sdk.getSelfInfo())
        await this.updateBotName(account.appId, Bot[id].nickname)
      } catch (err) {
        Bot.makeLog('error', `${this.name}(${this.id}) ${this.version} 连接失败: ${err.message}`, id, err)
        try {
          Bot[id]._cleanup?.()
          Bot[id].sdk.stop()
        } catch (e) {
          Bot.makeLog('debug', `停止SDK时发生错误: ${e.message}`, id)
        }
        delete Bot[id]
        Bot.uin = Bot.uin.filter(u => u !== id)
        return false
      }

      Bot[id].sdk.on("message", event => this.messageHandler.makeMessage(id, event))
      Bot[id].sdk.on("notice", event => this.messageHandler.makeNotice(id, event))

      this.bots.set(id, Bot[id])
      if (!Bot.uin.includes(id)) Bot.uin.push(id)

      Bot.makeLog('mark', `${this.name}(${this.id}) ${this.version} ${Bot[id].nickname} 已连接`, id)
      Bot.makeLog('info', `🟢 [设备上线] QQBot (${Bot[id].nickname || id}) - AppID: ${account.appId}`, 'QQBot')
      Bot.em(`connect.${id}`, { self_id: id })
      return true
    }

    async disconnect(id) {
      const bot = this.bots.get(id)
      if (bot) {
        Bot.makeLog('info', `🔴 [设备下线] QQBot (${bot.nickname || id}) - 原因: 主动断开`, 'QQBot')
        try {
          await bot.logout()
        } catch (err) {
          Bot.makeLog('debug', `断开连接时发生错误: ${err.message}`, id)
        }
        this.bots.delete(id)
        delete Bot[id]
        Bot.uin = Bot.uin.filter(u => u !== id)
        Bot.makeLog('mark', `QQBot ${bot.nickname || id} 已断开`, id)
      } else {
        Bot.makeLog('debug', `QQBot ${id} 未在线，无需断开`, 'QQBot')
      }
    }

    async makeWebHookSign(id, req, secret) {
      const { sign } = (await import("tweetnacl")).default
      const { plain_token, event_ts } = req.body.d
      while (secret.length < 32) secret = secret.repeat(2).slice(0, 32)
      const signature = Buffer.from(sign.detached(
        Buffer.from(`${event_ts}${plain_token}`),
        sign.keyPair.fromSeed(Buffer.from(secret)).secretKey,
      )).toString("hex")
      Bot.makeLog('debug', `QQBot 签名生成: ${Bot.String({ plain_token, signature })}`, id)
      req.res.send({ plain_token, signature })
    }

    makeWebHook(req) {
      const appid = req.headers["x-bot-appid"]
      if (!(appid in this.appid)) return Bot.makeLog('warn', `找不到对应 QQBot: ${appid}`, 'QQBot')
      if ("plain_token" in req.body?.d) return this.makeWebHookSign(this.appid[appid].uin, req, this.appid[appid].info.secret)
      if ("t" in req.body) this.appid[appid].sdk.dispatchEvent(req.body.t, req.body)
      req.res.sendStatus(200)
    }
  })()
)
