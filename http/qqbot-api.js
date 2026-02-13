import BotUtil from '../../../src/utils/botutil.js';
import { HttpResponse } from '../../../src/utils/http-utils.js';
import ConfigLoader from '../../../src/infrastructure/commonconfig/loader.js';

const ensureAuthorized = (req, res, Bot) => {
  if (Bot.checkApiAuthorization?.(req)) return true;
  HttpResponse.forbidden(res, 'Unauthorized');
  return false;
};

const getConfigInstance = () => {
  return ConfigLoader.get('qqbot');
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

        const tasker = Bot.tasker.find(t => t.id === 'QQBot');
        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }

        const bots = [];
        for (const [id, bot] of tasker.bots) {
          bots.push({
            id,
            nickname: bot.nickname,
            avatar: bot.avatar,
            status: 'online',
            startTime: bot.stat?.start_time,
            messageCount: bot.callback ? Object.keys(bot.callback).length : 0,
          });
        }

        HttpResponse.success(res, {
          loaded: true,
          version: tasker.version,
          bots,
          botCount: bots.length,
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
        HttpResponse.success(res, { data });
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

        const { data, backup = true, validate = true } = req.body || {};
        if (!data) {
          return HttpResponse.validationError(res, '缺少配置数据');
        }

        await config.write(data, { backup, validate });
        HttpResponse.success(res, null, '配置已保存');
      }, 'qqbot.config.write')
    },

    {
      method: 'GET',
      path: '/api/qqbot/tokens',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const data = await config.read();
        const tokens = (data.token || []).map(t => {
          const parts = t.split(':');
          return {
            id: parts[0],
            appid: parts[1],
            hasToken: !!parts[2],
            hasSecret: !!parts[3],
            groupMsg: parts[4] === '1',
            guildMsg: parts[5] === '1',
          };
        });

        HttpResponse.success(res, { tokens, count: tokens.length });
      }, 'qqbot.tokens.list')
    },

    {
      method: 'POST',
      path: '/api/qqbot/tokens',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const { token } = req.body || {};
        if (!token) {
          return HttpResponse.validationError(res, '缺少token参数');
        }

        const tokens = await config.addToken(token);
        HttpResponse.success(res, { tokens, count: tokens.length }, 'Token已添加');
      }, 'qqbot.tokens.add')
    },

    {
      method: 'DELETE',
      path: '/api/qqbot/tokens/:id',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const config = getConfigInstance();
        if (!config) {
          return HttpResponse.notFound(res, 'QQBot配置实例未找到');
        }

        const { id } = req.params;
        const data = await config.read();
        const token = (data.token || []).find(t => t.startsWith(`${id}:`));
        
        if (!token) {
          return HttpResponse.notFound(res, `Token ${id} 不存在`);
        }

        const tokens = await config.removeToken(token);
        HttpResponse.success(res, { tokens, count: tokens.length }, 'Token已删除');
      }, 'qqbot.tokens.remove')
    },

    {
      method: 'POST',
      path: '/api/qqbot/reload',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const tasker = Bot.tasker.find(t => t.id === 'QQBot');
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
      path: '/api/qqbot/connect',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const tasker = Bot.tasker.find(t => t.id === 'QQBot');
        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }

        const { token } = req.body || {};
        if (!token) {
          return HttpResponse.validationError(res, '缺少token参数');
        }

        try {
          const result = await tasker.connect(token);
          if (result) {
            HttpResponse.success(res, null, '连接成功');
          } else {
            HttpResponse.error(res, new Error('连接失败'), 500, 'qqbot.connect');
          }
        } catch (err) {
          BotUtil.makeLog('error', `QQBot连接失败: ${err.message}`, 'QQBotAPI', err);
          HttpResponse.error(res, err, 500, 'qqbot.connect');
        }
      }, 'qqbot.connect')
    },

    {
      method: 'POST',
      path: '/api/qqbot/disconnect/:id',
      handler: HttpResponse.asyncHandler(async (req, res, Bot) => {
        if (!ensureAuthorized(req, res, Bot)) return;

        const tasker = Bot.tasker.find(t => t.id === 'QQBot');
        if (!tasker) {
          return HttpResponse.notFound(res, 'QQBot Tasker 未加载');
        }

        const { id } = req.params;
        try {
          await tasker.disconnect(id);
          HttpResponse.success(res, null, '已断开连接');
        } catch (err) {
          BotUtil.makeLog('error', `QQBot断开失败: ${err.message}`, 'QQBotAPI', err);
          HttpResponse.error(res, err, 500, 'qqbot.disconnect');
        }
      }, 'qqbot.disconnect')
    },
  ]
};
