# QQbot-Core 问题清单

> 全部风险/问题登记于此，随重构推进逐项闭环（状态：⬜ 待办 / 🔧 进行中 / ✅ 已解决 / ⏸ 暂缓 / 🚫 搁置）。

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

- **状态**：✅ 已解决（随 R1/R3 落地：`tasker/connection-manager.js` 启动退避 5/10/30/60s、5s 内断连 ≥3 次强制 60s 限速、DEAD 自动重连 + 状态日志；测试 `test/connection-manager.test.js`）

### E2（P0）测试基线

- **现象**：package.json 无 test script，仓库无任何测试。
- **影响**：重构无回归保障。
- **方案**：`node:test` 建三层（单元 / 接缝 mock WS / e2e），先锁现状再改。
- **状态**：✅ 已解决（`package.json` 已有 `test` / `test:fast` script；6 个测试文件 57 用例全绿：connection-manager / session-manager / message-handler / sdk-event / sync-bots / request）

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

- **状态**：⏸ 暂缓（用户决定）。注：`msg_type=2` Markdown **发送链路本身已支持**（vendor SDK `entries/sender.js` 的 `markdown` 元素 + `message-builder` 的 `makeMarkdownMsg`/`makeRawMarkdownMsg` + handler `mdMode` 分支），且 E7 已把账号级开关桥接到该链路。暂缓的只是"模板参数化渲染引擎"（`markdown.template` 那套自定义模板 → custom_template_id 的进一步编排）。

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
- **运行时验证（2026-10-02）**：**待补**。bot 连接与解析链路正常（见下方「运行时验证记录」），但 `GROUP_MESSAGE_CREATE` 需在已开启"接收所有消息"的群里由真人发一条非 @ 消息才会推送，本轮未触发。

### E7（P1）账号级 `markdownSupport` 开关未桥接到消息构造链路

- **现象**：管理台账号配置有 `markdownSupport`（boolean 开关），但 `MessageHandler`/`MessageBuilder` 读的是 `config.markdown[appid]`（'raw' | 'template' 模板模式）。两者无桥接 → 管理台开了 Markdown 也不生效。
- **修复**：`QQBotTasker` 新增 `syncMarkdownConfig()`：账号级开启→派生 `config.markdown[appid]='raw'`（官方 markdown content 模式，SDK sender 已支持 msg_type=2），关闭→删除该键回落纯文本；保留 `markdown.template` 子配置。`loadConfig`/`persistAccountMeta` 两处赋值点调用。
- **状态**：✅ 已解决（`tasker/QQBotTasker.js`；测试 `test/sync-bots.test.js` 5 用例）
- **运行时验证（2026-10-02）**：✅ **已闭环**。输入端：`GET /api/qqbot/config` 返回 `accounts[0].markdownSupport = true`，`data/QQBot.json` 的 `markdown` 只有 `template` 子键、无 `1905680729` —— 正是 `syncMarkdownConfig` 要派生的场景。执行端：启动路径（bot 能 online 即证明 `loadConfig()` 未抛错）+ `POST /api/qqbot/reload` 返回 **200「配置已重新加载」**（36ms，期间零异常日志）——`loadConfig()` 会 reject 并返回 500 的路径未触发，故 `syncMarkdownConfig()` 在真实进程中执行成功。派生值本身为内存态（`GET config` 走 `config.read()` 原始文件，接口不暴露派生结果），属设计如此。

### E8（P0）群成员进出与入群申请事件缺失（官方能力扫描补全）

对照[官方群聊管理 → 事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_member_add.html)逐页核实，发现**官方 Intent `GROUP_MEMBER_EVENT (1<<24)` 在 SDK 里完全不存在**（`Intends` 枚举里没有 `16777216` 这个值），连带三类事件都无法订阅、收到也会被 `dispatchEvent` 兜底成 `"system"` 静默丢弃：

| 官方事件 | 官方 Intent | 修复前 | 修复后 |
| --- | --- | --- | --- |
| `GROUP_MEMBER_ADD`（群成员加入） | `GROUP_MEMBER_EVENT (1<<24)` | ❌ 无 intents 位、无事件名 | ✅ `notice.group.member.increase` |
| `GROUP_MEMBER_REMOVE`（群成员退出） | `GROUP_MEMBER_EVENT (1<<24)` | ❌ 同上 | ✅ `notice.group.member.decrease` |
| `GROUP_JOIN_REQUEST`（用户申请加群） | `GROUP_MEMBER_EVENT (1<<24)` | ❌ 同上 | ✅ `notice.group.join.request` |

- **顺带纠正一处历史误标**：SDK 原注释把 `1<<24` 写在 `GROUP_MESSAGE_CREATE` 名下并整行注释掉。官方逐页核实后确认 —— `1<<25` 是 `GROUP_AND_C2C_EVENT`（群消息，E6 已按此修正），`1<<24` 是 `GROUP_MEMBER_EVENT`（群成员/入群申请），两者是**不同的位**，不能互换。
- **修复**（vendor SDK + Core）：
  - `constans.js`：补 `Intends.GROUP_MEMBER_EVENT` 及三个事件名 → `16777216`（含与 `1<<25` 区别的注释）
  - `notice.js`：新增 `GroupMemberChangeNoticeEvent`（`group_id`/`user_id`=member_openid/`real_id`=user_openid，官方事件体无操作人故 `operator_id` 留空）与 `GroupJoinRequestNoticeEvent`（完整保留 `join_request_id`、`apply_source`、`verify_info`（含 `review_qa_list`）、`auto_approved.strategy_id` 等审批必需字段）
  - `event/index.js`：三个 `QQEvent` 枚举 + `EventParserMap` 注册
  - `QQBotTasker.js`：`INTENTS` 数组补三个事件名（同时修正上一轮遗留的 `1<<24` 旧注释）
  - `message-handler.js` `NOTICE_MAP`：补三条结构化映射；`group.join.request` 额外透出 `join_request_id`/`username`/`apply_source`/`verify_info`，使插件可直接对接审批接口
- **官方前置条件（已在文档记录）**：`GROUP_JOIN_REQUEST` **只有机器人是群管理员时才会推送**。
- **状态**：✅ 已解决（`src/vendor/qq-group-bot/lib/{constans,event/index,event/notice}.js` + `tasker/{QQBotTasker,message-handler}.js`；测试 `test/sdk-event.test.js` 7 用例 + `test/message-handler.test.js` 3 用例）

### R12（P1）SDK notice 事件缺 `notice_id` 且 `timestamp` 单位错误

- **现象**：`FriendChangeNoticeEvent` / `GroupChangeNoticeEvent` / `GroupReceiveNoticeEvent` **都不设 `notice_id`**，而 Core 侧 `makeNotice` 用 `event_id: event.notice_id || event.event_id` 供 R6 去重 → 实际恒为 `undefined`。现有 R6 测试用手工构造对象（自带 `notice_id: 'ntc-1'`）断言，恰好掩盖了真实解析路径上的这个洞。
- **同时发现**：三者都写 `this.time = Math.floor(payload.timestamp / 1000)`，但官方事件体 `timestamp` 是 **Unix 秒**（文档示例 `1784570534`），除 1000 后得到 `1784570`（约 1970 年）。`makeNotice` 未透出 `time`，故对现有行为无影响，属潜伏缺陷。
- **修复**：三个类补 `notice_id`（按官方唯一字段组合派生稳定键：`group_openid.op_member_openid.timestamp` / `openid.timestamp`），并把 `time` 改为不除 1000 的秒值；新增的 `GroupMemberChangeNoticeEvent` / `GroupJoinRequestNoticeEvent` 同样带正确 `notice_id` 与时间戳。
- **状态**：✅ 已解决（`src/vendor/qq-group-bot/lib/event/notice.js`；测试 `test/sdk-event.test.js` 2 用例，覆盖 notice_id 稳定性与秒级时间戳）

### 待查（不影响本轮交付）

- **`MESSAGE_AUDIT`（1<<27）**：Tasker 的 `INTENTS` **已订阅**，SDK 也有对应 Intent 位，但 `QQEvent` 枚举缺该事件名 → 收到审核结果会被兜底成 `"system"` 丢弃。属频道主动消息审核场景，需先核实官方事件体字段再补，故本轮未动。

---

## 运行时验证记录（2026-10-02，主服 pid 20468 / 2537 端口）

一次真实进程的连接期观察，用于佐证 P0-1 / P0-2 / E6 / E7 的运行时状态：

| 观测项 | 结果 |
| --- | --- |
| vendor SDK 版本串 | `qq-group-bot v1.1.0 (vendored, patched)` —— **补丁确实生效**（该字符串由 vendor 副本注入） |
| Gateway 握手 | `op:0 READY` → `连接成功` → `QQBot 哈基米 已连接`，一次成功，无重连风暴 |
| 心跳稳定性 | 34 次心跳，间隔 **41–48s**（官方要求 30–60s），**零失败、零重连** |
| 运行时长 | 12:25:35 → 12:50:09（约 25 分钟） |
| 错误日志 | **0 条 error**；5 条 warn 全部是本轮人工 API 探测造成（temp-key 一次性被消费后重试 + `unauthorized IP`） |
| 进程终止原因 | **外部终止**（无崩溃堆栈、`restart.log` 无异常重启记录），非自身崩溃 |

结论：P0-1（连接编排/退避/限速）与 P0-2（vendor SDK 心跳/重连/token 续期）在真实生产连接上健康。E6/E7 的运行期行为仍需一次真实群消息 + `reload` 分别补证。

### 复现要点（管理 API 鉴权）

- 端点前缀 `/api/qqbot/*`，全部经 `ensureAuthorized`；未带 session 时 `/status` 返回 **403**、`/accounts` 返回 **502**。
- `POST /api/qqbot/auth/temp-key` 取 key（**同一 IP 5 分钟冷却 1 次**），key 只写入主服日志（`logs/app.log` 中 `QQBot temp-key: <32位hex>`），1 天有效。
- `POST /api/qqbot/auth/temp-login` 换 session，**key 一次性**（`validateTempKey` 命中即 `delete`）。session cookie `qqbot_session` **绑定 IP**，跨进程复用易失败。
- 正确姿势：**在同一个脚本/连接内**依次完成"取 key → 从日志捞 key → temp-login → 调业务 API"，避免 IP 形式差异与 key 复用失败。

---