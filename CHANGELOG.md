# 更新日志

本文件记录 QQbot-Core 的重要变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 重构期的详细问题与决策记录见 [docs/ISSUES.md](./docs/ISSUES.md)（R* = 缺陷修复，E* = 能力补全）。

---

## [未发布]

### 修复

- **R12 收尾**：notice 事件时间 `time` 此前在 Core 层完全不透出，插件拿不到事件时间基准 —— 现已透出（秒级，缺失时不写入该键）。
- **R12 补漏**：`FriendReceiveNoticeEvent` 的 `timestamp` 单位错算（官方 `C2C_MSG_RECEIVE` 为 Unix 秒，原实现除以 1000）已修正，并补 `notice_id`。
- **R12 补漏**：入群申请事件从官方 `apply_at`（RFC3339）归一为秒级 `time`，解析失败时不写入 `NaN`。

### 文档

- 重写 `docs/FEATURE_MATRIX.md`：此前大量条目仍把已完成的 R1–R11、E6/E7 标为待办，已按实际代码状态与官方文档逐页核实结果重建。

---

## [2026-10-02]

### 新增

- **E8 群成员进出与入群申请事件**（`5a0afc9`）
  对照官方文档逐页核实发现：官方 Intent `GROUP_MEMBER_EVENT (1<<24)` 在 vendor SDK 中**完全缺失**（`Intends` 枚举中无 `16777216`），三类事件既无法订阅、收到也会被 `dispatchEvent` 兜底成 `system` 静默丢弃。现已补齐：

  | 官方事件 | Core `notice_event` |
  |---|---|
  | `GROUP_MEMBER_ADD` | `group_member_increase` |
  | `GROUP_MEMBER_REMOVE` | `group_member_decrease` |
  | `GROUP_JOIN_REQUEST` | `group_join_request` |

  `group.join.request` 额外透出 `join_request_id` / `username` / `apply_source` / `verify_info`，使插件可直接对接审批接口。
  ⚠️ 官方限定：`GROUP_JOIN_REQUEST` 仅在机器人为**群管理员**时推送。

- **E6 群内全量消息**（`9cf5d05`）
  补齐 `GROUP_MESSAGE_CREATE`（官方 Intent `GROUP_AND_C2C_EVENT = 1<<25`，与 `GROUP_AT_MESSAGE_CREATE` / `C2C_MESSAGE_CREATE` 共用同一位）。
  平台在开启"接收所有消息"后不再用事件名区分是否 @ 机器人，改由 `mentions` 判定：
  非 @ 的群消息**不再伪造 at 段**。
  顺带修复 `group_openid` → `group_id` 字段读取（原读 `payload.group_id` 恒为 `undefined`）。

- **E7 `markdownSupport` 开关桥接**（`9cf5d05`）
  账号级开关此前与发送链路脱节（管理台开了不生效）。新增 `syncMarkdownConfig()`，在 `loadConfig` / `persistAccountMeta` 两处调用，账号开启即派生 `config.markdown[appid] = 'raw'`。

### 修复

- **R12 SDK notice 事件缺陷**（`5a0afc9`）
  - `Friend` / `Group` / `GroupReceive` 三类 notice 事件**从不设 `notice_id`**，致 Core 侧 R6 去重恒拿到 `undefined` 而失效。已按官方唯一字段组合派生稳定键。
  - 三者均写 `time = floor(timestamp / 1000)`，但官方 `timestamp` 是 **Unix 秒**（文档示例 `1784570534`），除 1000 后得到 `1784570`（约 1970 年）。

### 文档

- 补运行时验证记录（`2c1f8f8`）：真实进程一次连接期观察 —— 握手一次成功、34 次心跳间隔 41–48s（官方要求 30–60s）、零失败零重连、0 条 error。
- 补管理 API 鉴权复现要点（`2c1f8f8`）。

---

## [2026-09-30]

### 新增

- **P0-1 连接编排**（`5f0d721`）
  新增 `connection-manager.js`：启动失败退避、断连自动重连、5s 内断连频繁限速，并建立测试基线。

- **P0-2 vendor SDK 与协议缺陷修复**（`9ee259b`）
  SDK 改为仓内 vendor（`src/vendor/qq-group-bot`），修复三处协议缺陷：
  - **4008 / 4009 未分流** → 正确区分 Resume 与重新 Identify
  - **INVALID_SESSION** 未处理
  - **token 获取失败未挂起 / 未续期** → 启动挂起 + 过期前续期 + 失败退避

- **P0-3 通用 OpenAPI 入口**（`f8f887d`）
  `bot.request(method, path, payload)`：带滑动窗口限频（默认 5 次/秒）与 `NotImplementedError` 保护，SDK 内 70+ API 均由此可达。

- **P1 事件流水线修复**（`fc5dae7`）
  - **R4** 按钮回调归一为单一入口（friend / group / guild 三处统一语义）
  - **R5** notice 事件结构化映射并 `emit`（此前部分事件被静默丢弃）
  - **R6** 稳定 `event_id`，`markProcessed` 可拦截 DISPATCH 重放

- **P2 事件流水线收尾**（`42167b2`）：R7 / R9 / R10 / R11。

- **E4 媒体上传死代码清理**（`9a75ec0`）：移除不存在的 `uploadImage` / `uploadRecord` 死分支，保留 silk 转码与图片元数据逻辑。

### 修复

- `markAdapter` → `markTasker`，对齐底层 `ListenerBase` API（`63845cf`）。此前该调用不存在，实际抛错。

### 文档

- 建立 `docs/ISSUES.md` / `docs/ARCHITECTURE.md` / `docs/FEATURE_MATRIX.md` 三份文档体系。

---

## 说明

- 2026-08-08 及更早的提交为 XRK-AGT 主仓的自动同步提交（`Update: ...` 格式），不含独立变更说明，故未逐条列出。
- 本仓重构采用**小步本地提交**，每步可独立回滚。