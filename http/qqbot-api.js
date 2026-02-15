import BotUtil from '../../../src/utils/botutil.js';
import { HttpResponse } from '../../../src/utils/http-utils.js';
import ConfigLoader from '../../../src/infrastructure/commonconfig/loader.js';
import { Bot as QQBotSDK } from 'qq-group-bot';

const CONNECT_TEST_TIMEOUT = 15000

const ensureAuthorized = (req, res, Bot) => {
  if (Bot.checkApiAuthorization?.(req)) return true;
  HttpResponse.forbidden(res, 'Unauthorized');
  return false;
};

const getConfigInstance = () => ConfigLoader.get('qqbot');

const getTasker = (Bot) => {
  return Bot.tasker.find(t => t.id === 'QQBot');
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
        HttpResponse.success(res, { accounts, bot: data.bot, toQRCode: data.toQRCode });
      }, 'qqbot.config.read')
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
  ]
};
