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
          toQRCode: {
            type: 'boolean',
            label: 'URL转二维码',
            description: '将URL转换为二维码图片',
            default: true,
            component: 'Switch'
          },
          toCallback: {
            type: 'boolean',
            label: '按钮回调',
            description: '启用按钮点击回调功能',
            default: true,
            component: 'Switch'
          },
          toBotUpload: {
            type: 'boolean',
            label: 'Bot上传资源',
            description: '使用Bot上传图片/语音资源',
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
            description: '图片压缩阈值(MB)，超过此大小进行压缩',
            min: 0,
            max: 50,
            // 默认关闭图片压缩，避免在未安装 sharp 时产生无意义的警告
            default: 0,
            component: 'InputNumber'
          },
          markdown: {
            type: 'object',
            label: 'Markdown配置',
            component: 'SubForm',
            fields: {
              template: {
                type: 'string',
                label: '模板ID序列',
                description: 'Markdown模板ID占位符序列',
                default: 'abcdefghij',
                component: 'Input'
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
          token: {
            type: 'array',
            label: '机器人Token列表',
            description: 'QQBot机器人Token配置列表，格式：id:appid:token:secret:群消息:频道消息',
            itemType: 'string',
            default: [],
            component: 'Tags'
          }
        }
      }
    });
  }

  async addToken(token) {
    const data = await this.read();
    if (!data.token) data.token = [];
    if (!data.token.includes(token)) {
      data.token.push(token);
      await this.write(data);
    }
    return data.token;
  }

  async removeToken(token) {
    const data = await this.read();
    if (data.token) {
      data.token = data.token.filter(t => t !== token);
      await this.write(data);
    }
    return data.token;
  }

  async setMarkdownTemplate(botId, templateId) {
    const data = await this.read();
    if (!data.markdown) data.markdown = { template: 'abcdefghij' };
    data.markdown[botId] = templateId;
    await this.write(data);
    return data.markdown;
  }
}
