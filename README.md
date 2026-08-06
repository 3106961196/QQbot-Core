<div align="center">

# QQBot-Core

XRK-AGT 的 QQ 官方机器人通道（[qq-group-bot](https://www.npmjs.com/package/qq-group-bot)）。

</div>

***

## 拉取代码

在 XRK-AGT 的 `core` 目录下执行（任选其一；**GitHub 为主仓库**）：

```bash
# GitHub（主）
git clone --depth=1 https://github.com/3106961196/QQbot-Core.git

# Gitee
git clone --depth=1 https://gitee.com/duac/QQbot-Core.git

# GitCode
git clone --depth=1 https://gitcode.com/duac/QQbot-Core.git
```

| 平台 | 仓库地址 |
|------|----------|
| GitHub（主） | https://github.com/3106961196/QQbot-Core |
| Gitee | https://gitee.com/duac/QQbot-Core |
| GitCode | https://gitcode.com/duac/QQbot-Core |

```bash
cd QQbot-Core && pnpm install
# 管理台产物（首次或改前端后）
cd www/qqbot && pnpm install && pnpm build && cd ../..
```

需要 Node ≥ 26。可选依赖 `sharp`（图片压缩）。

***

## 快速开始

1. 开放平台拿 AppID / ClientSecret：[open.qq.com](https://open.qq.com/)
2. 启动主服后打开管理页（日志用 `getServerUrl()` 打印）：

   `{getServerUrl()}/qqbot/`  
   （调试直链：`/core/QQbot-Core/qqbot/`）

3. 「获取临时 Key」→ 看后台日志 → 登录 → 添加账号（先「校验凭证」再「保存并连接」；校验只换 AccessToken，不占网关登录）。同一 IP **5 分钟只能获取 1 次**临时 Key。

运行时文件：仓库根目录 **`data/QQBot.json`**（首次启动会从 `default/qqbot.json` 自动创建；不要只改模板）。

***

## 管理台（React）

- 源码：`www/qqbot/`（Vite + React + **Ant Design**，极简蓝色办公主题）
- 挂载：`sign.json` → 静态产物 `dist`，公开路径 **`/qqbot/`**
- 浏览器兼容：内联 `unwrapSuccess` / `abortTimeout`（勿引用 `/xrk`）
- 本地 HMR：将 `sign.json` 的 `enabled` 设为 `true` 且 `serve: "proxy"`，再 `pnpm dev`

能力：临时 Key / 密码登录、账号列表与连接控制、全局配置、单账号设置与主人增删。添加账号时「校验凭证」仅调用 `getAppAccessToken`，正式 WebSocket 登录只在保存时进行一次。API：`/api/qqbot/*`。

***

## 配置要点

| 项 | 说明 |
|----|------|
| `accounts[].appId` / `clientSecret` | 必填 |
| `accounts[].appId` | botId（固定）；昵称连接后写入 `nickname`，备注为 `remark` |
| `accounts[].enabled` | `false` 则不连 |
| `accounts[].autoConnect` / `markdownSupport` | 单账号 |
| `adminPassword` | Web 密码登录（可选；推荐临时 Key） |
| `bot.sandbox` / `maxRetry` / `timeout` | SDK 连接 |
| `toQRCode` / `toCallback` / `toBotUpload` / `imageLength` | 消息处理 |
| `markdown.<账号id>` | 模板 ID 或 `"raw"` |

主人写在 `data/server_bots/{端口}/chatbot.yaml` 的 `master.qq`，格式 `{账号id}:{OpenID}`。

Schema：`commonconfig/qqbot.js` · 模板：`default/qqbot.json`。

***

## 指令（主人）

`#QQBot账号` · `#QQBot添加账号 AppID:Secret` · `#QQBot删除账号` · `#QQBot启用/禁用`

***

## 架构

- Tasker 发 `qqbot.message` / `qqbot.notice` / `qqbot.connect` / `qqbot.disconnect`
- `events/qqbot.js` → 插件链；`plugin/qqbot-enhancer.js` 挂 `friend`/`group`/`isQQBot`
- WebHook：`/QQBot`；管理 API：`http/qqbot-api.js`
- 全局裸名 **`AgentRuntime`**，回复用 **`e.reply`**

***

MIT
