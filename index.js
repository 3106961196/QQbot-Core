import QQBotConfig from './commonconfig/qqbot.js';

// 优先确保 QQBot 配置文件存在（按 schema 默认值生成）
try {
  const cfgg = new QQBotConfig();
  if (!await cfgg.exists()) {
    await cfgg.write(cfgg.getDefaultFromSchema(), { backup: false, validate: true });
    Bot.makeLog('info', '已生成 QQBot 默认配置文件: data/QQBot.json', 'QQbot-Core');
  }
} catch (err) {
  Bot.makeLog('error', `初始化 QQBot 配置失败: ${err.message}`, 'QQbot-Core', err);
}

Bot.makeLog('info', '正在加载 QQBot 适配器 Core', 'QQbot-Core');
