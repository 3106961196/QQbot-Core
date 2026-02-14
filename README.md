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


### 账号配置

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

## 指令

| 指令 | 说明 |
|------|------|
| `#QQBot账号` | 查看账号列表 |
| `#QQBot添加账号 AppID:ClientSecret` | 添加账号并连接 |
| `#QQBot删除账号 AppID` | 删除账号 |
| `#QQBot启用 AppID` | 启用账号 |
| `#QQBot禁用 AppID` | 禁用账号 |

## Web管理

访问 `/core/QQbot-Core/` 进入Web管理页面。

首次使用需输入API Key（XRK-AGT启动时生成）。

## HTTP API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/qqbot/status` | GET | 获取状态 |
| `/api/qqbot/config` | GET | 获取配置 |
| `/api/qqbot/accounts` | POST | 添加账号 |
| `/api/qqbot/accounts/:appId` | DELETE | 删除账号 |
| `/api/qqbot/test-connect` | POST | 测试连接 |
| `/api/qqbot/disconnect/:appId` | POST | 断开连接 |

## 项目结构

```
QQbot-Core/
├── index.js              # 入口文件
├── package.json          # 项目配置
├── commonconfig/
│   └── qqbot.js          # 配置定义
├── events/
│   └── qqbot.js          # 事件监听
├── http/
│   └── qqbot-api.js      # HTTP API
├── plugin/
│   └── qqbot-adapter.js  # 指令适配器
├── tasker/
│   └── QQBotTasker.js    # 核心任务器
└── www/                  # Web管理界面
    ├── index.html
    ├── styles.css
    └── app.js
```

## 许可证

MIT License
