import BotUtil from '../../../src/utils/botutil.js';
import { HttpResponse } from '../../../src/utils/http-utils.js';
import ConfigLoader from '../../../src/infrastructure/commonconfig/loader.js';
import { Bot as QQBotSDK } from 'qq-group-bot';

const CONNECT_TEST_TIMEOUT = 15000
const authorizedIPs = new Set()

const ensureAuthorized = (req, res, Bot) => {
  if (Bot.checkApiAuthorization?.(req)) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown'
    if (!authorizedIPs.has(ip)) {
      authorizedIPs.add(ip)
      BotUtil.makeLog('info', `🟢 [Web登录] QQBot管理后台 - IP: ${ip}`, 'QQBot')
    }
    return true
  }
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  BotUtil.makeLog('warn', `🔴 [密钥验证失败] IP: ${ip}`, 'QQBot')
  HttpResponse.forbidden(res, 'Unauthorized');
  return false;
};

const logWebAccess = (req, Bot, action = '访问') => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown'
  BotUtil.makeLog('debug', `🟢 [Web操作] QQBot管理后台 - IP: ${ip} - ${action}`, 'QQBot')
};

const getConfigInstance = () => ConfigLoader.get('qqbot');

const getTasker = (Bot) => {
  return Bot.tasker.find(t => t.id === 'QQBot');
};

const saveMastersToConfig = async () => {
  try {
    const cfg = (await import('../../../src/infrastructure/config/config.js')).default
    const chatbotConfig = cfg.chatbot || {}
    chatbotConfig.master = chatbotConfig.master || {}
    chatbotConfig.master.qq = BotUtil.master.slice()
    cfg.setConfig('chatbot', chatbotConfig)
    BotUtil.makeLog('debug', `QQBot 主人列表已保存到配置: ${BotUtil.master.length} 个`, 'QQBot')
  } catch (err) {
    BotUtil.makeLog('error', `保存主人列表失败: ${err.message}`, 'QQBot', err)
  }
};

export default {
  name: 'qqbot-manager',
  dsc: 'QQBot管理API - QQBot配置与状态管理接口',
  priority: 80,

  routes: [
    {
      method: 'GET',
      path: '/api/qqbot/status',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        logWebAccess(req, Bot, '获取状态')

        const tasker = getTasker(Bot);
        const config = getConfigInstance();

        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }

        const accounts = config ? (await config.listAccounts()) : [];
        const bots = [];

        for (const account of accounts) {
          const botId = account.name || account.appId;
          const onlineBot = tasker.bots.get(botId);
          
          bots.push({
            id: botId,
            appId: account.appId,
            nickname: onlineBot?.nickname || account.name || account.appId,
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
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        logWebAccess(req, Bot, '获取配置')

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const data = await config.read();
        const accounts = (data.accounts || []).map(a => ({
          name: a.name,
          appId: a.appId,
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
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        logWebAccess(req, Bot, '更新配置')

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
        HttpResponse.success(res, null, '配置已保存');
      }, 'qqbot.config.update')
    },

    {
      method: 'POST',
      path: '/api/qqbot/config',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const { data } = req.body || {};
        if (!data) {
          return HttpResponse.validationError(res, '缺少配置数据');
        }

        await config.write(data);
        HttpResponse.success(res, null, '配置已保存');
      }, 'qqbot.config.write')
    },

    {
      method: 'POST',
      path: '/api/qqbot/test-connect',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const { appId, clientSecret } = req.body || {};
        if (!appId || !clientSecret) {
          return HttpResponse.validationError(res, '缺少appId或clientSecret');
        }

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const configData = await config.read();
        const botConfig = configData.bot || {};

        try {
          const testBot = new QQBotSDK({
            ...botConfig,
            appid: appId,
            secret: clientSecret,
            intents: ['GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE'],
          });

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              testBot.stop();
              reject(new Error('连接超时'));
            }, CONNECT_TEST_TIMEOUT);

            testBot.sessionManager.once('READY', () => {
              clearTimeout(timeout);
              testBot.stop();
              resolve();
            });

            testBot.sessionManager.once('DEAD', (data) => {
              clearTimeout(timeout);
              reject(new Error(data.msg || '连接失败'));
            });

            testBot.start();
          });

          HttpResponse.success(res, { success: true }, '连接测试成功');
        } catch (err) {
          BotUtil.makeLog('error', `QQBot连接测试失败: ${err.message}`, 'QQBotAPI', err);
          HttpResponse.error(res, err, 400, 'qqbot.test-connect');
        }
      }, 'qqbot.test-connect')
    },

    {
      method: 'POST',
      path: '/api/qqbot/accounts',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const { appId, clientSecret, name, enabled = true, markdownSupport = false } = req.body || {};
        if (!appId || !clientSecret) {
          return HttpResponse.validationError(res, '缺少appId或clientSecret');
        }

        const account = { name: name || appId, appId, clientSecret, enabled, markdownSupport };
        const accounts = await config.addAccount(account);

        const tasker = getTasker(Bot);
        if (tasker && enabled !== false) {
          const botId = account.name || appId;
          if (tasker.bots.has(botId)) {
            await tasker.disconnect(botId);
          }
          await tasker.connect(account);
        }

        HttpResponse.success(res, { accounts }, '账号已保存并连接');
      }, 'qqbot.accounts.add')
    },

    {
      method: 'DELETE',
      path: '/api/qqbot/accounts/:appId',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        logWebAccess(req, Bot, `删除账号 ${req.params.appId}`)

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const { appId } = req.params;
        const accounts = await config.listAccounts();
        const account = accounts.find(a => a.appId === appId || a.name === appId);
        
        if (!account) {
          return HttpResponse.notFound(res, `账号 ${appId} 不存在`);
        }

        const tasker = getTasker(Bot);
        if (tasker) {
          const botId = account.name || account.appId;
          await tasker.disconnect(botId);
        }

        await config.removeAccount(account.appId);

        HttpResponse.success(res, { accounts: await config.listAccounts() }, '账号已删除');
      }, 'qqbot.accounts.remove')
    },

    {
      method: 'POST',
      path: '/api/qqbot/disconnect/:appId',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const tasker = getTasker(Bot);
        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }

        const { appId } = req.params;
        
        let botId = appId;
        const config = getConfigInstance();
        if (config) {
          const accounts = await config.listAccounts();
          const account = accounts.find(a => a.appId === appId || a.name === appId);
          if (account) {
            botId = account.name || account.appId;
          }
        }
        
        await tasker.disconnect(botId);
        HttpResponse.success(res, null, '已断开连接');
      }, 'qqbot.disconnect')
    },

    {
      method: 'POST',
      path: '/api/qqbot/reconnect/:appId',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

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
        const account = accounts.find(a => a.appId === appId || a.name === appId);
        
        if (!account) {
          return HttpResponse.notFound(res, `账号 ${appId} 不存在`);
        }

        const botId = account.name || account.appId;
        
        if (tasker.bots.has(botId)) {
          await tasker.disconnect(botId);
        }
        
        const success = await tasker.connect(account);
        
        if (success) {
          HttpResponse.success(res, null, '重连成功');
        } else {
          HttpResponse.error(res, new Error('重连失败'), 400, 'qqbot.reconnect');
        }
      }, 'qqbot.reconnect')
    },

    {
      method: 'POST',
      path: '/api/qqbot/reload',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const tasker = getTasker(Bot);
        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }

        try {
          await tasker.loadConfig();
          HttpResponse.success(res, null, '配置已重新加载');
        } catch (err) {
          BotUtil.makeLog('error', `QQBot配置重载失败: ${err.message}`, 'QQBotAPI', err);
          HttpResponse.error(res, err, 500, 'qqbot.reload');
        }
      }, 'qqbot.reload')
    },

    {
      method: 'POST',
      path: '/api/qqbot/master/:botId',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        logWebAccess(req, Bot, `添加主人 ${req.params.botId}`)

        const { botId } = req.params
        const { user_id } = req.body || {}

        if (!user_id) {
          return HttpResponse.badRequest(res, 'user_id 不能为空')
        }

        const bot = Bot[botId]
        if (!bot) {
          return HttpResponse.notFound(res, '机器人不存在或未在线')
        }

        try {
          const masterKey = `${botId}:${user_id}`
          if (!Bot.master.includes(masterKey)) {
            Bot.master.push(masterKey)
            await saveMastersToConfig()
            BotUtil.makeLog('info', `🟢 [添加主人] QQBot (${bot.nickname || botId}) - 用户: ${user_id}`, 'QQBot')
            HttpResponse.success(res, { user_id }, '添加主人成功')
          } else {
            HttpResponse.success(res, { user_id }, '该用户已是主人')
          }
        } catch (err) {
          BotUtil.makeLog('error', `添加主人失败: ${err.message}`, 'QQBotAPI', err)
          HttpResponse.error(res, err, 500, 'qqbot.master.add')
        }
      }, 'qqbot.master.add')
    },

    {
      method: 'GET',
      path: '/api/qqbot/master/:botId',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const { botId } = req.params
        const cfg = (await import('../../../src/infrastructure/config/config.js')).default
        const masterList = cfg.master?.[botId] || []
        const masters = masterList.map(m => {
          const str = String(m)
          return str.includes(':') ? str.substring(str.indexOf(':') + 1) : str
        })

        HttpResponse.success(res, { masters })
      }, 'qqbot.master.list')
    },

    {
      method: 'DELETE',
      path: '/api/qqbot/master/:botId/:master',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        logWebAccess(req, Bot, `移除主人 ${req.params.botId}/${req.params.master}`)

        const { botId, master } = req.params
        const masterKey = `${botId}:${master}`
        const index = Bot.master.indexOf(masterKey)

        if (index > -1) {
          Bot.master.splice(index, 1)
          await saveMastersToConfig()
          BotUtil.makeLog('info', `🔴 [移除主人] QQBot (${botId}) - 用户: ${master}`, 'QQBot')
          HttpResponse.success(res, null, '移除成功')
        } else {
          HttpResponse.notFound(res, '该主人不存在')
        }
      }, 'qqbot.master.remove')
    },

    {
      method: 'GET',
      path: '/api/qqbot/accounts/:appId/config',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

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
            sandbox: data.bot?.sandbox ?? false,
            maxRetry: data.bot?.maxRetry ?? 10,
            timeout: data.bot?.timeout ?? 30000,
            markdownSupport: account.markdownSupport ?? false,
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
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;
        logWebAccess(req, Bot, `更新账户配置 ${req.params.appId}`)

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
        if (body.markdownSupport !== undefined) {
          data.accounts[accountIndex].markdownSupport = body.markdownSupport
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
        HttpResponse.success(res, null, '配置已保存')
      }, 'qqbot.account.config.update')
    },
  ]
};
