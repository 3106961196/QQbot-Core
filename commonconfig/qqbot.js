import ConfigBase from '../../../src/infrastructure/commonconfig/commonconfig.js';

export default class QQBotConfig extends ConfigBase {
  constructor() {
    super({
      name: 'qqbot',
      displayName: 'QQBot配置',
      description: 'QQBot官方机器人配置管理',
      filePath: 'data/QQBot.json',
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
                label: '账户名称',
                description: '账户标识名称',
                default: 'default',
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
                label: '超时时间',
                description: '请求超时时间(毫秒)',
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

  async getAccount(accountName = 'default') {
    const data = await this.read();
    const accounts = data.accounts || [];
    return accounts.find(a => a.name === accountName);
  }

  async addAccount(account) {
    const data = await this.read();
    if (!data.accounts) data.accounts = [];
    const existingIndex = data.accounts.findIndex(a => a.name === account.name);
    if (existingIndex >= 0) {
      data.accounts[existingIndex] = account;
    } else {
      data.accounts.push(account);
    }
    await this.write(data);
    return data.accounts;
  }

  async removeAccount(accountName) {
    const data = await this.read();
    if (data.accounts) {
      data.accounts = data.accounts.filter(a => a.name !== accountName);
      await this.write(data);
    }
    return data.accounts;
  }

  async listAccounts() {
    const data = await this.read();
    return data.accounts || [];
  }
}
