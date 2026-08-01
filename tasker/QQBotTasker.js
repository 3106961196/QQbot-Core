import { Bot as QQBotSDK } from "qq-group-bot"
import ConfigLoader from "../../../src/infrastructure/commonconfig/loader.js"
import runtimeConfig from "../../../src/infrastructure/config/config.js"
import { MessageBuilder } from "./message-builder.js"
import { MessageHandler } from "./message-handler.js"

AgentRuntime.tasker.push(
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
        this.setupQRCodeRegex()
        await this.loadSharp()
        this.initMessageModules()
        this.setupWebHook()
        this.scheduleBotConnection()
        AgentRuntime.makeLog('mark', `${this.name}(${this.id}) ${this.version} 加载完成`, 'QQBot')
      } catch (err) {
        AgentRuntime.makeLog('error', `QQBot加载失败: ${err.message}`, 'QQBot', err)
      }
    }

    scheduleBotConnection() {
      const doConnect = async () => {
        try {
          await this.setupBots()
        } catch (err) {
          const msg = Error.isError(err) ? err.message : String(err)
          AgentRuntime.makeLog('error', `QQBot 连接失败: ${msg}`, 'QQBot')
        }
      }

      const timeoutMs = 30000
      const timer = setTimeout(() => {
        AgentRuntime.makeLog('warn', `等待框架启动超时 (${timeoutMs}ms)，尝试连接 QQBot`, 'QQBot')
        doConnect()
      }, timeoutMs)

      AgentRuntime.once('online', () => {
        clearTimeout(timer)
        AgentRuntime.makeLog('debug', '框架启动完成，开始连接 QQBot', 'QQBot')
        const masters = runtimeConfig.masterQQ || []
        AgentRuntime.makeLog('debug', `QQBot 主人列表: ${masters.length} 个（chatbot.master.qq）`, 'QQBot')
        doConnect()
      })
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
          AgentRuntime.makeLog('debug', `QQBot 配置已更新: ${appId} -> ${nickname}`, 'QQBot')
        }
      } catch (err) {
        AgentRuntime.makeLog('error', `更新机器人名称失败: ${err.message}`, 'QQBot', err)
      }
    }

    initMessageModules() {
      this.messageBuilder = new MessageBuilder(this)
      this.messageHandler = new MessageHandler(this)
      this.messageHandler.setMessageBuilder(this.messageBuilder)
    }

    printWebUrl() {
      const port = AgentRuntime.actualPort || AgentRuntime.httpPort || 8080
      const host = AgentRuntime.url || '127.0.0.1'
      const displayHost = host.replace(/^https?:\/\//, '').replace(/:\d+.*$/, '')
      const displayPort = (port === 80 || port === 443) ? '' : `:${port}`
      const protocol = port === AgentRuntime.actualHttpsPort ? 'https' : 'http'
      const url = `${protocol}://${displayHost}${displayPort}/core/QQbot-Core/`
      const content = `QQBot 管理界面: ${url}`
      const displayWidth = [...content].reduce((w, c) => w + (c.charCodeAt(0) > 127 ? 2 : 1), 0) + 2
      const line = '─'.repeat(displayWidth)
      AgentRuntime.makeLog('mark', `┌${line}┐`, 'QQBot')
      AgentRuntime.makeLog('mark', `│ ${content} │`, 'QQBot')
      AgentRuntime.makeLog('mark', `└${line}┘`, 'QQBot')
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
          AgentRuntime.makeLog('warn', 'sharp 导入错误，图片压缩关闭', 'QQBot', err)
        }
      }
    }

    async setupBots() {
      this.printWebUrl()
      const accounts = this.config.accounts || []
      
      for (const account of accounts) {
        if (account.enabled !== false && account.appId && account.clientSecret) {
          if (account.autoConnect === false) {
            AgentRuntime.makeLog('info', `QQBot ${account.appId || account.name} 自动连接已禁用，跳过`, 'QQBot')
            continue
          }
          try {
            await this.connect(account)
          } catch (err) {
            AgentRuntime.makeLog('error', `QQBot ${account.appId} 连接失败: ${err.message}`, 'QQBot')
          }
        }
      }
    }

    setupWebHook() {
      AgentRuntime.express.use(`/${this.name}`, (req, res) => this.makeWebHook(req, res))
      AgentRuntime.express.quiet.push(`/${this.name}`)
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

      AgentRuntime.makeLog('info', `正在连接 QQBot: ${id}, AppID: ${account.appId}`, 'QQBot')

      const networkOk = await this.checkNetwork()
      if (!networkOk) {
        AgentRuntime.makeLog('error', `${this.name}(${this.id}) ${this.version} 连接失败: 网络不可用，无法解析 bots.qq.com`, id)
        return false
      }

      const sdk = new QQBotSDK(opts)
      
      const safeGetWsUrl = () => {
        return new Promise((resolve, reject) => {
          sdk.request.get("/gateway/bot", {
            headers: {
              Accept: "*/*",
              "Accept-Encoding": "utf-8",
              "Accept-Language": "zh-CN,zh;q=0.8",
              Connection: "keep-alive",
              "User-Agent": "v1",
              Authorization: ""
            }
          }).then(res => {
            if (!res.data) {
              reject(new Error("获取ws连接信息异常"))
              return
            }
            sdk.sessionManager.wsUrl = res.data.url
            resolve(res.data.url)
          }).catch(err => {
            reject(err)
          })
        })
      }
      
      AgentRuntime[id] = {
        tasker: this,
        sdk,
        loginError: null,
        login() {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('连接超时'))
            }, 30000)
            
            const onReady = () => {
              clearTimeout(timeout)
              this.sdk.sessionManager.off("DEAD", onDead)
              resolve()
            }
            
            const onDead = (err) => {
              clearTimeout(timeout)
              this.sdk.sessionManager.off("READY", onReady)
              const errorMsg = err?.msg || "连接失败"
              this.loginError = errorMsg
              reject(new Error(errorMsg))
            }
            
            this.sdk.sessionManager.once("READY", onReady)
            this.sdk.sessionManager.once("DEAD", onDead)
            
            ;(async () => {
              try {
                await this.sdk.sessionManager.getAccessToken()
                await safeGetWsUrl()
                this.sdk.sessionManager.connect()
                this.sdk.sessionManager.startListen()
              } catch (err) {
                clearTimeout(timeout)
                this.loginError = err?.message || '连接失败'
                reject(err)
              }
            })()
          })
        },
        _cleanup() {},
        logout() {
          return new Promise(resolve => {
            this.sdk.ws?.once?.("close", resolve)
            this.sdk.stop()
            resolve()
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

      AgentRuntime[id].sdk.logger = {}
      for (const i of ["trace", "debug", "info", "mark", "warn", "error", "fatal"]) {
        AgentRuntime[id].sdk.logger[i] = (...args) => {
          const msg = args.join(' ')
          if (msg?.startsWith?.("recv from")) return
          if (msg?.includes?.("1005")) {
            AgentRuntime.makeLog('debug', `连接被关闭`, id)
            return
          }
          if (msg?.includes?.("4009")) {
            AgentRuntime.makeLog('debug', `连接会话过期，正在重连...`, id)
            return
          }
          if (msg?.includes?.("11298") || msg?.includes?.("IP不在白名单")) {
            AgentRuntime.makeLog('error', `连接失败: IP 不在白名单，请在 QQ 开放平台添加服务器 IP 到白名单`, 'QQBot')
            return
          }
          if (msg?.includes?.("[CLIENT]") || msg?.includes?.("connect to") || msg?.includes?.("鉴权")) {
            return AgentRuntime.makeLog(i, args, 'QQBot')
          }
          return AgentRuntime.makeLog(i, args, id)
        }
      }

      AgentRuntime[id].sdk.sessionManager.on("DEAD", (data) => {
        try {
          const errorMsg = data.msg || '连接断开'
          if (errorMsg.includes('11298') || errorMsg.includes('IP不在白名单')) {
            AgentRuntime.makeLog('error', `🔴 [连接失败] QQBot (${id}) - IP 不在白名单，请在 QQ 开放平台添加服务器公网 IP 到白名单`, 'QQBot')
          } else {
            AgentRuntime.makeLog('info', `🔴 [设备下线] QQBot (${AgentRuntime[id]?.nickname || id}) - 原因: ${errorMsg}`, 'QQBot')
            AgentRuntime.makeLog('warn', `QQBot 连接断开: ${errorMsg}`, id)
          }
          // 移除 SDK 事件监听器
          AgentRuntime[id]?.sdk?.removeAllListeners?.("message")
          AgentRuntime[id]?.sdk?.removeAllListeners?.("notice")
          this.bots.delete(id)
          // 清理 appid 映射
          for (const [appId, entry] of Object.entries(this.appid)) {
            if (entry.uin === id) delete this.appid[appId]
          }
          if (AgentRuntime[id]) {
            delete AgentRuntime[id]
            AgentRuntime.uin = AgentRuntime.uin.filter(u => u !== id)
          }
          AgentRuntime.em(`qqbot.disconnect`, { self_id: id, reason: errorMsg })
          AgentRuntime.em(`disconnect.${id}`, { self_id: id, reason: errorMsg })
        } catch (err) {
          AgentRuntime.makeLog('error', `QQBot DEAD 事件处理异常: ${err.message}`, 'QQBot', err)
        }
      })

      let loginError = null
      try {
        await AgentRuntime[id].login()
        Object.assign(AgentRuntime[id].info, await AgentRuntime[id].sdk.getSelfInfo())
        await this.updateBotName(account.appId, AgentRuntime[id].nickname)
      } catch (err) {
        loginError = err
        AgentRuntime.makeLog('error', `${this.name}(${this.id}) ${this.version} 连接失败: ${err.message}`, id, err)
        try {
          AgentRuntime[id]._cleanup?.()
          AgentRuntime[id].sdk.stop()
        } catch (e) {
          AgentRuntime.makeLog('debug', `停止SDK时发生错误: ${e.message}`, id)
        }
        delete AgentRuntime[id]
        AgentRuntime.uin = AgentRuntime.uin.filter(u => u !== id)
      }

      if (loginError) {
        const errorMsg = loginError.message || '连接失败'
        if (errorMsg.includes('11298') || errorMsg.includes('IP不在白名单')) {
          const ipWhitelistError = new Error('IP 不在白名单，请在 QQ 开放平台添加服务器公网 IP 到白名单')
          ipWhitelistError.code = 'IP_WHITELIST'
          throw ipWhitelistError
        }
        throw loginError
      }

      AgentRuntime[id].sdk.on("message", event => this.messageHandler.makeMessage(id, event))
      AgentRuntime[id].sdk.on("notice", event => this.messageHandler.makeNotice(id, event))

      this.bots.set(id, AgentRuntime[id])
      if (!AgentRuntime.uin.includes(id)) AgentRuntime.uin.push(id)

      // 填充 appid 映射，供 WebHook 使用
      this.appid[account.appId] = {
        uin: id,
        sdk,
        info: { secret: account.clientSecret },
      }

      AgentRuntime.makeLog('mark', `${this.name}(${this.id}) ${this.version} ${AgentRuntime[id].nickname} 已连接`, id)
      AgentRuntime.makeLog('info', `🟢 [设备上线] QQBot (${AgentRuntime[id].nickname || id}) - AppID: ${account.appId}`, 'QQBot')
      AgentRuntime.em('qqbot.connect', { self_id: id })
      AgentRuntime.em(`connect.${id}`, { self_id: id })
      return true
    }

    async disconnect(id) {
      const bot = this.bots.get(id)
      if (bot) {
        AgentRuntime.makeLog('info', `🔴 [设备下线] QQBot (${bot.nickname || id}) - 原因: 主动断开`, 'QQBot')
        try {
          // 移除 SDK 事件监听器
          bot.sdk.removeAllListeners("message")
          bot.sdk.removeAllListeners("notice")
          await bot.logout()
        } catch (err) {
          AgentRuntime.makeLog('debug', `断开连接时发生错误: ${err.message}`, id)
        }
        this.bots.delete(id)
        // 清理 appid 映射
        for (const [appId, entry] of Object.entries(this.appid)) {
          if (entry.uin === id) delete this.appid[appId]
        }
        delete AgentRuntime[id]
        AgentRuntime.uin = AgentRuntime.uin.filter(u => u !== id)
        AgentRuntime.makeLog('mark', `QQBot ${bot.nickname || id} 已断开`, id)
      } else {
        AgentRuntime.makeLog('debug', `QQBot ${id} 未在线，无需断开`, 'QQBot')
      }
    }

    async makeWebHookSign(id, req, res, secret) {
      const { sign } = (await import("tweetnacl")).default
      const { plain_token, event_ts } = req.body.d
      while (secret.length < 32) secret = secret.repeat(2).slice(0, 32)
      const signature = Buffer.from(sign.detached(
        Buffer.from(`${event_ts}${plain_token}`),
        sign.keyPair.fromSeed(Buffer.from(secret)).secretKey,
      )).toHex()
      AgentRuntime.makeLog('debug', `QQBot 签名生成: ${AgentRuntime.String({ plain_token, signature })}`, id)
      res.send({ plain_token, signature })
    }

    makeWebHook(req, res) {
      const appid = req.headers["x-bot-appid"]
      if (!(appid in this.appid)) {
        AgentRuntime.makeLog('warn', `找不到对应 QQBot: ${appid}`, 'QQBot')
        return res.sendStatus(404)
      }
      if ("plain_token" in (req.body?.d || {})) {
        return this.makeWebHookSign(this.appid[appid].uin, req, res, this.appid[appid].info.secret)
      }
      if ("t" in (req.body || {})) this.appid[appid].sdk.dispatchEvent(req.body.t, req.body)
      res.sendStatus(200)
    }
  })()
)
