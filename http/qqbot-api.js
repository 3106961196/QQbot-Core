import RuntimeUtil from '../../../src/utils/runtime-util.js';
import runtimeConfig from '../../../src/infrastructure/config/config.js';
import { HttpResponse } from '../../../src/utils/http-utils.js';
import ConfigLoader from '../../../src/infrastructure/commonconfig/loader.js';
import crypto from 'node:crypto';

/** 仅换票校验凭证，不走 WebSocket Identify（避免测完再保存触发登录频繁） */
const CRED_PROBE_TIMEOUT = 15000
const APP_ACCESS_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const SESSION_COOKIE_NAME = 'qqbot_session'
const SESSION_EXPIRE_MS = 15 * 24 * 60 * 60 * 1000
const sessions = new Map()
/** 临时 Key 有效期 1 天（单次兑换登录） */
const TEMP_KEY_EXPIRE_MS = 24 * 60 * 60 * 1000
const tempKeys = new Map()

/** 临时 Key：同一 IP 5 分钟内仅可获取 1 次 */
const TEMP_KEY_COOLDOWN_MS = 5 * 60 * 1000
/** ip → 上次成功发放时间戳 */
const tempKeyRateLimit = new Map()

// 定期清理过期限流记录
setInterval(() => {
  const now = Date.now()
  for (const [ip, lastAt] of tempKeyRateLimit) {
    if (now - lastAt > TEMP_KEY_COOLDOWN_MS) tempKeyRateLimit.delete(ip)
  }
}, 10 * 60 * 1000)

const parseCookies = (req) => {
  const cookieHeader = req.headers?.cookie
  if (!cookieHeader) return {}
  
  const cookies = {}
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=')
    if (name && rest.length > 0) {
      cookies[name] = rest.join('=')
    }
  })
  return cookies
}

const setSessionCookie = (req, res, sessionId) => {
  const isSecure = req.protocol === 'https' || req.secure
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    'Path=/',
    `Max-Age=${SESSION_EXPIRE_MS / 1000}`,
    'HttpOnly',
    'SameSite=Strict',
    isSecure ? 'Secure' : '',
  ].filter(Boolean).join('; '))
}

const createSession = (ip) => {
  const sessionId = crypto.randomBytes(32).toHex()
  sessions.set(sessionId, {
    ip,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_EXPIRE_MS
  })
  setTimeout(() => sessions.delete(sessionId), SESSION_EXPIRE_MS)
  return sessionId
}

const validateSession = (sessionId, ip) => {
  const session = sessions.get(sessionId)
  if (!session) return false
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId)
    return false
  }
  if (session.ip && session.ip !== ip) {
    RuntimeUtil.makeLog('warn', `session IP mismatch`, 'QQBot')
    return false
  }
  return true
}

const createTempKey = () => {
  const key = crypto.randomBytes(16).toHex()
  tempKeys.set(key, {
    createdAt: Date.now(),
    expiresAt: Date.now() + TEMP_KEY_EXPIRE_MS
  })
  setTimeout(() => tempKeys.delete(key), TEMP_KEY_EXPIRE_MS)
  return key
}

const validateTempKey = (key) => {
  const tempKey = tempKeys.get(key)
  if (!tempKey) return false
  if (Date.now() > tempKey.expiresAt) {
    tempKeys.delete(key)
    return false
  }
  tempKeys.delete(key)
  return true
}

const checkTempKeyRateLimit = (ip) => {
  const now = Date.now()
  const lastAt = tempKeyRateLimit.get(ip)
  if (!lastAt) return { allowed: true, retryAfter: 0 }

  const remainMs = TEMP_KEY_COOLDOWN_MS - (now - lastAt)
  if (remainMs <= 0) {
    tempKeyRateLimit.delete(ip)
    return { allowed: true, retryAfter: 0 }
  }

  return { allowed: false, retryAfter: Math.ceil(remainMs / 1000) }
}

const markTempKeyIssued = (ip) => {
  tempKeyRateLimit.set(ip, Date.now())
}

const formatCooldownHint = (retryAfterSec) => {
  const s = Math.max(1, Number(retryAfterSec) || 1)
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m <= 0) return `${r} 秒`
  if (r === 0) return `${m} 分钟`
  return `${m} 分 ${r} 秒`
}

const ensureAuthorized = (req, res) => {
  const cookies = parseCookies(req)
  const sessionCookie = cookies[SESSION_COOKIE_NAME]
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'

  if (sessionCookie && validateSession(sessionCookie, ip)) {
    return true
  }

  RuntimeUtil.makeLog('warn', `unauthorized IP: ${ip}`, 'QQBot')
  HttpResponse.forbidden(res, 'Unauthorized')
  return false
};

const getConfigInstance = () => ConfigLoader.get('qqbot');

const getTasker = (runtime) => runtime.tasker.find(t => t.id === 'QQBot');

/**
 * 凭证探测：只调 getAppAccessToken，不建 WS、不 Identify。
 * 正式上线连接留给 Tasker.connect，保证「测 → 存」只登录一次。
 */
const probeConnect = async (appId, clientSecret) => {
  const res = await fetch(APP_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      appId: String(appId),
      clientSecret: String(clientSecret),
    }),
    signal: AbortSignal.timeout(CRED_PROBE_TIMEOUT),
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    throw new Error(`凭证接口响应异常 (HTTP ${res.status})`)
  }

  if (!res.ok || !data?.access_token) {
    const detail = data?.message || data?.msg || data?.error || data?.code || `HTTP ${res.status}`
    throw new Error(`凭证无效: ${detail}`)
  }

  return { expiresIn: data.expires_in }
}

const readMasterList = () => {
  const list = runtimeConfig.chatbot?.master?.qq || []
  return (Array.isArray(list) ? list : [list]).map(String).filter(Boolean)
};

const saveMasterList = (list) => {
  const chatbotConfig = { ...(runtimeConfig.chatbot || {}) }
  chatbotConfig.master = { ...(chatbotConfig.master || {}), qq: list }
  runtimeConfig.setConfig('chatbot', chatbotConfig)
  RuntimeUtil.makeLog('debug', `QQBot 主人列表已保存: ${list.length} 个`, 'QQBot')
};

export default {
  name: 'qqbot-manager',
  dsc: 'QQBot管理API - QQBot配置与状态管理接口',
  priority: 80,

  routes: [
    {
      method: 'POST',
      path: '/api/qqbot/auth/temp-key',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown'

        const rateLimit = checkTempKeyRateLimit(ip)
        if (!rateLimit.allowed) {
          RuntimeUtil.makeLog('warn', `temp-key cooldown IP: ${ip}, retryAfter=${rateLimit.retryAfter}s`, 'QQBot')
          res.setHeader('Retry-After', String(rateLimit.retryAfter))
          return res.status(429).json({
            success: false,
            message: `同一 IP 5 分钟内只能获取 1 次，请 ${formatCooldownHint(rateLimit.retryAfter)} 后再试`,
            code: 'TEMP_KEY_RATE_LIMIT',
            retryAfter: rateLimit.retryAfter,
          })
        }

        try {
          const tempKey = createTempKey()
          markTempKeyIssued(ip)
          RuntimeUtil.makeLog('mark', `QQBot temp-key: ${tempKey} (1d) IP: ${ip}`, 'QQBot')
          HttpResponse.success(res, {
            cooldownSeconds: Math.floor(TEMP_KEY_COOLDOWN_MS / 1000),
            keyTtlSeconds: Math.floor(TEMP_KEY_EXPIRE_MS / 1000),
          }, '临时 Key 已写入主服日志，1 天内有效')
        } catch (err) {
          RuntimeUtil.makeLog('error', `生成临时Key异常: ${err.message}`, 'QQBot', err)
          HttpResponse.error(res, err, 500, 'auth.temp-key')
        }
      }, 'qqbot.auth.temp-key')
    },
    
    {
      method: 'POST',
      path: '/api/qqbot/auth/temp-login',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const { tempKey } = req.body || {}
        const ip = req.ip || req.connection?.remoteAddress || 'unknown'
        
        if (!tempKey) {
          return HttpResponse.validationError(res, '临时Key不能为空')
        }
        
        if (!validateTempKey(tempKey)) {
          RuntimeUtil.makeLog('warn', `[临时Key登录失败] Key无效或已过期 IP: ${ip}`, 'QQBot')
          return HttpResponse.forbidden(res, '临时Key无效或已过期')
        }
        
        const sessionId = createSession(ip)
        setSessionCookie(req, res, sessionId)
        
        RuntimeUtil.makeLog('info', `temp-key login OK IP: ${ip}`, 'QQBot')
        HttpResponse.success(res, { message: '登录成功' })
      }, 'qqbot.auth.temp-login')
    },
    
    {
      method: 'POST',
      path: '/api/qqbot/auth/logout',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown'
        const cookies = parseCookies(req)
        const sessionCookie = cookies[SESSION_COOKIE_NAME]
        
        if (sessionCookie) {
          sessions.delete(sessionCookie)
        }
        
        res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly`)
        RuntimeUtil.makeLog('info', `logout IP: ${ip}`, 'QQBot')
        HttpResponse.success(res, { message: '登出成功' })
      }, 'qqbot.auth.logout')
    },
    
    {
      method: 'GET',
      path: '/api/qqbot/auth/check',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        const cookies = parseCookies(req)
        const sessionCookie = cookies[SESSION_COOKIE_NAME]
        const ip = req.ip || req.connection?.remoteAddress || 'unknown'
        
        const isValid = sessionCookie && validateSession(sessionCookie, ip)
        HttpResponse.success(res, { authenticated: isValid })
      }, 'qqbot.auth.check')
    },
    
    {
      method: 'GET',
      path: '/api/qqbot/status',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const tasker = getTasker(Bot);
        const config = getConfigInstance();

        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }

        const accounts = config ? (await config.listAccounts()) : [];
        const bots = [];

        for (const account of accounts) {
          const botId = String(account.appId);
          const onlineBot = tasker.bots.get(botId);
          
          bots.push({
            id: botId,
            appId: account.appId,
            nickname: onlineBot?.nickname || account.nickname || account.appId,
            remark: account.remark || '',
            avatar: onlineBot?.avatar || `https://q.qlogo.cn/g?b=qq&s=0&nk=${botId}`,
            status: onlineBot ? 'online' : 'offline',
            enabled: account.enabled !== false,
            startTime: onlineBot?.stat?.start_time,
          });
        }

        HttpResponse.success(res, {
          loaded: true,
          version: tasker.version,
          bots,
          botCount: bots.length,
          onlineCount: bots.filter(b => b.status === 'online').length,
        });
      }, 'qqbot.status')
    },

    {
      method: 'GET',
      path: '/api/qqbot/config',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const data = await config.read();
        const accounts = (data.accounts || []).map(a => ({
          name: a.appId,
          appId: a.appId,
          nickname: a.nickname || '',
          remark: a.remark || '',
          enabled: a.enabled !== false,
          markdownSupport: a.markdownSupport,
        }));
        HttpResponse.success(res, { 
          accounts, 
          bot: data.bot,
          toQRCode: data.toQRCode,
          toCallback: data.toCallback,
          toBotUpload: data.toBotUpload,
          hideGuildRecall: data.hideGuildRecall,
          imageLength: data.imageLength,
          defaultMarkdownSupport: data.defaultMarkdownSupport,
        });
      }, 'qqbot.config.read')
    },

    {
      method: 'PUT',
      path: '/api/qqbot/config',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const data = await config.read();
        const body = req.body || {};

        if (body.toQRCode !== undefined) data.toQRCode = body.toQRCode;
        if (body.toCallback !== undefined) data.toCallback = body.toCallback;
        if (body.toBotUpload !== undefined) data.toBotUpload = body.toBotUpload;
        if (body.hideGuildRecall !== undefined) data.hideGuildRecall = body.hideGuildRecall;
        if (body.imageLength !== undefined) data.imageLength = body.imageLength;
        if (body.defaultMarkdownSupport !== undefined) data.defaultMarkdownSupport = body.defaultMarkdownSupport;
        
        if (body.bot) {
          data.bot = data.bot || {};
          if (body.bot.sandbox !== undefined) data.bot.sandbox = body.bot.sandbox;
          if (body.bot.maxRetry !== undefined) data.bot.maxRetry = body.bot.maxRetry;
          if (body.bot.timeout !== undefined) data.bot.timeout = Math.max(1000, body.bot.timeout);
        }

        await config.write(data);
        const tasker = getTasker(Bot);
        if (tasker?.loadConfig) await tasker.loadConfig();
        HttpResponse.success(res, null, '配置已保存');
      }, 'qqbot.config.update')
    },

    {
      method: 'POST',
      path: '/api/qqbot/config',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const { data } = req.body || {};
        if (!data) {
          return HttpResponse.validationError(res, '缺少配置数据');
        }

        await config.write(data);
        const tasker = getTasker(Bot);
        if (tasker?.loadConfig) await tasker.loadConfig();
        HttpResponse.success(res, null, '配置已保存');
      }, 'qqbot.config.write')
    },

    {
      method: 'POST',
      path: '/api/qqbot/test-connect',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const { appId, clientSecret } = req.body || {};
        if (!appId || !clientSecret) {
          return HttpResponse.validationError(res, '缺少appId或clientSecret');
        }

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        try {
          const probe = await probeConnect(appId, clientSecret);
          HttpResponse.success(res, { ok: true, expiresIn: probe.expiresIn }, '凭证有效（未占用网关登录）');
        } catch (err) {
          RuntimeUtil.makeLog('error', `QQBot凭证校验失败: ${err.message}`, 'QQBotAPI', err);
          HttpResponse.error(res, err, 400, 'qqbot.test-connect');
        }
      }, 'qqbot.test-connect')
    },

    {
      method: 'POST',
      path: '/api/qqbot/accounts',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const { appId, clientSecret, enabled = true, markdownSupport = false, remark = '' } = req.body || {};
        if (!appId || !clientSecret) {
          return HttpResponse.validationError(res, '缺少appId或clientSecret');
        }

        try {
          await probeConnect(appId, clientSecret);
        } catch (err) {
          RuntimeUtil.makeLog('warn', `拒绝保存凭证无效账号 ${appId}: ${err.message}`, 'QQBotAPI');
          return HttpResponse.error(res, err, 400, '凭证无效，已拒绝写入配置');
        }

        const account = {
          name: appId,
          appId,
          clientSecret,
          enabled,
          markdownSupport,
          remark: String(remark || ''),
          nickname: '',
        };
        const accounts = await config.addAccount(account);

        const tasker = getTasker(Bot);
        if (tasker && enabled !== false) {
          const botId = appId;
          if (tasker.bots.has(botId)) {
            await tasker.disconnect(botId);
          }
          const ok = await tasker.connect(account);
          if (!ok) {
            return HttpResponse.error(res, new Error('凭证有效但正式连接失败'), 400, 'qqbot.accounts.add');
          }
        }

        HttpResponse.success(res, { accounts: await config.listAccounts() }, '账号已保存并连接');
      }, 'qqbot.accounts.add')
    },

    {
      method: 'DELETE',
      path: '/api/qqbot/accounts/:appId',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const { appId } = req.params;
        const accounts = await config.listAccounts();
        const account = accounts.find(a => a.appId === appId);
        
        if (!account) {
          return HttpResponse.notFound(res, `账号 ${appId} 不存在`);
        }

        const tasker = getTasker(Bot);
        if (tasker) {
          await tasker.disconnect(account.appId);
        }

        await config.removeAccount(account.appId);

        HttpResponse.success(res, { accounts: await config.listAccounts() }, '账号已删除');
      }, 'qqbot.accounts.remove')
    },

    {
      method: 'POST',
      path: '/api/qqbot/disconnect/:appId',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const tasker = getTasker(Bot);
        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }

        const { appId } = req.params;
        await tasker.disconnect(appId);
        HttpResponse.success(res, null, '已断开连接');
      }, 'qqbot.disconnect')
    },

    {
      method: 'POST',
      path: '/api/qqbot/reconnect/:appId',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const tasker = getTasker(Bot);
        const config = getConfigInstance();
        
        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }
        
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const { appId } = req.params;
        const accounts = await config.listAccounts();
        const account = accounts.find(a => a.appId === appId);
        
        if (!account) {
          return HttpResponse.notFound(res, `账号 ${appId} 不存在`);
        }

        if (tasker.bots.has(account.appId)) {
          await tasker.disconnect(account.appId);
        }
        
        try {
          const success = await tasker.connect(account);
          if (success) {
            HttpResponse.success(res, null, '重连成功');
          } else {
            HttpResponse.error(res, new Error('重连失败'), 400, 'qqbot.reconnect');
          }
        } catch (err) {
          RuntimeUtil.makeLog('error', `QQBot重连失败: ${err.message}`, 'QQBotAPI', err);
          HttpResponse.error(res, err, 400, 'qqbot.reconnect');
        }
      }, 'qqbot.reconnect')
    },

    {
      method: 'POST',
      path: '/api/qqbot/reload',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const tasker = getTasker(Bot);
        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }

        try {
          await tasker.loadConfig();
          HttpResponse.success(res, null, '配置已重新加载');
        } catch (err) {
          RuntimeUtil.makeLog('error', `QQBot配置重载失败: ${err.message}`, 'QQBotAPI', err);
          HttpResponse.error(res, err, 500, 'qqbot.reload');
        }
      }, 'qqbot.reload')
    },

    {
      method: 'POST',
      path: '/api/qqbot/master/:botId',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const { botId } = req.params
        const { user_id } = req.body || {}

        if (!user_id) {
          return HttpResponse.validationError(res, 'user_id 不能为空')
        }

        const bot = Bot[botId]
        if (!bot) {
          return HttpResponse.notFound(res, '机器人不存在或未在线')
        }

        try {
          const masterKey = String(user_id).includes(':') ? String(user_id) : `${botId}:${user_id}`
          const masters = readMasterList()
          if (!masters.includes(masterKey)) {
            masters.push(masterKey)
            saveMasterList(masters)
            RuntimeUtil.makeLog('info', `add master ${masterKey}`, 'QQBot')
            HttpResponse.success(res, { user_id: masterKey }, '添加主人成功')
          } else {
            HttpResponse.success(res, { user_id: masterKey }, '该用户已是主人')
          }
        } catch (err) {
          RuntimeUtil.makeLog('error', `添加主人失败: ${err.message}`, 'QQBotAPI', err)
          HttpResponse.error(res, err, 500, 'qqbot.master.add')
        }
      }, 'qqbot.master.add')
    },

    {
      method: 'GET',
      path: '/api/qqbot/master/:botId',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const { botId } = req.params
        const prefix = `${botId}:`
        const masters = readMasterList()
          .filter(m => String(m).startsWith(prefix) || !String(m).includes(':'))
          .map(m => {
            const str = String(m)
            return str.startsWith(prefix) ? str.slice(prefix.length) : str
          })

        HttpResponse.success(res, { masters })
      }, 'qqbot.master.list')
    },

    {
      method: 'DELETE',
      path: '/api/qqbot/master/:botId/:master',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const { botId, master } = req.params
        const masterKey = `${botId}:${master}`
        const masters = readMasterList()
        const index = masters.indexOf(masterKey)

        if (index > -1) {
          masters.splice(index, 1)
          saveMasterList(masters)
          RuntimeUtil.makeLog('info', `remove master ${botId}:${master}`, 'QQBot')
          HttpResponse.success(res, null, '移除成功')
        } else {
          HttpResponse.notFound(res, '该主人不存在')
        }
      }, 'qqbot.master.remove')
    },

    {
      method: 'GET',
      path: '/api/qqbot/accounts/:appId/config',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const { appId } = req.params
        const config = getConfigInstance()
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到')
        }

        const data = await config.read()
        const account = (data.accounts || []).find(a => a.appId === appId)

        if (!account) {
          return HttpResponse.notFound(res, '账户不存在')
        }

        HttpResponse.success(res, {
          config: {
            nickname: account.nickname || '',
            remark: account.remark || '',
            sandbox: data.bot?.sandbox ?? false,
            maxRetry: data.bot?.maxRetry ?? 10,
            timeout: data.bot?.timeout ?? 30000,
            markdownSupport: account.markdownSupport ?? false,
            autoConnect: account.autoConnect !== false,
            toQRCode: data.toQRCode ?? true,
            toCallback: data.toCallback ?? true,
            toBotUpload: data.toBotUpload ?? true,
            hideGuildRecall: data.hideGuildRecall ?? false,
            imageLength: data.imageLength ?? 3
          }
        })
      }, 'qqbot.account.config.read')
    },

    {
      method: 'PUT',
      path: '/api/qqbot/accounts/:appId/config',
      systemAuth: false,
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res)) return;

        const { appId } = req.params
        const config = getConfigInstance()
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到')
        }

        const data = await config.read()
        const accountIndex = (data.accounts || []).findIndex(a => a.appId === appId)

        if (accountIndex === -1) {
          return HttpResponse.notFound(res, '账户不存在')
        }

        const body = req.body || {}

        if (body.sandbox !== undefined) {
          data.bot = data.bot || {}
          data.bot.sandbox = body.sandbox
        }
        if (body.maxRetry !== undefined) {
          data.bot = data.bot || {}
          data.bot.maxRetry = body.maxRetry
        }
        if (body.timeout !== undefined) {
          data.bot = data.bot || {}
          data.bot.timeout = Math.max(1000, body.timeout)
        }
        if (body.remark !== undefined) {
          data.accounts[accountIndex].remark = String(body.remark)
        }
        if (body.markdownSupport !== undefined) {
          data.accounts[accountIndex].markdownSupport = body.markdownSupport
        }
        if (body.autoConnect !== undefined) {
          data.accounts[accountIndex].autoConnect = body.autoConnect
        }
        if (body.toQRCode !== undefined) {
          data.toQRCode = body.toQRCode
        }
        if (body.toCallback !== undefined) {
          data.toCallback = body.toCallback
        }
        if (body.toBotUpload !== undefined) {
          data.toBotUpload = body.toBotUpload
        }
        if (body.hideGuildRecall !== undefined) {
          data.hideGuildRecall = body.hideGuildRecall
        }
        if (body.imageLength !== undefined) {
          data.imageLength = body.imageLength
        }

        await config.write(data)
        const tasker = getTasker(Bot)
        if (tasker?.loadConfig) await tasker.loadConfig()
        HttpResponse.success(res, null, '配置已保存')
      }, 'qqbot.account.config.update')
    },
  ]
};
