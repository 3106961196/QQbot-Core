# QQbot-Core 问题清单

> 全部风险/问题登记于此，随重构推进逐项闭环（状态：⬜ 待办 / 🔧 进行中 / ✅ 已解决 / 🚫 搁置）。

## 说明

- 编号 R 开头为风险问题，E 开头为增强项。
- 每条问题记录：现象 / 影响 / 建议方案 / 状态。
- 与本仓库 `docs/*.md` 配套阅读：`ARCHITECTURE.md`（现状架构）、`FEATURE_MATRIX.md`（能力矩阵）。

---

## P0 连接稳定性

### R1（P0）连接稳定性：Tasker 对连接健康无感知

- **现象**：`SessionManager` 已覆盖 HELLO 心跳间隔、op=9 INVALID_SESSION、op=7 RECONNECT、4009 Resume、重试上限 `maxRetry`；但 Tasker 只在 `DEAD` 时 `cleanupBot`。`login()` 30s 超时 + READY/DEAD 竞态处理粗糙。
- **影响**：会话静默死亡、重连风暴无法察觉。
- **方案**：新增 `connection-manager.js`，Tasker 侧接管心跳监控/重连编排/退避限速日志；`QQBotTasker.connect` 改走 manager。
- **状态**：✅ 已解决（P0-1，`tasker/connection-manager.js`；启动退避 5/10/30/60s、5s 内断连≥3 次限速 60s、DEAD 自动重连；测试 `test/connection-manager.test.js`）

### R2（P0）SDK 断线重连与 token 续期缺陷（已核实代码，修正原报告描述）

- **现象**（以 `node_modules/qq-group-bot/lib/sessionManager.js` 为准）：
  1. `DISCONNECT` 分支 `this.isReconnect = data.code === 4009` —— **4008（发送过快频控）带 `resume: true` 却走 IDENTIFY**，未按官方语义 RESUME；
  2. `sessionRecord.seq` **未随 DISPATCH 更新**（L267 只 emit 不写 seq），RESUME 用旧 seq 可能连环 4007；
  3. `getAccessToken` 失败时 `new Promise` 只有 resolve 无 reject → **promise 永久挂起**：启动靠 login 30s 超时兜底，运行期 token 续期失败后静默死亡、无重试无告警，且失败重试 `getNext(0)` 无退避（紧循环打爆 auth 接口）。
- **原报告修正**："4006/4007 走错误 Resume" **不成立**（4006 不在关闭码表、4007 无 `resume` 标记，实际都走 IDENTIFY，正确）；4006 仅被记"未知错误"日志。
- **代码核实补充**：`DISPATCH` 分支实际**已更新 seq**（`this.sessionRecord.seq = this.heartbeatParam.d = s`），原"seq 未更新"不成立；真正缺失的是 **op=9 INVALID_SESSION 完全未处理**（会话失效后静默死亡）。
- **影响**：4008 频控后重连慢；token 刷新失败导致会话静默死亡。
- **方案**：vendor SDK 入仓（`src/vendor/qq-group-bot`），修三处：4008→RESUME、INVALID_SESSION→IDENTIFY 降级、token 获取失败退避重试。
- **状态**：✅ 已解决（P0-2，提交见 git log；接缝测试 `test/session-manager.test.js`）

### R3（P0）启动失败无重试

- **现象**：`connect()` 中 `getAccessToken` / `getWsUrl` 失败 → `reject` → `setupBots` 捕获后仅记日志。`autoConnect` 账号启动失败后当天不再重试，需手动 reconnect。
- **影响**：临时网络故障 / 网关抖动导致机器人永久离线。
- **方案**：`connection-manager.js` 启动退避重试 5/10/30/60s。
- **状态**：✅ 已解决（P0-1，并入 connection-manager 启动编排）

---

## P1 消息与事件

### R4（P1）按钮回调双入口冲突

- **现象**：`makeNotice` 的 `sub_type === "action"` 走 `makeCallback`；`makeCallback` 的 `message_type: event.notice_type`。SDK `ActionNoticeEvent.notice_type` 为 `'friend'/'group'/'guild'`，与 `makeMessage` 的 `message_type='private'/'group'` 语义不一致，switch fallthrough 到 default 只打 warn。两套路径（makeMessage 内嵌 / makeCallback）逻辑重复且易错。
- **影响**：按钮点击事件可能被丢弃或双重处理。
- **方案**：合并为单一回调入口，统一 `message_type` 语义。
- **状态**：✅ 已解决（P1，`tasker/message-handler.js`；构造期统一 notice_type→OneBot 语义（friend→private / guild→group），guild 回调补全 reply/setGroupMap 不再静默丢弃；测试 `test/message-handler.test.js`）

### R5（P1）notice 生命周期事件透传，语义未转换

- **现象**：`makeNotice` 对 `increase/decrease/update/member.*` 仅 `break` 空处理；未映射为 `group_increase` / `friend_add` 等 OneBot 风格结构化字段。
- **影响**：插件拿不到"加群/退群/加好友"结构化事件，生命周期功能无从下手。
- **方案**：notice 结构化映射表，补 `group_id/user_id` 语义字段。
- **状态**：✅ 已解决（P1，`tasker/message-handler.js`；新增 `NOTICE_MAP` 映射 friend/group/guild/channel 全生命周期事件为 OneBot 风格，`makeNotice` 统一 `AgentRuntime.em` 进插件链，group 系列 group_id 带 `<self_id>:` 前缀；测试 `test/message-handler.test.js`）

### R6（P1）事件去重仅靠进程内 Set

- **现象**：Listener `markProcessed` 为进程内 Set（不跨重启）；无按 `message_id` 滑动窗口去重。SDK 推送偶发重复（DISPATCH 重放）。
- **影响**：同一消息被插件链处理多次。
- **方案**：`event-dedup.js` 滑动窗口（message_id，300s，跨账号分桶，定时清理）。
- **状态**：✅ 已解决（P1，`tasker/message-handler.js`；根因是构造的 data 无 `event_id` 导致底层 `ensureEventId` 随机生成、`markProcessed` 永不去重。复用底层去重 Set：message/callback/notice 全补稳定 `event_id`（message_id / event_id / notice_id），重放第二次 `markProcessed=false`；未新造 event-dedup.js，复用 ListenerBase 已有上限清理且内存 Set≈滑动窗口，够用）

### R7（P1）`err.message` 裸取

- **现象**：message-handler `M27/M82/M113` 等 `err.message` 直取，Tasker `errMsg()` 自实现，未统一 `normalizeError`。
- **影响**：非 Error 抛错时日志失真。
- **方案**：统一 `normalizeError`。
- **状态**：✅ 已解决（P2，新增 `tasker/utils.js` 自包含 `normalizeError`（与主仓同实现）；message-handler / QQBotTasker / http qqbot-api 全部 `err.message` 直取点归一路。全仓零残留）

---

## P2 扩展与管理

### R8（P2）`bot.request` 通用 API 入口未暴露

- **现象**：SDK `bot.js` 有 70+ API，但项目仅暴露消息收发/撤回；禁言/踢人/角色/置顶/反应等未封装。
- **影响**：扩张困难，被迫改 SDK 或加专用封装。
- **方案**：新增 `request.js`，`bot.request(method, path, payload)`，未覆盖能力显式抛 `NotImplemented`。
- **状态**：✅ 已解决（P0-3，`tasker/request.js`；限频骨架 + NotImplemented 保护，插件用 `e.bot.request(...)`；测试 `test/request.test.js`）

### R9（P2）配置热重载不完整

- **现象**：HTTP API 保存配置后仅 `tasker.loadConfig()`（重读内存）；已连接账号不增量同步（加账号→手动 connect；改 secret→不重连；删账号→不断开）。
- **影响**：管理台改完配置与实际连接状态脱节。
- **方案**：`syncBots()` 增量连接/断开/更新。
- **状态**：✅ 已解决（P2，`tasker/QQBotTasker.js` 新增 `syncBots()` 三向 diff：删账号→disconnect / 新账号→connectionManager.start / secret 变更→断连重连；接入 PUT+POST `/api/qqbot/config` 与 `/api/qqbot/reload`；测试 `test/sync-bots.test.js` 7 用例）

### R10（P2）SDK 吞异常

- **现象**：SDK `Bot` 构造里 `process.on('uncaughtException', e => this.logger.debug(e.stack))` 吞掉未捕获异常。
- **影响**：可能掩盖崩溃，难以排查。
- **方案**：fork 或 `pnpm patch` SDK，移除或转交日志。
- **状态**：✅ 已解决（P2，vendor 修复 `src/vendor/qq-group-bot/lib/bot.js`：移除全局 `uncaughtException` 监听，交由宿主进程级处理；理由见代码注释）

### R11（P2）热路径动态 import

- **现象**：`message-builder.makeRecord` 动态 `await import("node:fs/promises")`（L57/L67）。
- **影响**：性能损耗小，但有规范统一空间。
- **方案**：静态 import。
- **状态**：✅ 已解决（P2，`tasker/message-builder.js`：`node:fs/promises` L57/L67 静态化；`silk-wasm`（正式依赖）一并静态化，`initSilkWasm` 保留缓存门面）

---

## 增强项

### E1（P1）启动失败重试 + 限速日志（并入 R1/R3 一起做）

### E2（P0）测试基线

- **现象**：package.json 无 test script，仓库无任何测试。
- **影响**：重构无回归保障。
- **方案**：`node:test` 建三层（单元 / 接缝 mock WS / e2e），先锁现状再改。
- **状态**：⬜ 待办

### E3（P1）SDK 打补丁方式决策

- **选项**：`pnpm patch` fork 入仓（可提交可回滚，推荐） vs 直接改 node_modules（简单但 pnpm install 后丢失）。
- **已决策**：**vendor 入仓**（`src/vendor/qq-group-bot`）。原因：本机 pnpm 未安装，`pnpm patch` 无法执行；vendor 副本可提交、可回滚、不随 install 丢失，运行时以相对路径 import（`QQBotTasker.js` L1），与根 workspace lockfile 无冲突（package.json 依赖声明保持 `qq-group-bot: 1.1.0` 不变）。
- **关联**：R2 / R10（R10 仍在待办：SDK `Bot` 构造 `process.on('uncaughtException')` 吞异常）。
- **状态**：✅ 已决策并落地（P0-2）

### E4（P1）媒体资源上传（并入 makeBotImage / makeRecord 稳定性）

- **现象**：`makeBotImage`/`makeRecord` 的 `toBotUpload` 分支调 `bot.sdk.uploadImage/uploadRecord`，但 vendor SDK 无此二方法（`qqBot.js` 仅有 `uploadMedia(target_id, target_type, ...)`），守卫恒 false → 死代码，媒体预上传静默失效。
- **修复**：移除死分支。SDK 发送层（`entries/sender.js` image/audio/video 元素）已自动 `uploadMedia` 且正确携带 target_id/target_type，无需预上传。`makeRecord` 保留 silk 转码（发送前格式归一，真实功能）；`makeBotImage` 改造为纯"fileToUrl + imageSize 尺寸标注"（markdown 图片元数据）。`toBotUpload` 配置项保留（管理台历史 UI），语义改为媒体一律走 SDK 发送层。
- **状态**：✅ 已解决（P1，`tasker/message-builder.js`）

### E5（P2）Markdown 模板引擎（用户已决定暂缓，仅记录）

### E6（P0）群内全量消息 `GROUP_MESSAGE_CREATE` 缺失（官方对比补全）

- **现象**：对照[官方群聊消息事件文档](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)，SDK 的 `QQEvent` 枚举只有 `GROUP_AT_MESSAGE_CREATE`（@ 消息），没有 `GROUP_MESSAGE_CREATE`（群内全量消息）。原 SDK `constans.js` 里该 intents 被注释且误标为 `1<<24`（官方实际为 GROUP_AND_C2C_EVENT `1<<25`，与 `GROUP_AT_MESSAGE_CREATE`/`C2C_MESSAGE_CREATE` 同一位）。收到全量消息时 `QQEvent[event]` 兜底成 `"system"` → 事件被静默丢弃。
- **影响**：群内非 @ 消息完全收不到；群主开启"接收所有消息"（`recv_msg_setting=all`）时能力缺失。
- **修复**（vendor SDK + Core）：
  - `constans.js`：恢复 `GROUP_MESSAGE_CREATE = 33554432`（官方 1<<25，带注释说明）
  - `event/index.js`：`QQEvent.GROUP_MESSAGE_CREATE = 'message.group'` + 注册 `MessageEvent.parse`
  - `qqBot.js` `dispatchEvent`：挂 `_raw_event`（原始 DISPATCH 事件名）+ 在 `mentions` 被 `Message.parse` 删除前挂 `_isAtBot`（全量模式下 @ 与非 @ 共用事件名，只能靠 mentions 判定）
  - `QQBotTasker.js`：INTENTS 数组补 `'GROUP_MESSAGE_CREATE'`
  - `message-handler.js` `makeGroupMessage`：被 @ 判定优先 `_isAtBot`，回落事件名；非 @ 群消息不再伪造 at 段
  - 顺带修复 `GroupMessageEvent.group_id` 取官方 `group_openid` 字段（原 SDK 读 `payload.group_id` 得 undefined，兼容旧字段）
- **状态**：✅ 已解决（`src/vendor/qq-group-bot/lib/{constans,event/index,event/message,qqBot}.js` + `tasker/{QQBotTasker,message-handler}.js`；测试 `test/sdk-event.test.js` 8 用例 + message-handler 3 用例）

### E7（P1）账号级 `markdownSupport` 开关未桥接到消息构造链路

- **现象**：管理台账号配置有 `markdownSupport`（boolean 开关），但 `MessageHandler`/`MessageBuilder` 读的是 `config.markdown[appid]`（'raw' | 'template' 模板模式）。两者无桥接 → 管理台开了 Markdown 也不生效。
- **修复**：`QQBotTasker` 新增 `syncMarkdownConfig()`：账号级开启→派生 `config.markdown[appid]='raw'`（官方 markdown content 模式，SDK sender 已支持 msg_type=2），关闭→删除该键回落纯文本；保留 `markdown.template` 子配置。`loadConfig`/`persistAccountMeta` 两处赋值点调用。
- **状态**：✅ 已解决（`tasker/QQBotTasker.js`；测试 `test/sync-bots.test.js` 5 用例）

---