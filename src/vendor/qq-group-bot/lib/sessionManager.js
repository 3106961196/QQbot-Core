"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = exports.MAX_RETRY = void 0;
const axios_1 = __importDefault(require("axios"));
const ws_1 = require("ws");
const utils_1 = require("./utils");
const events_1 = require("events");
const constans_1 = require("./constans");
exports.MAX_RETRY = 10;
class SessionManager extends events_1.EventEmitter {
    constructor(bot) {
        super();
        this.bot = bot;
        this.retry = 0;
        this.sessionRecord = {
            sessionID: "",
            seq: 0
        };
        this.heartbeatParam = {
            op: constans_1.OpCode.HEARTBEAT,
            d: null // 心跳唯一值
        };
        this.on(constans_1.SessionEvents.EVENT_WS, (data) => {
            switch (data.eventType) {
                case constans_1.SessionEvents.RECONNECT:
                    this.bot.logger.mark("[CLIENT] 等待断线重连中...");
                    break;
                case constans_1.SessionEvents.DISCONNECT:
                    if (this.userClose || [4914, 4915].includes(data.code))
                        return;
                    if (this.retry < (this.bot.config.maxRetry || exports.MAX_RETRY)) {
                        this.bot.logger.mark("[CLIENT] 重新连接中，尝试次数：", this.retry + 1);
                        // 4008（发送过快频控）/4009（连接过期）→ RESUME；其余（4006/4007 等）→ IDENTIFY
                        this.isReconnect = [4008, 4009].includes(data.code);
                        this.start();
                        this.retry += 1;
                    }
                    else {
                        this.bot.logger.mark("[CLIENT] 超过重试次数，连接终止");
                        this.emit(constans_1.SessionEvents.DEAD, {
                            eventType: constans_1.SessionEvents.ERROR,
                            msg: "连接已死亡，请检查网络或重启"
                        });
                    }
                    break;
                case constans_1.SessionEvents.READY:
                    this.bot.logger.mark("[CLIENT] 连接成功");
                    this.retry = 0;
                    break;
                default:
            }
        });
        this.on(constans_1.SessionEvents.ERROR, (code, message) => {
            this.bot.logger.error(`[CLIENT] 发生错误：${code} ${message}`);
        });
    }
    async getAccessToken() {
        let { secret, appid } = this.bot.config;
        const getToken = () => {
            return new Promise((resolve, reject) => {
                axios_1.default.post("https://bots.qq.com/app/getAppAccessToken", {
                    appId: appid,
                    clientSecret: secret
                }).then(res => {
                    if (res.status === 200 && res.data && typeof res.data === "object") {
                        resolve(res.data);
                    }
                    else {
                        reject(res);
                    }
                }).catch(reject);
            });
        };
        // 失败退避：1/2/4/8s 共 5 次，避免紧循环打爆 auth 接口；仍失败则抛错
        const retryGet = async (attempt) => {
            try {
                return await getToken();
            }
            catch (err) {
                if (attempt >= 5) throw err;
                const delay = Math.pow(2, attempt - 1) * 1000;
                this.bot.logger.error(`[CLIENT] 获取 access_token 失败(第${attempt}次)，${delay / 1000}s 后重试`, err?.message || err);
                await new Promise(r => setTimeout(r, delay));
                return retryGet(attempt + 1);
            }
        };
        // 获取 token 并按有效期调度续期；续期失败 → 日志 + 30s 低频重试（运行期多为网络抖动）
        const fetchAndSchedule = async () => {
            const token = await retryGet(1);
            this.bot.logger.debug("getAccessToken", token);
            this.access_token = token.access_token;
            const expiresMs = Math.max((token.expires_in - 1) * 1000, 1000);
            setTimeout(() => {
                fetchAndSchedule().catch(err => {
                    this.bot.logger.error("[CLIENT] access_token 续期失败，30s 后重试", err?.message || err);
                    setTimeout(() => fetchAndSchedule().catch(() => { }), 30000);
                });
            }, expiresMs);
            return token;
        };
        return fetchAndSchedule();
    }
    async getWsUrl() {
        return new Promise((resolve) => {
            this.bot.request.get("/gateway/bot", {
                headers: {
                    Accept: "*/*",
                    "Accept-Encoding": "utf-8",
                    "Accept-Language": "zh-CN,zh;q=0.8",
                    Connection: "keep-alive",
                    "User-Agent": "v1",
                    Authorization: ""
                }
            }).then(res => {
                if (!res.data)
                    throw new Error("获取ws连接信息异常");
                this.wsUrl = res.data.url;
                resolve();
            });
        });
    }
    getValidIntends() {
        return (this.bot.config.intents || []).reduce((result, item) => {
            const value = constans_1.Intends[item];
            if (value === undefined) {
                this.bot.logger.warn(`Invalid intends(${item}),skip...`);
                return result;
            }
            return constans_1.Intends[item] | result;
        }, 0);
    }
    async start() {
        if (!(await this.checkNeedToRestart())) {
            return;
        }
        this.userClose = false;
        this.connect();
        this.startListen();
    }
    async stop() {
        this.userClose = true;
        this.bot.ws?.close();
    }
    /* 校验是否需要重新创建 ws */
    async checkNeedToRestart() {
        const originWsUrl = this.wsUrl;
        const originAccessToken = this.access_token;
        await this.getAccessToken();
        await this.getWsUrl();
        // 此时不存在示例或是实例正在关闭
        if (!this.bot.ws || ![0, 1].includes(this.bot.ws.readyState)) {
            return true;
        }
        const checked = originWsUrl !== this.wsUrl || originAccessToken !== this.access_token;
        // 重启前先停止原来的实例
        if (checked) {
            await this.stop();
        }
        return checked;
    }
    connect() {
        this.bot.ws = new ws_1.WebSocket(this.wsUrl, {
            headers: {
                "Authorization": "QQBot " + this.access_token,
                "X-Union-Appid": this.bot.config.appid
            }
        });
    }
    reconnectWs() {
        const reconnectParam = {
            op: constans_1.OpCode.RESUME,
            d: {
                // token: `Bot ${this.bot.appId}${this.token}`,
                token: `QQBot ${this.access_token}`,
                session_id: this.sessionRecord.sessionID,
                seq: this.sessionRecord.seq
            }
        };
        this.sendWs(reconnectParam);
    }
    // 发送websocket
    sendWs(msg) {
        try {
            // 先将消息转为字符串
            this.bot.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
        }
        catch (e) {
            this.bot.logger.error(e);
        }
    }
    authWs() {
        // 鉴权参数
        const authOp = {
            op: constans_1.OpCode.IDENTIFY, // 鉴权参数
            d: {
                token: `QQBot ${this.access_token}`, // 根据配置转换token
                intents: this.getValidIntends(), // todo 接受的类型
                shard: [0, 1] // 分片信息,给一个默认值
            }
        };
        // 发送鉴权请求
        this.sendWs(authOp);
    }
    startListen() {
        this.bot.ws.on("close", (code) => {
            this.alive = false;
            this.emit(constans_1.SessionEvents.EVENT_WS, {
                eventType: constans_1.SessionEvents.DISCONNECT,
                code,
                eventMsg: this.sessionRecord
            });
            if (code) {
                for (const e of constans_1.WebsocketCloseReason) {
                    if (e.code === code) {
                        return this.emit(constans_1.SessionEvents.ERROR, code, e.reason);
                    }
                }
                return this.emit(constans_1.SessionEvents.ERROR, code, '未知错误');
            }
            this.bot.logger.error(`[CLIENT] 连接关闭`);
        });
        this.bot.ws.on("error", (e) => {
            this.alive = false;
            this.bot.logger.mark("[CLIENT] 连接错误");
            this.emit(constans_1.SessionEvents.CLOSED, { eventType: constans_1.SessionEvents.CLOSED });
        });
        this.bot.ws.on("message", (data) => {
            this.bot.logger.debug(`[CLIENT] 收到消息: ${data}`);
            // 先将消息解析
            const wsRes = (0, utils_1.toObject)(data);
            // 先判断websocket连接是否成功
            if (wsRes?.op === constans_1.OpCode.HELLO && wsRes?.d?.heartbeat_interval) {
                // websocket连接成功，拿到心跳周期
                this.heartbeatInterval = wsRes?.d?.heartbeat_interval;
                // 非断线重连时，需要鉴权
                this.isReconnect ? this.reconnectWs() : this.authWs();
                return;
            }
            // 鉴权通过
            if (wsRes.t === constans_1.SessionEvents.READY) {
                this.bot.logger.mark(`[CLIENT] 鉴权通过`);
                const { d, s } = wsRes;
                const { session_id, user = {} } = d;
                this.bot.self_id = user.id;
                this.bot.nickname = user.username;
                this.bot.status = user.status || 0;
                // 获取当前会话参数
                if (session_id && s) {
                    this.sessionRecord.sessionID = session_id;
                    this.sessionRecord.seq = s;
                    this.heartbeatParam.d = s;
                }
                this.bot.logger.info(`connect to ${user.username}(${user.id})`);
                this.isReconnect = false;
                this.emit(constans_1.SessionEvents.READY, { eventType: constans_1.SessionEvents.READY, msg: d || "" });
                // 第一次发送心跳
                this.bot.logger.debug(`[CLIENT] 发送第一次心跳`, this.heartbeatParam);
                this.sendWs(this.heartbeatParam);
                return;
            }
            // 会话失效（op=9 INVALID_SESSION）：d=true 表示可重连但需重新鉴权，不能继续 Resume
            if (wsRes.op === constans_1.OpCode.INVALID_SESSION) {
                this.bot.logger.mark("[CLIENT] 会话失效(op=9)，重新鉴权", wsRes.d);
                this.isReconnect = false;
                this.authWs();
                return;
            }
            // 心跳测试
            if (wsRes.op === constans_1.OpCode.HEARTBEAT_ACK || wsRes.t === constans_1.SessionEvents.RESUMED) {
                if (!this.alive) {
                    this.alive = true;
                    this.emit(constans_1.SessionEvents.EVENT_WS, { eventType: constans_1.SessionEvents.READY });
                }
                this.bot.logger.debug("[CLIENT] 心跳校验", this.heartbeatParam);
                setTimeout(() => {
                    this.sendWs(this.heartbeatParam);
                }, this.heartbeatInterval);
            }
            // 收到服务端重连的通知
            if (wsRes.op === constans_1.OpCode.RECONNECT) {
                // 通知会话，当前已断线
                this.emit(constans_1.SessionEvents.EVENT_WS, { eventType: constans_1.SessionEvents.RECONNECT });
            }
            // 服务端主动推送的消息
            if (wsRes.op === constans_1.OpCode.DISPATCH) {
                // 更新心跳唯一值
                const { s } = wsRes;
                if (s)
                    this.sessionRecord.seq = this.heartbeatParam.d = s;
                // OpenAPI事件分发
                this.bot.dispatchEvent(wsRes.t, wsRes);
            }
        });
    }
}
exports.SessionManager = SessionManager;
