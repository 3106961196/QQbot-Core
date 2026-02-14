# QQBot-Core

QQ官方机器人适配器，基于 XRK-AGT 框架制作。

## 项目简介

QQBot-Core 是一个用于连接 QQ 官方机器人的核心适配器模块，基于 `qq-group-bot` SDK 开发，支持群消息、频道消息、私聊消息等多种消息类型的收发。

## 安装步骤

### 1. 环境要求

- Node.js >= 16.x
- pnpm 包管理器
- XRK-AGT 框架环境

### 2. 克隆项目

在 `XRK-AGT/core/` 目录下克隆项目：

```bash
git clone https://github.com/3106961196/QQbot-Core.git
```

### 3. 安装依赖

切换到项目目录并安装依赖：

```bash
cd QQbot-Core
pnpm i
```


## 配置说明

首次加载时会在 `data/QQBot.json` 自动生成默认配置文件。

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| toQRCode | boolean | true | 将URL转换为二维码图片 |
| toCallback | boolean | true | 启用按钮点击回调功能 |
| toBotUpload | boolean | true | 使用Bot上传图片/语音资源 |
| hideGuildRecall | boolean | false | 撤回频道消息时是否隐藏 |
| imageLength | number | 0 | 图片压缩阈值(MB)，0表示关闭压缩 |
| markdown.template | string | abcdefghij | Markdown模板ID占位符序列 |
| bot.sandbox | boolean | false | 是否启用沙箱环境 |
| bot.maxRetry | number | 10 | 连接失败时的最大重试次数 |
| bot.timeout | number | 30000 | 请求超时时间(毫秒) |
| token | array | [] | 机器人Token列表 |

### Token 格式

```
id:appid:token:secret:群消息:频道消息
```

| 字段 | 说明 |
|------|------|
| id | 机器人QQ号 |
| appid | 应用ID |
| token | 机器人Token |
| secret | 机器人Secret |
| 群消息 | 0=关闭, 1=开启, 2=仅API模式 |
| 频道消息 | 0=公开频道消息, 1=全部频道消息 |

### 配置示例

```json
{
  "toQRCode": true,
  "toCallback": true,
  "toBotUpload": true,
  "hideGuildRecall": false,
  "imageLength": 0,
  "markdown": {
    "template": "abcdefghij"
  },
  "bot": {
    "sandbox": false,
    "maxRetry": 10,
    "timeout": 30000
  },
  "token": [
    "123456789:1234567890:your_token:your_secret:1:1"
  ]
}
```

## 指令列表

以下指令仅限主人(Master)权限使用：

### 账号管理

| 指令 | 说明 | 示例 |
|------|------|------|
| `#QQBot账号` | 查看已配置的QQBot账号列表 | `#QQBot账号` |
| `#QQBot设置<token>` | 添加/更新QQBot账号 | `#QQBot设置123456789:appid:token:secret:1:1` |
| `#QQBot删除<id>` | 删除指定QQBot账号 | `#QQBot删除123456789` |


## HTTP API 接口

### 获取状态

```http
GET /api/qqbot/status
```

**响应示例：**
```json
{
  "code": 0,
  "data": {
    "loaded": true,
    "version": "qq-group-bot v1.1.0",
    "bots": [
      {
        "id": "123456789",
        "nickname": "机器人昵称",
        "avatar": "https://q.qlogo.cn/g?b=qq&s=0&nk=123456789",
        "status": "online",
        "startTime": 1707849600,
        "messageCount": 0
      }
    ],
    "botCount": 1
  }
}
```

## 功能特性

### 消息类型支持

- 文本消息
- 图片消息（支持压缩、上传）
- 语音消息（自动转码为Silk格式）
- 视频消息
- Markdown消息
- 按钮消息（支持回调）
- Ark消息
- Embed消息

### 消息场景支持

- 群聊消息 (`message.group.normal`)
- 好友私聊 (`message.private.friend`)
- 频道私聊 (`message.private.callback`)
- 频道消息 (`message.guild`)

### 高级功能

- **URL转二维码**：自动将消息中的URL转换为二维码图片
- **图片压缩**：超过阈值自动压缩图片
- **Markdown模板**：支持自定义Markdown模板发送富文本消息
- **按钮回调**：支持交互式按钮点击事件处理
- **WebHook签名**：支持QQ官方WebHook签名验证

## 项目结构

```
QQbot-Core/
├── index.js              # 入口文件
├── package.json          # 项目配置
├── commonconfig/
│   └── qqbot.js          # 配置管理
├── events/
│   └── qqbot.js          # 事件监听
├── http/
│   └── qqbot-api.js      # HTTP API
├── plugin/
│   └── qqbot-adapter.js  # 指令适配器
└── tasker/
    └── QQBotTasker.js    # 核心任务器
```

## 开发说明

### 事件处理

事件监听器继承自 `EventListenerBase`，处理以下事件：

- `message.private.friend` - 好友私聊
- `message.private.callback` - 频道私聊回调
- `message.group.normal` - 群消息
- `message.guild` - 频道消息
- `connect` - 连接事件

### 发送消息

```javascript
// 发送群消息
Bot[id].pickGroup(group_id).sendMsg('消息内容')

// 发送私聊消息
Bot[id].pickFriend(user_id).sendMsg('消息内容')

// 发送频道消息
Bot[id].pickGuild(guild_id).sendMsg('消息内容')
```

### 消息格式

```javascript
// 文本
{ type: 'text', text: '文本内容' }

// 图片
{ type: 'image', file: '图片路径或base64' }

// @某人
{ type: 'at', qq: '用户ID' }

// 回复
{ type: 'reply', id: '消息ID' }

// 按钮
{ type: 'button', data: [[{ text: '按钮文字', callback: '回调内容' }]] }

// Markdown
{ type: 'markdown', data: 'Markdown内容' }
```

## 许可证

MIT License

