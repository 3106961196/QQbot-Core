import ConfigBase from '../../../src/infrastructure/commonconfig/commonconfig.js';

/** 模板：core/QQbot-Core/default/qqbot.json → 运行时：data/QQBot.json */
export default class QQBotConfig extends ConfigBase {
  #writeLock = Promise.resolve()

  constructor() {
    super({
      name: 'qqbot',
      displayName: 'QQBot配置',
      description: 'QQBot官方机器人配置管理',
      filePath: 'data/QQBot.json',
      defaultTemplatePath: 'core/QQbot-Core/default/qqbot.json',
      fileType: 'json',
      schema: {
        fields: {
          tips: {
            type: 'string',
            label: '提示信息',
            description: '配置提示信息',
            default: 'QQBot 官方机器人配置',
            component: 'Input'
          },
          accounts: {
            type: 'array',
            label: '机器人账户列表',
            description: 'QQBot机器人账户配置',
            itemType: 'object',
            default: [],
            component: 'JsonEditor',
            fields: {
              name: {
                type: 'string',
                label: 'botId',
                description: '固定为 AppID，勿手改',
                default: '',
                component: 'Input'
              },
              appId: {
                type: 'string',
                label: 'AppID',
                description: 'QQ开放平台应用的AppID',
                default: '',
                component: 'Input'
              },
              clientSecret: {
                type: 'string',
                label: 'ClientSecret',
                description: 'QQ开放平台应用的ClientSecret',
                default: '',
                component: 'Password'
              },
              nickname: {
                type: 'string',
                label: '昵称',
                description: '连接成功后由接口自动写入',
                default: '',
                component: 'Input'
              },
              remark: {
                type: 'string',
                label: '备注',
                description: '本地备注，仅管理页展示',
                default: '',
                component: 'Input'
              },
              enabled: {
                type: 'boolean',
                label: '启用状态',
                description: '是否启用此账户',
                default: true,
                component: 'Switch'
              },
              markdownSupport: {
                type: 'boolean',
                label: 'Markdown支持',
                description: '是否启用Markdown消息格式',
                default: false,
                component: 'Switch'
              },
              autoConnect: {
                type: 'boolean',
                label: '自动连接',
                description: '启动时是否自动连接此账户',
                default: true,
                component: 'Switch'
              }
            }
          },
          bot: {
            type: 'object',
            label: 'Bot基础配置',
            component: 'SubForm',
            fields: {
              sandbox: {
                type: 'boolean',
                label: '沙箱模式',
                description: '是否启用沙箱环境',
                default: false,
                component: 'Switch'
              },
              maxRetry: {
                type: 'number',
                label: '最大重试次数',
                description: '连接失败时的最大重试次数',
                min: 0,
                default: 10,
                component: 'InputNumber'
              },
              timeout: {
                type: 'number',
                label: 'API请求超时',
                description: '调用QQ官方API的超时时间(毫秒)',
                min: 1000,
                default: 30000,
                component: 'InputNumber'
              }
            }
          },
          toQRCode: {
            type: 'boolean',
            label: 'URL转二维码',
            description: '将URL转换为二维码图片',
            default: true,
            component: 'Switch'
          },
          toCallback: {
            type: 'boolean',
            label: '按钮回调模式',
            description: '启用按钮点击回调功能',
            default: true,
            component: 'Switch'
          },
          toBotUpload: {
            type: 'boolean',
            label: 'Bot上传资源',
            description: '使用Bot上传图片和语音资源',
            default: true,
            component: 'Switch'
          },
          hideGuildRecall: {
            type: 'boolean',
            label: '隐藏频道撤回',
            description: '撤回频道消息时是否隐藏',
            default: false,
            component: 'Switch'
          },
          imageLength: {
            type: 'number',
            label: '图片压缩阈值',
            description: '图片压缩阈值(MB)',
            min: 0,
            max: 50,
            default: 3,
            component: 'InputNumber'
          },
          markdown: {
            type: 'object',
            label: 'Markdown配置',
            description: 'Markdown消息模板配置',
            component: 'SubForm',
            default: {},
            fields: {
              template: {
                type: 'array',
                label: '模板参数名',
                description: 'Markdown模板参数名数组',
                itemType: 'string',
                default: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
                component: 'JsonEditor'
              }
            }
          }
        }
      }
    });
  }

  /**
   * 首次读取若尚无 data/QQBot.json，把模板落盘（避免只读内存模板、控制台保存才“出现文件”）。
   */
  async read(useCache = true) {
    const missing = !(await this.exists())
    const data = await super.read(useCache)
    if (missing) {
      await this.write(data, { backup: false, validate: false })
    }
    return data
  }

  async getAccount(accountName = 'default') {
    const data = await this.read();
    const accounts = data.accounts || [];
    return accounts.find(a => a.name === accountName);
  }

  async addAccount(account) {
    const release = await this._acquireLock()
    try {
      const data = await this.read();
      if (!data.accounts) data.accounts = [];
      const row = {
        ...account,
        name: account.appId,
        appId: account.appId,
        nickname: account.nickname || '',
        remark: account.remark || '',
      }
      const existingIndex = data.accounts.findIndex(a => a.appId === row.appId);
      if (existingIndex >= 0) {
        data.accounts[existingIndex] = { ...data.accounts[existingIndex], ...row };
      } else {
        data.accounts.push(row);
      }
      await this.write(data);
      return data.accounts;
    } finally {
      release()
    }
  }

  async removeAccount(accountId) {
    const release = await this._acquireLock()
    try {
      const data = await this.read();
      if (data.accounts) {
        data.accounts = data.accounts.filter(a => a.name !== accountId && a.appId !== accountId);
        await this.write(data);
      }
      return data.accounts;
    } finally {
      release()
    }
  }

  async _acquireLock() {
    let release
    const nextLock = new Promise(resolve => { release = resolve })
    const prevLock = this.#writeLock
    this.#writeLock = nextLock
    await prevLock
    return release
  }

  async listAccounts() {
    const data = await this.read();
    return data.accounts || [];
  }
}
