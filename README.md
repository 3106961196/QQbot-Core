<div align="center">

# 🤖 QQBot-Core

**XRK-AGT 的 QQ 官方机器人通道：基于 [qq-group-bot](https://github.com/Nicexw/qc-native-sdk) SDK，支持群消息、频道消息、私聊消息等多种消息类型的收发，事件与框架标准对齐，经 `e.reply` 进入插件。**

[![XRK-AGT](https://img.shields.io/badge/XRK--AGT-runtime-blue.svg)](https://github.com/sunflowermm/XRK-AGT)
[![QQ Open](https://img.shields.io/badge/QQ%20Open-open.qq.com-12B7F5.svg)](https://q.qq.com/)
[![SDK](https://img.shields.io/badge/SDK-qq--group--bot-333.svg)](https://www.npmjs.com/package/qq-group-bot)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

</div>

***

## QQ 开放平台：凭证从哪来

| 步骤        | 说明                                            |
| --------- | --------------------------------------------- |
| 1. 登录开放平台 | 访问 [QQ 开放平台](https://open.qq.com/) 并登录 QQ 账号。 |
| 2. 创建机器人  | 进入「机器人」→「创建机器人」，然后按需填写即可。                     |
| 3. 获取凭证   | 创建成功后，在开发管理页面获取 **AppID** 和 **ClientSecret**。 |
| 4. 配置沙箱   | 开发阶段建议启用「沙箱模式」，可在测试群/频道中调试机器人。                |
| 5. 多机器人   | 每个机器人重复上述流程，将多个凭证填入本端 `accounts` 列表。          |

权威说明以 [QQ 开放平台官方文档](https://bot.q.qq.com/wiki/develop/api/) 为准。

***

## Web 管理（推荐）

访问 `/core/QQbot-Core/` 进入 Web 管理页面，可视化管理 QQ 机器人，**比手动编辑配置文件更简单**。

### 功能概览

| 功能 | 说明 |
|------|------|
| 添加机器人 | 填写 AppID 和 AppSecret，一键添加并连接 |
| 账号管理 | 启用/禁用/删除机器人账号 |
| 连接控制 | 断开连接、重新连接、测试连接 |
| 主人管理 | 添加/移除机器人主人 |
| 参数配置 | 沙箱模式、超时时间、重试次数等 |

### 登录方式

| 方式 | 说明 |
|------|------|
| **临时 Key（推荐）** | 点击「点击获取」按钮，查看后台日志获取临时 Key，有效期 5 分钟 |
| 密码登录 | 在 `QQBot.json` 中配置 `adminPassword` |

### 快速开始

1. 启动 XRK-AGT 后，访问 `http://localhost:端口/core/QQbot-Core/`
2. 点击「点击获取」生成临时 Key
3. 查看后台日志，复制临时 Key
4. 输入临时 Key 登录
5. 点击右下角 **+** 按钮添加机器人
6. 填写 AppID 和 AppSecret，点击「添加并连接」

### 机器人设置

点击机器人卡片进入设置页面，可配置：

| 设置项 | 说明 |
|--------|------|
| 自动连接 | 框架启动时自动连接机器人 |
| 沙箱模式 | 是否启用沙箱环境（开发调试用） |
| 最大重试次数 | 连接失败时的重试次数 |
| API 请求超时 | 调用 QQ 官方 API 的超时时间（秒） |
| Markdown 支持 | 启用 Markdown 消息格式 |
| URL 转二维码 | 将 URL 自动转换为二维码图片 |
| 按钮回调模式 | 启用按钮点击回调功能 |
| Bot 上传资源 | 使用 Bot 上传图片和语音资源 |
| 隐藏频道撤回 | 撤回频道消息时是否隐藏 |
| 图片压缩阈值 | 超过此大小（MB）的图片将被压缩 |

***

## 配置文件方式

如果需要手动编辑配置文件，配置路径为 `data/QQBot.json`。

| 配置项                            | 说明                       |
| ------------------------------ | ------------------------ |
| **`accounts[].appId`**         | QQ 开放平台应用的 AppID。        |
| **`accounts[].clientSecret`**  | QQ 开放平台应用的 ClientSecret。 |
| **`accounts[].enabled: true`** | 否则 Tasker 不连接该账号。        |

### 账号配置示例

```json
{
  "accounts": [
    {
      "name": "机器人名称",
      "appId": "你的AppID",
      "clientSecret": "你的ClientSecret",
      "enabled": true,
      "markdownSupport": false
    }
  ]
}
```

### 常用可选项

| 配置项                 | 说明                          |
| ------------------- | --------------------------- |
| `bot.sandbox`       | 沙箱模式，开发调试时启用。               |
| `bot.maxRetry`      | 连接失败时的最大重试次数，默认 `10`。       |
| `bot.timeout`       | API 请求超时时间（毫秒），默认 `30000`。  |
| `toQRCode`          | 将 URL 自动转换为二维码图片，默认 `true`。 |
| `toCallback`        | 启用按钮点击回调功能，默认 `true`。       |
| `toBotUpload`       | 使用 Bot 上传图片和语音资源，默认 `true`。 |
| `hideGuildRecall`   | 撤回频道消息时是否隐藏，默认 `false`。     |
| `imageLength`       | 图片压缩阈值（MB），默认 `3`。          |
| `markdown.template` | Markdown 模板参数名数组。           |

### 启动日志说明

若 **未配置账号** 或 **所有账号** **`enabled: false`**，会出现 **`QQBot 未启用，跳过`**，表示本通道未连接 QQ 官方机器人，**不是错误**。需要使用时在 `data/QQBot.json` 中配置账号并设 **`enabled: true`**。

***

## ⚠️ 管理员权限配置

QQBot 的用户ID格式与普通QQ不同，配置管理员权限时需要注意：

### 用户ID格式说明

| 适配器类型             | user\_id 格式             | 示例                                           |
| ----------------- | ----------------------- | -------------------------------------------- |
| OneBot (普通QQ)     | 纯QQ号                    | `123456789`                                  |
| **QQBot (官方机器人)** | `{机器人AppID}:{用户OpenID}` | `123456789:123456789ABCDEFGHIJKLMNOPQRSTUVW` |

### 配置方法

**步骤一：查看日志获取完整ID（推荐）**

1. 给机器人发送任意消息
2. 查看日志，找到类似内容：
   ```
   好友消息：[123456789:123456789ABCDEFGHIJKLMNOPQRSTUVW] 你好
   ```
3. 复制方括号内的完整ID

**步骤二：修改配置文件**

编辑 `data/server_bots/{端口}/chatbot.yaml`：

```yaml
master:
  qq:
    # 格式: "{机器人AppID}:{用户OpenID}"
    - "123456789:123456789ABCDEFGHIJKLMNOPQRSTUVW"
```

> 💡 **提示**：`机器人AppID` 就是你的机器人appId，`用户OpenID` 是用户在QQ开放平台的唯一标识（不是QQ号）

### 如何获取用户OpenID？

1. 让目标用户给机器人发送一条消息
2. 在日志中查看 `好友消息：[xxx:OpenID]` 或 `群消息：[群号, xxx:OpenID]`
3. 冒号后面的部分就是OpenID

***

## 事件（与框架标准对齐）

| Bot 事件                     | 含义             |
| -------------------------- | -------------- |
| `message.private.friend`   | QQ 好友私聊消息。     |
| `message.private.callback` | 按钮点击回调事件（私聊）。  |
| `message.group.normal`     | QQ 群聊消息（@机器人）。 |
| `message.guild`            | 频道消息。          |
| `connect`                  | 机器人连接成功。       |

### 消息类型

| 消息类型                   | 说明          |
| ---------------------- | ----------- |
| `private` + `friend`   | 好友私聊        |
| `private` + `callback` | 频道私聊 / 按钮回调 |
| `group` + `normal`     | 群聊消息        |
| `guild`                | 频道消息        |

### 回复与应答

| 场景   | 用法                                        |
| ---- | ----------------------------------------- |
| 好友消息 | **`e.reply(...)`** → `sendPrivateMessage` |
| 群消息  | **`e.reply(...)`** → `sendGroupMessage`   |
| 频道私聊 | **`e.reply(...)`** → `sendDirectMessage`  |
| 频道消息 | **`e.reply(...)`** → `sendGuildMessage`   |

***

## 指令（仅管理员可用）

| 指令                              | 说明      |
| ------------------------------- | ------- |
| `#QQBot账号`                      | 查看账号列表  |
| `#QQBot添加账号 AppID:ClientSecret` | 添加账号并连接 |
| `#QQBot删除账号 AppID`              | 删除账号    |
| `#QQBot启用 AppID`                | 启用账号    |
| `#QQBot禁用 AppID`                | 禁用账号    |

***

## HTTP API

### 认证接口

| 接口                           | 方法   | 说明          |
| ---------------------------- | ---- | ----------- |
| `/api/qqbot/auth/temp-key`   | POST | 生成临时登录 Key  |
| `/api/qqbot/auth/temp-login` | POST | 使用临时 Key 登录 |
| `/api/qqbot/auth/login`      | POST | 密码登录        |
| `/api/qqbot/auth/logout`     | POST | 登出          |
| `/api/qqbot/auth/check`      | GET  | 检查登录状态      |

### 状态与配置

| 接口                  | 方法   | 说明      |
| ------------------- | ---- | ------- |
| `/api/qqbot/status` | GET  | 获取机器人状态 |
| `/api/qqbot/config` | GET  | 获取配置    |
| `/api/qqbot/config` | PUT  | 更新配置    |
| `/api/qqbot/reload` | POST | 重新加载配置  |

### 账号管理

| 接口                                  | 方法     | 说明     |
| ----------------------------------- | ------ | ------ |
| `/api/qqbot/accounts`               | POST   | 添加账号   |
| `/api/qqbot/accounts/:appId`        | DELETE | 删除账号   |
| `/api/qqbot/accounts/:appId/config` | GET    | 获取账号配置 |
| `/api/qqbot/accounts/:appId/config` | PUT    | 更新账号配置 |
| `/api/qqbot/test-connect`           | POST   | 测试连接   |
| `/api/qqbot/disconnect/:appId`      | POST   | 断开连接   |
| `/api/qqbot/reconnect/:appId`       | POST   | 重新连接   |

### 主人管理

| 接口                                 | 方法     | 说明     |
| ---------------------------------- | ------ | ------ |
| `/api/qqbot/master/:botId`         | GET    | 获取主人列表 |
| `/api/qqbot/master/:botId`         | POST   | 添加主人   |
| `/api/qqbot/master/:botId/:master` | DELETE | 移除主人   |

***

## 目录结构

```text
QQbot-Core/
├── README.md
├── index.js
├── package.json
├── LICENSE
├── commonconfig/
│   └── qqbot.js              # 配置定义与 Schema
├── events/
│   └── qqbot.js              # 事件监听器
├── http/
│   └── qqbot-api.js          # HTTP API 路由
├── plugin/
│   └── qqbot-adapter.js      # 指令适配器插件
├── tasker/
│   ├── QQBotTasker.js        # 核心 Tasker 实现
│   ├── message-builder.js    # 消息构建器
│   └── message-handler.js    # 消息处理器
└── www/                      # Web 管理界面
    ├── index.html
    ├── styles.css
    ├── app.js
    └── robots.txt
```

***

## 依赖

在**仓库根目录**执行 `pnpm install`（workspace 已包含本 Core 的依赖）。

### 核心依赖

| 依赖               | 说明           |
| ---------------- | ------------ |
| `qq-group-bot`   | QQ 官方机器人 SDK |
| `qrcode`         | URL 转二维码     |
| `image-size`     | 图片尺寸检测       |
| `silk-wasm`      | 语音 Silk 编码   |
| `url-regex-safe` | URL 正则匹配     |

### 可选依赖

| 依赖      | 说明                |
| ------- | ----------------- |
| `sharp` | 图片压缩（可选，未安装时跳过压缩） |

***

## 许可证

MIT License
