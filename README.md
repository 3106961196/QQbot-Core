<div align="center">

# QQBot-Core

**XRK-AGT 的 QQ 官方机器人通道：基于 [qq-group-bot](https://github.com/Nicexw/qc-native-sdk) SDK，支持群消息、频道消息、私聊消息等多种消息类型的收发，事件与框架标准对齐，经 `e.reply` 进入插件。**

[![XRK-AGT](https://img.shields.io/badge/XRK--AGT-runtime-blue.svg)](https://github.com/sunflowermm/XRK-AGT)
[![QQ Open](https://img.shields.io/badge/QQ%20Open-open.qq.com-12B7F5.svg)](https://q.qq.com/)
[![SDK](https://img.shields.io/badge/SDK-qq--group--bot-333.svg)](https://www.npmjs.com/package/qq-group-bot)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

</div>

***

## 拉取代码

```bash
# 克隆到 XRK-AGT 的 core 目录下
git clone https://github.com/3106961196/QQbot-Core.git core/QQbot-Core
```

***

## QQ 开放平台：凭证从哪来

| 步骤 | 说明 |
|------|------|
| 1. 登录开放平台 | 访问 [QQ 开放平台](https://open.qq.com/) 并登录 QQ 账号 |
| 2. 创建机器人 | 进入「机器人」→「创建机器人」，按需填写 |
| 3. 获取凭证 | 创建成功后，在开发管理页面获取 **AppID** 和 **ClientSecret** |
| 4. 配置沙箱 | 开发阶段建议启用「沙箱模式」，可在测试群/频道中调试 |
| 5. 多机器人 | 每个机器人重复上述流程，将多个凭证填入 `accounts` 列表 |

权威说明以 [QQ 开放平台官方文档](https://bot.q.qq.com/wiki/develop/api/) 为准。

***

## Web 管理（推荐）

访问 `/core/QQbot-Core/` 进入 Web 管理页面，可视化管理 QQ 机器人。

### 快速开始

1. 启动 XRK-AGT 后，访问 `http://localhost:端口/core/QQbot-Core/`
2. 点击「点击获取」生成临时 Key
3. 查看后台日志，复制临时 Key
4. 输入临时 Key 登录
5. 点击右下角 **+** 按钮添加机器人
6. 填写 AppID 和 AppSecret，点击「添加并连接」

### 登录方式

| 方式 | 说明 |
|------|------|
| **临时 Key（推荐）** | 点击「点击获取」按钮，查看后台日志获取临时 Key，有效期 5 分钟 |
| 密码登录 | 在 `QQBot.json` 中配置 `adminPassword` |

***

## 配置文件方式

配置路径：`data/QQBot.json`

### 必填项

| 配置项 | 说明 |
|--------|------|
| `accounts[].appId` | QQ 开放平台应用的 AppID |
| `accounts[].clientSecret` | QQ 开放平台应用的 ClientSecret |
| `accounts[].enabled: true` | 否则 Tasker 不连接该账号 |

### 示例

```json
{
  "accounts": [
    {
      "name": "机器人名称",
      "appId": "你的AppID",
      "clientSecret": "你的ClientSecret",
      "enabled": true
    }
  ]
}
```

### 常用可选项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `bot.sandbox` | 沙箱模式 | `false` |
| `bot.maxRetry` | 连接失败最大重试次数 | `10` |
| `bot.timeout` | API 请求超时（毫秒） | `30000` |
| `toQRCode` | URL 自动转二维码 | `true` |
| `toCallback` | 启用按钮点击回调 | `true` |
| `toBotUpload` | 使用 Bot 上传资源 | `true` |
| `hideGuildRecall` | 撤回频道消息时隐藏 | `false` |
| `imageLength` | 图片压缩阈值（MB） | `3` |

> 若未配置账号或全部 `enabled: false`，日志出现 `QQBot 未启用，跳过` 属正常现象。

***

## 管理员权限配置

QQBot 的用户ID格式为 `{机器人AppID}:{用户OpenID}`，与普通QQ号不同。

### 获取用户ID

1. 让目标用户给机器人发送一条消息
2. 查看日志中的 `好友消息：[AppID:OpenID]` 或 `群消息：[群号, AppID:OpenID]`
3. 复制方括号内的完整ID

### 配置管理员

编辑 `data/server_bots/{端口}/chatbot.yaml`：

```yaml
master:
  qq:
    - "123456789:123456789ABCDEFGHIJKLMNOPQRSTUVW"
```

***

## 指令（仅管理员）

| 指令 | 说明 |
|------|------|
| `#QQBot账号` | 查看账号列表 |
| `#QQBot添加账号 AppID:ClientSecret` | 添加账号并连接 |
| `#QQBot删除账号 AppID` | 删除账号 |
| `#QQBot启用 AppID` | 启用账号 |
| `#QQBot禁用 AppID` | 禁用账号 |

***

## 事件

| 事件 | 含义 |
|------|------|
| `message.private.friend` | 好友私聊消息 |
| `message.private.callback` | 按钮点击回调（私聊） |
| `message.group.normal` | 群聊消息（@机器人） |
| `message.guild` | 频道消息 |
| `connect` | 机器人连接成功 |

所有场景统一使用 **`e.reply(...)`** 回复。

***

## 许可证

MIT License
