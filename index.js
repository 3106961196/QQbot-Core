import CommonConfigRegistry from '../../src/infrastructure/commonconfig/loader.js'
import { normalizeError } from '../../src/utils/normalize-error.js'

;(async () => {
  try {
    const config = CommonConfigRegistry.get('qqbot')
    if (!config) return
    if (await config.exists()) return
    await config.write(await config.read(), { backup: false, validate: false })
    AgentRuntime.makeLog('info', `已创建 ${config.getFilePath()}`, 'QQbot-Core')
  } catch (err) {
    AgentRuntime.makeLog('error', `QQBot 配置初始化失败: ${normalizeError(err).message}`, 'QQbot-Core', err)
  }
})()
