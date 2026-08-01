import CommonConfigRegistry from '../../../src/infrastructure/commonconfig/loader.js'
import { normalizeError } from '../../../src/utils/normalize-error.js'

AgentRuntime.makeLog('info', '正在加载 QQBot 适配器 Core', 'QQbot-Core')

;(async () => {
  try {
    const config = CommonConfigRegistry.get('qqbot')
    if (!config) {
      AgentRuntime.makeLog('warn', 'QQBot 配置实例未注册（commonconfig 未加载？）', 'QQbot-Core')
      return
    }

    if (!await config.exists()) {
      // read() 会从 default/ 模板取默认值；write 落盘到 data/QQBot.json
      const data = await config.read()
      await config.write(data, { backup: false, validate: false })
      AgentRuntime.makeLog('info', `已自动创建 QQBot 配置文件: ${config.getFilePath()}`, 'QQbot-Core')
      AgentRuntime.makeLog('info', '请编辑配置或打开 Web 管理页添加 AppID / ClientSecret', 'QQbot-Core')
    }
  } catch (err) {
    const error = normalizeError(err)
    AgentRuntime.makeLog('error', `QQBot 配置初始化失败: ${error.message}`, 'QQbot-Core', error)
  }
})()
