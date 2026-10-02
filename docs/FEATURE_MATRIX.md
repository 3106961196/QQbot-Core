# QQbot-Core 功能矩阵

> 对照 QQ 官方机器人文档（[bot.q.qq.com/wiki](https://bot.q.qq.com/wiki/develop/api-v2/)）整理的能力现状。
> **状态**：✅ 已实现 · 🟡 部分实现 · ⬜ 未实现 · 🚫 平台无权限
> **官方核实**：✅ 已逐页核实官方文档 · ⚠️ 官方文档未完全核实（不编造，按需自行确认）
> 对应问题与决策记录见 [ISSUES.md](./ISSUES.md)。

---

## 1. 连接与鉴权

| 能力 | 官方核实 | 状态 | 实现位置 | 说明 |
|---|---|---|---|---|
| Access Token 获取/续期 | ✅ | ✅ | vendor `sessionManager.js` | 启动挂起 + 过期前续期，失败退避 |
| WebSocket 接入 | ✅ | ✅ | vendor `sessionManager.js` | Gateway 地址与版本协商 |
| HELLO 动态心跳间隔 | ✅ | ✅ | vendor `sessionManager.js` | 采用平台下发的 `heartbeat_interval`，不硬编码 |
| op=7 重连 / op=9 校验域 | ✅ | ✅ | vendor `sessionManager.js` | |
| op=10 主动重连 / op=11 心跳回执 | ✅ | ✅ | vendor `sessionManager.js` | |
| 4006/4007/4009 → Resume 分流 | ✅ | ✅ | vendor `sessionManager.js` | **R2**：原版未分流，4008/4009 处理错误 |
| 4008 → 重新 Identify | ✅ | ✅ | vendor `sessionManager.js` | **R2** |
| INVALID_SESSION(4009 冲突) → 重连 | ✅ | ✅ | vendor `sessionManager.js` | |
| 启动失败退避 | — | ✅ | `connection-manager.js` | **R1**：失败按指数退避重试 |
| 断连自动重连 | — | ✅ | `connection-manager.js` | **R1** |
| 5s 内断连频繁限速 | — | ✅ | `connection-manager.js` | **R3**：滑动窗口内超过 N 次则延后重连 |
| Intent 位计算 | ✅ | ✅ | vendor `constans.js` | **E6/E8**：已核实并补齐官方 `1<<24`/`1<<25` 位 |

**当前订阅的 Intent（12 项）**，`identify` 计算值 `1325405187`：

```
GUILDS(1<<0) · GUILD_MEMBERS(1<<1) · GUILD_MESSAGE_REACTIONS(1<<10)
DIRECT_MESSAGE(1<<12) · GROUP_AT_MESSAGE_CREATE / GROUP_MESSAGE_CREATE /
C2C_MESSAGE_CREATE (1<<25, GROUP_AND_C2C_EVENT)
GROUP_MEMBER_ADD / GROUP_MEMBER_REMOVE / GROUP_JOIN_REQUEST (1<<24, GROUP_MEMBER_EVENT)
INTERACTION(1<<26) · MESSAGE_AUDIT(1<<27) · PUBLIC_GUILD_MESSAGES(1<<30)
```

> ⚠️ `MESSAGE_AUDIT` 已订阅 Intent 位，但 SDK 侧 `QQEvent` 枚举**缺该事件名**，收到审核结果会被兜底成 `system` 丢弃 —— 见 ISSUES 待查项。

---

## 2. 消息收发

| 能力 | 官方核实 | 状态 | 说明 |
|---|---|---|---|
| 单聊（C2C）发送 | ✅ | ✅ | |
| 群聊发送 | ✅ | ✅ | |
| 频道（Guild）发送 | ✅ | ✅ | `makeGuildMsg` |
| 回复 / 引用 `msg_id` | ✅ | ✅ | `e.reply` 保留原语义 |
| 撤回消息 | ✅ | ✅ | |
| `e.reply` 统一入口 | — | ✅ | **R4**：按钮回调与消息共用单一回复路径 |
| 主动消息限频 | — | 🟡 | **R8**：`bot.request` 入口已带滑动窗口限频（默认 5 次/秒）；无主动消息排队队列 |

---

## 3. 消息类型（`tasker/message-builder.js`）

| 类型 | 官方核实 | 状态 | 构造方法 | 说明 |
|---|---|---|---|---|
| 文本 | ✅ | ✅ | `makeMsg` | |
| 提及（@） | ✅ | ✅ | `makeMsg` | 群消息 @ 语义见 §5 |
| 表情 | ✅ | ✅ | `makeMsg` | |
| 按钮（InlineKeyboard） | ✅ | ✅ | `makeButton` / `makeButtons` | 普通/方块两版 |
| 图片 | ✅ | ✅ | `makeBotImage` / `compressImage` | 压缩 + `imageSize` 元数据 |
| Markdown（raw） | ✅ | 🟡 | `makeRawMarkdownMsg` / `makeRawMarkdownText` | `msg_type=2`，账号开关已桥接（E7） |
| Markdown（template） | ✅ | 🟡 | `makeMarkdownTemplate` / `makeMarkdownMsg` | 模板 ID 发送可用；**参数化渲染引擎暂缓**（E5，用户决策） |
| Ark 卡片 | ⚠️ | 🟡 | `makeMsg` | 需平台申请开通 |
| Embed | ⚠️ | 🟡 | `makeMsg` | 需平台申请开通 |
| 语音（Silk） | ⚠️ | 🟡 | `makeRecord` | `ffmpeg` + silk-wasm 转码；需平台申请 |
| 二维码 | ✅ | ✅ | `makeQRCode` | |
| 视频 / 文件 | ⚠️ | 🟡 | `makeMsg` | 需平台申请开通 |

> ⚠️ 标注项：Ark / Embed / 语音 / 视频 / 文件在官方文档中标注需申请开通，本仓只做透传，未做权限探测。

---

## 4. 事件接收

统一出口：`qqbot.message` / `qqbot.notice` / `qqbot.connect` / `qqbot.disconnect`（`events/qqbot.js`）。

| 官方事件 | Intent | 状态 | Core `notice_event` | 说明 |
|---|---|---|---|---|
| `GROUP_AT_MESSAGE_CREATE` | 1<<25 | ✅ | `message.group` | @ 群消息 |
| `GROUP_MESSAGE_CREATE` | 1<<25 | ✅ | `message.group` | **E6**：群内全量消息，需群主开启"接收所有消息" |
| `C2C_MESSAGE_CREATE` | 1<<25 | ✅ | `message.private.friend` | |
| `DIRECT_MESSAGE_CREATE` | 1<<12 | ✅ | `message.private.direct` | |
| `AT_MESSAGE_CREATE` / `MESSAGE_CREATE` | 1<<0 | ✅ | `message.guild` | 频道消息 |
| `INTERACTION_CREATE` | 1<<26 | ✅ | `notice`（`sub_type=action`） | 按钮回调，**R4** 归一为单一入口 |
| `GROUP_ADD_ROBOT` / `GROUP_DEL_ROBOT` | 1<<25 | ✅ | `group_increase` / `group_decrease` | |
| `GROUP_MSG_RECEIVE` / `GROUP_MSG_REJECT` | 1<<25 | ✅ | `group_receive` | 群主开关机器人主动消息 |
| `C2C_MSG_RECEIVE` / `C2C_MSG_REJECT` | 1<<25 | ✅ | `friend_receive` | |
| `FRIEND_ADD` / `FRIEND_DEL` | 1<<25 | ✅ | `friend_add` / `friend_del` | |
| **`GROUP_MEMBER_ADD`** | **1<<24** | ✅ | `group_member_increase` | **E8**：原 SDK 整条 Intent 缺失 |
| **`GROUP_MEMBER_REMOVE`** | **1<<24** | ✅ | `group_member_decrease` | **E8** |
| **`GROUP_JOIN_REQUEST`** | **1<<24** | ✅ | `group_join_request` | **E8**；⚠️ 官方限定**机器人须为群管理员**才推送 |
| 频道成员进出 | 1<<1 | ✅ | `group_member_increase`/`_decrease`/`_update` | 频道语义与群侧同名 |
| 频道 / 子频道增删改 | 1<<0 | ✅ | `channel_create`/`_update`/`_delete`/`_enter`/`_exit` | |
| `MESSAGE_AUDIT` | 1<<27 | ⬜ | — | Intent 已订阅但**缺事件名**，收到即被丢弃（待查） |
| 论坛 / 帖子事件 | 1<<18/1<<28 | 🟡 | 部分 | SDK 有解析器，`request.js` 显式拦截相关接口 |

**事件层公共保障**

| 能力 | 状态 | 说明 |
|---|---|---|
| 稳定 `event_id`（去重键） | ✅ | **R6**：`markProcessed` 可拦截 DISPATCH 重放 |
| `notice_id` 派生 | ✅ | **R12**：SDK 原版 notice 类不设 `notice_id`，致 R6 去重恒为 `undefined` —— 已按官方唯一字段组合补齐 |
| 秒级事件时间 `time` | ✅ | **R12**：SDK 侧各 notice 类口径已统一为秒并透出到 Core（此前 Core 层完全不透出） |
| 未知事件不静默丢弃 | ✅ | 落 `warn` 日志后仍 `emit`，插件可见 |
| `isQQBot` 标识 | ✅ | `plugin/qqbot-enhancer.js` |

---

## 5. 群消息 @ 语义（E6）

平台在"接收所有消息"开启后推 `GROUP_MESSAGE_CREATE`，此时事件名**不再区分是否 @ 机器人**：

| 来源 | `_isAtBot` | Core 行为 |
|---|---|---|
| `GROUP_AT_MESSAGE_CREATE` | 恒为 @ | 保留 at 段 |
| `GROUP_MESSAGE_CREATE` + `mentions` 含机器人 | true | 保留 at 段 |
| `GROUP_MESSAGE_CREATE` 无 mention | false | **不伪造 at 段** |

`group_openid`（官方 v2 字段）已作为 `group_id` 主来源，旧 `group_id` 仅作 fallback。

---

## 6. 通用 OpenAPI 入口（R8）

`e.bot.request(method, path, payload)` —— SDK 的 70+ HTTP API 均由此可达，**未做友好封装的能力不等于不可用**。

| 项 | 状态 | 说明 |
|---|---|---|
| 通用入口 | ✅ | 带鉴权与错误规范化的 axios 实例封装 |
| 滑动窗口限频 | ✅ | 默认每 key 5 次/秒，可配置；`null` 关闭 |
| 未开放能力保护 | ✅ | 抛 `NotImplementedError`，不静默失败 |
| 显式拦截路径 | 🚫 | `/audio`、`/threads`、`/schedules`、`/forum`（长尾 / 需白名单） |

---

## 7. 配置与管理台

| 能力 | 状态 | 说明 |
|---|---|---|
| 多账号管理 | ✅ | `syncBots()` 增量同步：新增 / 删除 / 禁用 / 凭证变更 |
| `markdownSupport` 开关桥接 | ✅ | **E7**：账号级开关派生 `config.markdown[appid]='raw'` |
| 配置热重载 | ✅ | `POST /api/qqbot/reload` → `loadConfig()` |
| 管理页 | ✅ | `/qqbot/` |
| 管理 API 鉴权 | ✅ | temp-key（同 IP 5 分钟 1 次、一次性消费）+ IP 绑定 session |

---

## 8. 已知待办

| 项 | 优先级 | 阻塞原因 |
|---|---|---|
| `MESSAGE_AUDIT` 事件落地 | P2 | 需先核实官方事件体字段（Intent 已订阅，缺事件名） |
| Markdown 模板参数化渲染引擎 | — | **E5：用户明确暂缓**（raw / template 发送路径均已可用） |
| E6 运行期验证 | P1 | 需群主开启"接收所有消息"后由真人发一条非 @ 群消息 |
| E8 运行期验证 | P1 | `GROUP_JOIN_REQUEST` 需机器人被设为群管理员 |
| 端到端（真实 Gateway）测试层 | P2 | 现有 72 项均为单元 / 接缝级 |