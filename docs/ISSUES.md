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
- **状态**：⬜ 待办

### R2（P0）SDK 断线重连分流不完整

- **现象**：`sessionManager.startListen` 的 `close` 分支中，`DISCONNECT` 用 `data.eventMsg` 覆盖 `sessionRecord`；resume 触发只检查 `WebsocketCloseReason.resume`（4008/4009）。**4006/4007 语义未正确分流**（4006 无效会话应重新 Identify，4007 seq 错误也应重 Identify，二者都不应 Resume）。
- **影响**：重连后在失效会话上反复 Resume，导致持续 4006/4007 抖动。
- **方案**：fork 或 `pnpm patch` SDK，修正分流；Tasker 侧按 close code 显式决定 Identify / Resume。
- **状态**：⬜ 待办

### R3（P0）启动失败无重试

- **现象**：`connect()` 中 `getAccessToken` / `getWsUrl` 失败 → `reject` → `setupBots` 捕获后仅记日志。`autoConnect` 账号启动失败后当天不再重试，需手动 reconnect。
- **影响**：临时网络故障 / 网关抖动导致机器人永久离线。
- **方案**：`connection-manager.js` 启动退避重试 5/10/30/60s。
- **状态**：⬜ 待办

---

## P1 消息与事件

### R4（P1）按钮回调双入口冲突

- **现象**：`makeNotice` 的 `sub_type === "action"` 走 `makeCallback`；`makeCallback` 的 `message_type: event.notice_type`。SDK `ActionNoticeEvent.notice_type` 为 `'friend'/'group'/'guild'`，与 `makeMessage` 的 `message_type='private'/'group'` 语义不一致，switch fallthrough 到 default 只打 warn。两套路径（makeMessage 内嵌 / makeCallback）逻辑重复且易错。
- **影响**：按钮点击事件可能被丢弃或双重处理。
- **方案**：合并为单一回调入口，统一 `message_type` 语义。
- **状态**：⬜ 待办

### R5（P1）notice 生命周期事件透传，语义未转换

- **现象**：`makeNotice` 对 `increase/decrease/update/member.*` 仅 `break` 空处理；未映射为 `group_increase` / `friend_add` 等 OneBot 风格结构化字段。
- **影响**：插件拿不到"加群/退群/加好友"结构化事件，生命周期功能无从下手。
- **方案**：notice 结构化映射表，补 `group_id/user_id` 语义字段。
- **状态**：⬜ 待办

### R6（P1）事件去重仅靠进程内 Set

- **现象**：Listener `markProcessed` 为进程内 Set（不跨重启）；无按 `message_id` 滑动窗口去重。SDK 推送偶发重复（DISPATCH 重放）。
- **影响**：同一消息被插件链处理多次。
- **方案**：`event-dedup.js` 滑动窗口（message_id，300s，跨账号分桶，定时清理）。
- **状态**：⬜ 待办

### R7（P1）`err.message` 裸取

- **现象**：message-handler `M27/M82/M113` 等 `err.message` 直取，Tasker `errMsg()` 自实现，未统一 `normalizeError`。
- **影响**：非 Error 抛错时日志失真。
- **方案**：统一 `normalizeError`。
- **状态**：⬜ 待办

---

## P2 扩展与管理

### R8（P2）`bot.request` 通用 API 入口未暴露

- **现象**：SDK `bot.js` 有 70+ API，但项目仅暴露消息收发/撤回；禁言/踢人/角色/置顶/反应等未封装。
- **影响**：扩张困难，被迫改 SDK 或加专用封装。
- **方案**：新增 `request.js`，`bot.request(method, path, payload)`，未覆盖能力显式抛 `NotImplemented`。
- **状态**：⬜ 待办

### R9（P2）配置热重载不完整

- **现象**：HTTP API 保存配置后仅 `tasker.loadConfig()`（重读内存）；已连接账号不增量同步（加账号→手动 connect；改 secret→不重连；删账号→不断开）。
- **影响**：管理台改完配置与实际连接状态脱节。
- **方案**：`syncBots()` 增量连接/断开/更新。
- **状态**：⬜ 待办

### R10（P2）SDK 吞异常

- **现象**：SDK `Bot` 构造里 `process.on('uncaughtException', e => this.logger.debug(e.stack))` 吞掉未捕获异常。
- **影响**：可能掩盖崩溃，难以排查。
- **方案**：fork 或 `pnpm patch` SDK，移除或转交日志。
- **状态**：⬜ 待办

### R11（P2）热路径动态 import

- **现象**：`message-builder.makeRecord` 动态 `await import("node:fs/promises")`（L57/L67）。
- **影响**：性能损耗小，但有规范统一空间。
- **方案**：静态 import。
- **状态**：⬜ 待办

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
- **关联**：R2 / R10 需要接触 SDK。
- **状态**：⬜ 待决策（正在了解 pnpm patch 细节）

### E4（P1）媒体资源上传（并入 makeBotImage / makeRecord 稳定性）

### E5（P2）Markdown 模板引擎（用户已决定暂缓，仅记录）

---