import QQBotConfig from './commonconfig/qqbot.js';

Bot.makeLog('info', '正在加载 QQBot 适配器 Core', 'QQbot-Core');

(async () => {
  try {
    const config = new QQBotConfig();

    if (!await config.exists()) {
      const defaultData = {
        tips: "QQBot 官方机器人配置",
        accounts: [],
        bot: {
          sandbox: false,
          maxRetry: 10,
          timeout: 30000
        },
        toQRCode: true,
        toCallback: true,
        toBotUpload: true,
        hideGuildRecall: false,
        imageLength: 3,
        markdown: {
          template: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
        }
      };

      await config.write(defaultData, { backup: false, validate: false });

      Bot.makeLog(
        'info',
        `已自动创建 QQBot 配置文件: ${config.getFilePath()}`,
        'QQbot-Core'
      );
      Bot.makeLog(
        'info',
        `请编辑配置文件添加机器人账号: appId 和 clientSecret`,
        'QQbot-Core'
      );
    }
  } catch (error) {
    Bot.makeLog(
      'error',
      `QQBot 配置初始化失败: ${error.message}`,
      'QQbot-Core',
      error
    );
  }
})();
