import { Bot as QQBotSDK } from '../src/vendor/qq-group-bot/lib/index.js'
import ConfigLoader from '../../../src/infrastructure/commonconfig/loader.js'
import { MessageBuilder } from './message-builder.js'
import { MessageHandler } from './message-handler.js'
import { ConnectionManager } from './connection-manager.js'
import { attachRequest } from './request.js'
import { normalizeError } from './utils.js'

const LOG = 'QQBot'
/** 产品页在 www/qqbot/ → 底层挂 /qqbot/（/core/QQbot-Core/ 仅为整棵 www 调试直链） */
const WWW_PATH = '/qqbot/'
const INTENTS = [
  'GUILDS',
  'GUILD_MEMBERS',
  'GUILD_MESSAGE_REACTIONS',
  'DIRECT_MESSAGE',
  'INTERACTION',
  'MESSAGE_AUDIT',
  'GROUP_AT_MESSAGE_CREATE',
  'C2C_MESSAGE_CREATE',
  'PUBLIC_GUILD_MESSAGES',
]

function errMsg(err) {
  return normalizeError(err).message
}

/** botId 固定为 AppID；展示名用接口回写的 nickname */
function botIdOf(account) {
  return String(account.appId || '')
}

AgentRuntime.tasker.push(
  new (class QQBotTasker {
    id = 'QQBot'
    name = 'QQBot'
    path = this.name
    version = 'qq-group-bot v1.1.0 (vendored, patched)'
    sep = ':'

    config = null
    bots = new Map()
    /** 按钮回调用户绑定：real_id → qqbot user_id */
    bind_user = {}
    /** AppID → { uin, sdk, info }，供 WebHook */
    appid = {}
    toQRCodeRegExp = false
    sharp = null
    messageBuilder = null
    messageHandler = null

    async loadConfig() {
      const configInstance = ConfigLoader.get('qqbot')
      if (!configInstance) throw new Error('QQBot配置实例未找到')
      this.config = await configInstance.read()
      return this.config
    }

    /** 回写账号元数据（昵称等），不改 botId */
    async persistAccountMeta(appId, patch = {}) {
      const configInstance = ConfigLoader.get('qqbot')
      if (!configInstance || !appId) return
      const data = await configInstance.read(false)
      const acc = (data.accounts || []).find(a => a.appId === appId)
      if (!acc) return
      let changed = false
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || acc[k] === v) continue
        acc[k] = v
        changed = true
      }
      // name 与 botId 对齐为 AppID，避免旧自定义 name 漂移
      if (acc.name !== appId) {
        acc.name = appId
        changed = true
      }
      if (!changed) return
      await configInstance.write(data)
      this.config = data
    }

    async load() {
      try {
        await this.loadConfig()
        this.setupQRCodeRegex()
        await this.loadSharp()
        this.messageBuilder = new MessageBuilder(this)
        this.messageHandler = new MessageHandler(this)
        this.messageHandler.setMessageBuilder(this.messageBuilder)
        this.setupWebHook()
        this.printWebUrl()
        this.initConnectionManager()
        this.scheduleBotConnection()
        AgentRuntime.makeLog('mark', `${this.name}(${this.id}) ${this.version} 加载完成`, LOG)
      } catch (err) {
        AgentRuntime.makeLog('error', `QQBot 加载失败: ${errMsg(err)}`, LOG, err)
      }
    }

    scheduleBotConnection() {
      const doConnect = () => this.setupBots().catch(err => {
        AgentRuntime.makeLog('error', `QQBot 连接失败: ${errMsg(err)}`, LOG)
      })

      const timeoutMs = 30000
      const timer = setTimeout(() => {
        AgentRuntime.makeLog('warn', `等待 online 超时 (${timeoutMs}ms)，尝试连接 QQBot`, LOG)
        doConnect()
      }, timeoutMs)

      AgentRuntime.once('online', () => {
        clearTimeout(timer)
        doConnect()
      })
    }

    /** 使用框架 getServerUrl，避免手拼 host/port 出错 */
    printWebUrl() {
      const base = String(AgentRuntime.getServerUrl?.() || '').replace(/\/+$/, '')
      const url = `${base}${WWW_PATH}`
      AgentRuntime.makeLog('mark', `QQBot 管理页: ${url}`, LOG)
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
        default:
          this.toQRCodeRegExp = false
      }
    }

    async loadSharp() {
      if (!this.config.imageLength) return
      try {
        this.sharp = (await import('sharp')).default
      } catch (err) {
        AgentRuntime.makeLog('warn', 'sharp 不可用，图片压缩关闭', LOG, err)
      }
    }

    /** 初始化连接编排：启动失败退避 / 断连限速督办 */
    initConnectionManager() {
      this.connectionManager = new ConnectionManager({
        connectFn: account => this.connect(account),
        onStatus: (state, detail) => {
          const { key } = detail || {}
          switch (state) {
            case 'connected':
              AgentRuntime.makeLog('info', `连接编排: ${key} 已就绪`, key || LOG)
              break
            case 'retrying':
              AgentRuntime.makeLog('warn', `连接编排: ${key} 第 ${detail.attempt} 次重试（${detail.delay}s 后），原因: ${detail.reason}`, key || LOG)
              break
            case 'rate-limited':
              AgentRuntime.makeLog('warn', `连接编排: ${key} 断连过于频繁，限速 ${Math.round(detail.cooldownMs / 1000)}s`, key || LOG)
              break
            case 'reconnecting':
              AgentRuntime.makeLog('info', `连接编排: ${key} 断连后重连中（${detail.reason || '未知原因'}）`, key || LOG)
              break
            case 'give-up':
              AgentRuntime.makeLog('error', `连接编排: ${key} 重试耗尽，放弃自动重连（原因: ${detail.reason}）`, key || LOG)
              break
          }
        },
      })
    }

    /** 自动编排：启动时对每个账号建立连接，失败走退避重试 */
    async setupBots() {
      this.printWebUrl()
      for (const account of this.config.accounts || []) {
        if (account.enabled === false || !account.appId || !account.clientSecret) continue
        if (account.autoConnect === false) {
          AgentRuntime.makeLog('info', `跳过自动连接: ${botIdOf(account)}`, LOG)
          continue
        }
        this.connectionManager.start(account)
      }
    }

    /**
     * R9：配置热重载增量同步 —— 对比「当前配置的账号列表」与「已连接 bots」，
     * 三向 diff：
     *   1. 删除账号：bots 有、配置无 → disconnect（停编排 + 彻底清理）
     *   2. 新增账号：配置有、bots 无（且 enabled/有凭证/autoConnect）→ connectionManager.start
     *   3. 凭证变更：均已连接但 clientSecret 变 → disconnect 后重新 start（后台重连）
     * 非账号配置（toQRCode 等）不在此列，由 loadConfig() 覆盖（getter 直读 config）。
     */
    async syncBots() {
      const accounts = this.config.accounts || []
      const onlineIds = new Set(this.bots.keys())

      // 1) 删除：已连接但配置已移除
      for (const id of onlineIds) {
        if (!accounts.some(a => botIdOf(a) === id)) {
          AgentRuntime.makeLog('info', `配置热重载: 账号 ${id} 已从配置移除，断开连接`, LOG)
          await this.disconnect(id)
        }
      }

      // 2) 新增 / 3) 凭证变更（按配置顺序逐个核对）
      for (const account of accounts) {
        const id = botIdOf(account)
        if (!id || account.enabled === false) continue

        const current = this.bots.get(id)
        if (!current) {
          // 新增账号：走连接编排（幂等，含失败退避）
          if (!account.clientSecret) {
            AgentRuntime.makeLog('warn', `配置热重载: 账号 ${id} 缺少 clientSecret，跳过`, LOG)
            continue
          }
          AgentRuntime.makeLog('info', `配置热重载: 检测到新账号 ${id}，建立连接`, LOG)
          this.connectionManager.start(account)
          continue
        }

        // 已连接：仅 clientSecret 变更才重连（避免无谓断连）
        const connectedSecret = this.appid[id]?.info?.secret
        if (account.clientSecret && connectedSecret && account.clientSecret !== connectedSecret) {
          AgentRuntime.makeLog('info', `配置热重载: 账号 ${id} clientSecret 变更，重连`, LOG)
          await this.disconnect(id)
          this.connectionManager.start(account)
        }
      }
    }

    setupWebHook() {
      AgentRuntime.express.use(`/${this.name}`, (req, res) => this.makeWebHook(req, res))
      AgentRuntime.express.quiet.push(`/${this.name}`)
    }

    async connect(account) {
      const id = botIdOf(account)
      // 已有连接：轻量清理（不触发 disconnect 的 stop 编排逻辑）
      if (this.bots.has(id)) {
        try {
          const old = this.bots.get(id)
          old?.sdk?.removeAllListeners?.('message')
          old?.sdk?.removeAllListeners?.('notice')
          await old?.logout?.()
        } catch { /* ignore */ }
        this.cleanupBot(id)
      }

      const opts = {
        ...this.config.bot,
        appid: account.appId,
        secret: account.clientSecret,
        intents: INTENTS,
      }

      AgentRuntime.makeLog('info', `正在连接 ${id} (AppID ${account.appId})`, LOG)

      const sdk = new QQBotSDK(opts)
      const bot = this.createBotEntry(id, sdk, opts)
      AgentRuntime[id] = bot
      this.wireSdkLogger(id, sdk)
      this.wireDeadHandler(id)

      try {
        await bot.login()
        const self = await sdk.getSelfInfo()
        Object.assign(bot.info, self)
        await this.persistAccountMeta(account.appId, {
          nickname: self?.username || bot.nickname || '',
        })
      } catch (err) {
        AgentRuntime.makeLog('error', `连接失败: ${errMsg(err)}`, id, err)
        try { sdk.stop() } catch { /* ignore */ }
        delete AgentRuntime[id]
        AgentRuntime.uin = AgentRuntime.uin.filter(u => u !== id)
        if (/11298|IP不在白名单/.test(errMsg(err))) {
          const e = new Error('IP 不在白名单，请在 QQ 开放平台添加服务器公网 IP')
          e.code = 'IP_WHITELIST'
          throw e
        }
        throw err
      }

      sdk.on('message', event => this.messageHandler.makeMessage(id, event))
      sdk.on('notice', event => this.messageHandler.makeNotice(id, event))

      this.bots.set(id, bot)
      if (!AgentRuntime.uin.includes(id)) AgentRuntime.uin.push(id)
      this.appid[account.appId] = { uin: id, sdk, info: { secret: account.clientSecret } }

      AgentRuntime.makeLog('mark', `${this.name} ${bot.nickname || id} 已连接`, id)
      // 连接成功：纳入编排（若已存在则不重复），DEAD 断连时受自动重连保护
      this.connectionManager?.adopt(account)
      AgentRuntime.em('qqbot.connect', { self_id: id })
      AgentRuntime.em(`connect.${id}`, { self_id: id })
      return true
    }

    createBotEntry(id, sdk, opts) {
      const tasker = this
      const entry = {
        tasker,
        sdk,
        loginError: null,
        login() {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('连接超时')), 30000)
            const onReady = () => {
              clearTimeout(timer)
              this.sdk.sessionManager.off('DEAD', onDead)
              resolve()
            }
            const onDead = (err) => {
              clearTimeout(timer)
              this.sdk.sessionManager.off('READY', onReady)
              this.loginError = err?.msg || '连接失败'
              reject(new Error(this.loginError))
            }
            this.sdk.sessionManager.once('READY', onReady)
            this.sdk.sessionManager.once('DEAD', onDead)
            ;(async () => {
              try {
                await this.sdk.sessionManager.getAccessToken()
                const res = await this.sdk.request.get('/gateway/bot', {
                  headers: {
                    Accept: '*/*',
                    'Accept-Encoding': 'utf-8',
                    'Accept-Language': 'zh-CN,zh;q=0.8',
                    Connection: 'keep-alive',
                    'User-Agent': 'v1',
                    Authorization: '',
                  },
                })
                if (!res.data?.url) throw new Error('获取 ws 连接信息异常')
                this.sdk.sessionManager.wsUrl = res.data.url
                this.sdk.sessionManager.connect()
                this.sdk.sessionManager.startListen()
              } catch (err) {
                clearTimeout(timer)
                this.loginError = errMsg(err) || '连接失败'
                reject(err)
              }
            })()
          })
        },
        logout() {
          return new Promise(resolve => {
            this.sdk.ws?.once?.('close', resolve)
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
        version: { id: tasker.id, name: tasker.name, version: tasker.version },
        stat: { start_time: Date.now() / 1000 },
        pickFriend: user_id => tasker.messageHandler.pickFriend(id, user_id),
        get pickUser() { return this.pickFriend },
        fl: new Map(),
        pickMember: (group_id, user_id) => tasker.messageHandler.pickMember(id, group_id, user_id),
        pickGroup: group_id => tasker.messageHandler.pickGroup(id, group_id),
        gl: new Map(),
        gml: new Map(),
        callback: {},
      }
      // R8：通用 OpenAPI 入口（限频 + NotImplemented 保护），插件可用 e.bot.request(...)
      attachRequest(entry)
      return entry
    }

    wireSdkLogger(id, sdk) {
      sdk.logger = {}
      for (const level of ['trace', 'debug', 'info', 'mark', 'warn', 'error', 'fatal']) {
        sdk.logger[level] = (...args) => {
          const msg = args.join(' ')
          if (msg?.startsWith?.('recv from')) return
          if (msg?.includes?.('1005')) {
            AgentRuntime.makeLog('debug', '连接被关闭', id)
            return
          }
          if (msg?.includes?.('4009')) {
            AgentRuntime.makeLog('debug', '会话过期，重连中', id)
            return
          }
          if (msg?.includes?.('11298') || msg?.includes?.('IP不在白名单')) {
            AgentRuntime.makeLog('error', 'IP 不在白名单，请在 QQ 开放平台添加服务器公网 IP', LOG)
            return
          }
          if (msg?.includes?.('[CLIENT]') || msg?.includes?.('connect to') || msg?.includes?.('鉴权')) {
            AgentRuntime.makeLog(level, args, LOG)
            return
          }
          AgentRuntime.makeLog(level, args, id)
        }
      }
    }

    wireDeadHandler(id) {
      AgentRuntime[id].sdk.sessionManager.on('DEAD', (data) => {
        try {
          const reason = data.msg || '连接断开'
          if (/11298|IP不在白名单/.test(reason)) {
            AgentRuntime.makeLog('error', `连接失败: IP 不在白名单 (${id})`, LOG)
            this.connectionManager?.stop(id)
          } else {
            AgentRuntime.makeLog('warn', `已断开: ${reason}`, id)
            // 交由连接编排重连（限速/退避由 connection-manager 负责）
            this.connectionManager?.reportDisconnect(id, reason)
          }
          this.cleanupBot(id, reason)
        } catch (err) {
          AgentRuntime.makeLog('error', `DEAD 处理异常: ${errMsg(err)}`, LOG, err)
        }
      })
    }

    cleanupBot(id, reason) {
      const bot = this.bots.get(id) || AgentRuntime[id]
      try {
        bot?.sdk?.removeAllListeners?.('message')
        bot?.sdk?.removeAllListeners?.('notice')
      } catch { /* ignore */ }
      this.bots.delete(id)
      for (const [appId, entry] of Object.entries(this.appid)) {
        if (entry.uin === id) delete this.appid[appId]
      }
      if (AgentRuntime[id]) delete AgentRuntime[id]
      AgentRuntime.uin = AgentRuntime.uin.filter(u => u !== id)
      if (reason != null) {
        AgentRuntime.em('qqbot.disconnect', { self_id: id, reason })
        AgentRuntime.em(`disconnect.${id}`, { self_id: id, reason })
      }
    }

    async disconnect(id) {
      const bot = this.bots.get(id)
      if (!bot) return
      AgentRuntime.makeLog('mark', `${bot.nickname || id} 断开连接`, id)
      // 手动断开：停止自动重连编排，避免立刻被连回来
      this.connectionManager?.stop(id)
      try {
        bot.sdk.removeAllListeners('message')
        bot.sdk.removeAllListeners('notice')
        await bot.logout()
      } catch (err) {
        AgentRuntime.makeLog('debug', `断开异常: ${errMsg(err)}`, id)
      }
      this.cleanupBot(id)
    }

    async makeWebHookSign(id, req, res, secret) {
      const { sign } = (await import('tweetnacl')).default
      const { plain_token, event_ts } = req.body.d
      while (secret.length < 32) secret = secret.repeat(2).slice(0, 32)
      const signature = Buffer.from(sign.detached(
        Buffer.from(`${event_ts}${plain_token}`),
        sign.keyPair.fromSeed(Buffer.from(secret)).secretKey,
      )).toHex()
      res.send({ plain_token, signature })
    }

    makeWebHook(req, res) {
      const appid = req.headers['x-bot-appid']
      if (!(appid in this.appid)) {
        AgentRuntime.makeLog('warn', `WebHook 无对应账号: ${appid}`, LOG)
        return res.sendStatus(404)
      }
      if ('plain_token' in (req.body?.d || {})) {
        return this.makeWebHookSign(this.appid[appid].uin, req, res, this.appid[appid].info.secret)
      }
      if ('t' in (req.body || {})) this.appid[appid].sdk.dispatchEvent(req.body.t, req.body)
      res.sendStatus(200)
    }
  })(),
)
