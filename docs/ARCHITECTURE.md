# QQbot-Core 架构文档

> XRK-AGT 的 QQ 官方机器人适配器。本文件记录现状架构与演进方向。

## 定位

QQbot-Core **不是**通用 QQ SDK，而是 XRK-AGT 框架下的一个通道 tasker：

- 连接：基于第三方 SDK `qq-group-bot` v1.1.0（WebSocket 网关 + OpenAPI）
- 契约：作为 `AgentRuntime.tasker` 注册，发出 `qqbot.*` 事件，经 Listener/Enhancer/Plugin 链消费
- 消费侧：插件照常使用 `e.reply` / `friend` / `group` / `isQQBot` 等既有语义

## 目录结构

```
core/QQbot-Core/
├── index.js                  # 入口：初始化配置实例（写盘默认模板）
├── tasker/
│   ├── QQBotTasker.js        # Tasker 主体：连接/生命周期/WebHook/清理
│   ├── message-handler.js    # 事件转换（SDK 事件 → XRK 事件）+ 发送/撤回/实体 pick
│   └── message-builder.js    # 消息构建（文本/图片/Markdown/按钮/语音/二维码等）
├── events/qqbot.js           # Listener：qqbot.* → 插件链（markProcessed）
├── plugin/
│   ├── qqbot-enhancer.js     # Enhancer：isQQBot/isPrivate/isGroup/实体绑定
│   └── qqbot-adapter.js      # Plugin：#QQBot* 管理指令
├── http/qqbot-api.js         # 管理 API（/api/qqbot/*，临时Key+会话鉴权）
├── commonconfig/qqbot.js     # ConfigBase：data/QQBot.json 配置管理
├── default/qqbot.json        # 默认配置模板
├── www/qqbot/                # React 管理台（Vite+AntD，产物挂 /qqbot/）
└── docs/                     # 本仓库文档（架构/功能矩阵/问题清单）
```

## 事件流（现状）

```
QQ 服务器 ─WS→ SDK sessionManager → QQBot.dispatchEvent
  → processPayload（QQEvent 映射 + MessageEvent.parse）
  → sdk.emit('message'/'notice')
  → messageHandler.makeMessage / makeNotice
  → AgentRuntime.em('qqbot.message'/'qqbot.notice'/'qqbot.connect'/'qqbot.disconnect', e)
  → events/qqbot.js Listener（ensureEventId → markProcessed → markAdapter）
  → plugin/qqbot-enhancer.js（isQQBot/isPrivate/isGroup/bindBotEntities）
  → plugins.deal(e) → 插件业务 → e.reply 回发
```

## bot 实例形态（AgentRuntime[botId]）

`createBotEntry` 创建并挂载到 `AgentRuntime[botId]`：

```
{
  tasker, sdk, loginError,
  login(), logout(),
  uin: id, info: { id, appId, avatar, ... }, nickname, avatar,
  version, stat,
  pickFriend / pickUser / pickMember / pickGroup,
  fl (好友 Map), gl (群 Map), gml (群成员 Map), callback,
}
```

- `pickGroup` / `pickMember` 返回带 `sendMsg` / `recallMsg` / `pickMember` / `getMemberMap` 的实体对象
- `e.reply` 由 makeMessage 各入口闭包绑定（friend/group/direct/guild 各自 send 函数）

## 连接与生命周期

- `QQBotTasker.load()` → `scheduleBotConnection()`：等 `AgentRuntime.online` 或 30s 超时后 `setupBots()`
- `connect(account)`：创建 SDK → `login()`（30s 超时 + READY/DEAD）→ `getSelfInfo()` 回写 nickname → 挂 `message`/`notice` 监听 → 注册 `bots` / `AgentRuntime[botId]` / `appid` → 发 `qqbot.connect`
- `wireDeadHandler`：SDK `DEAD` → `cleanupBot` → 发 `qqbot.disconnect`
- `makeWebHook`：`/QQBot` 端点，验证 `X-Bot-Appid`，tweetnacl 签名校验，转 `sdk.dispatchEvent`

## SDK 事件映射（qq-group-bot）

`QQEvent` 将原始事件名映射为 OneBot 风格三段式：

| 原始事件 | 映射 |
|---|---|
| DIRECT_MESSAGE_CREATE | message.private.direct |
| AT_MESSAGE_CREATE / MESSAGE_CREATE | message.guild |
| C2C_MESSAGE_CREATE | message.private.friend |
| GROUP_AT_MESSAGE_CREATE | message.group |
| GUILD_CREATE/DELETE/UPDATE | notice.guild.increase/decrease/update |
| GROUP_ADD_ROBOT / GROUP_DEL_ROBOT | notice.group.increase / decrease |
| FRIEND_ADD / FRIEND_DEL | notice.friend.increase / decrease |
| GUILD_MEMBER_ADD/REMOVE | notice.guild.member.increase/decrease |
| INTERACTION_CREATE | notice（按钮回调） |
| FORUM_* / OPEN_FORUM_* | notice.forum.* |

## 配置

- 文件：`data/QQBot.json`（首次由 `default/qqbot.json` 自动创建，`index.js` / `QQBotConfig.read` 双重保障）
- 结构：
  - `accounts[]`：appId / clientSecret / nickname / remark / enabled / markdownSupport / autoConnect
  - `bot`：sandbox / maxRetry / timeout
  - `toQRCode` / `toCallback` / `toBotUpload` / `hideGuildRecall` / `imageLength` / `defaultMarkdownSupport`
  - `markdown`：template 参数名数组 / 账号级模板 ID

## 管理 API（/api/qqbot/*）

| 端点 | 说明 |
|---|---|
| POST /auth/temp-key | 获取临时 Key（IP 5min 限 1 次，1d 有效） |
| POST /auth/temp-login | 用 Key 换会话 Cookie |
| POST /auth/logout · GET /auth/check | 登出 / 校验会话 |
| GET /status | 账号在线状态 |
| GET/PUT/POST /config | 全局配置读写 |
| POST /test-connect | 校验凭证（不走网关登录） |
| POST /accounts · DELETE /accounts/:appId | 增删账号（增时校验+连接） |
| POST /disconnect/:appId · /reconnect/:appId | 断开/重连 |
| POST /reload | 重读配置 |
| POST/GET/DELETE /master/:botId | 主人管理 |
| GET/PUT /accounts/:appId/config | 单账号配置 |

## 演进方向

见 `ISSUES.md` 问题清单与 `FEATURE_MATRIX.md` 能力矩阵。目标分层：

```
transport/   → 连接/心跳/重连/退避（connection-manager.js，P0）
protocol/    → SDK 封装 / bot.request 通用入口（P0/P2）
adapter/     → 事件转换（message-handler，P1 notice 结构化）
plugins/     → 生命周期欢迎语/退群清理等（P2，不做进核心）
```