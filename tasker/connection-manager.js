/**
 * connection-manager.js
 * QQBot 连接编排：启动退避重试、断连督办、限速、状态日志。
 *
 * 边界：
 *  - 不接管 SDK 内部 WS/心跳/op 级重连（sessionManager 职责）
 *  - 只做 Tasker 侧编排：何时重试、多久重试、断连后是否督办、如何限速
 *
 * 退避策略（对齐任务书）：
 *  - 启动失败：5 / 10 / 30 / 60 秒指数退避
 *  - 5 秒内断连 ≥3 次：强制 60 秒限速
 *  - 所有重试可被 stop() 终止
 */
export class ConnectionManager {
  /**
   * @param {object} options
   * @param {Function} options.connectFn  (account) => Promise<boolean>  发起连接
   * @param {Function} options.onStatus   (state, detail) => void       状态回调（日志/事件）
   * @param {object}   [options.retries]  退避配置
   */
  constructor({ connectFn, onStatus, retries = {} }) {
    if (typeof connectFn !== 'function') throw new TypeError('ConnectionManager: connectFn 必填')
    this.connectFn = connectFn
    this.onStatus = onStatus || (() => {})
    this.backoff = [5, 10, 30, 60]        // 启动失败退避（秒）
    if (Array.isArray(retries.backoff)) this.backoff = retries.backoff
    this.maxRetries = retries.maxRetries ?? this.backoff.length  // 依次走完 backoff 后停在最后一档
    this.rateLimitWindowMs = retries.rateLimitWindowMs ?? 5000    // 断连统计窗口
    this.rateLimitThreshold = retries.rateLimitThreshold ?? 3     // 窗口内断连次数阈值
    this.rateLimitCooldownMs = retries.rateLimitCooldownMs ?? 60000

    /** @type {Map<string, {timer, attempt, lastDisconnects:number[], stop:boolean, account:object}>} */
    this._state = new Map()
    this._stopped = false
  }

  /**
   * 纳入编排但不触发连接。
   * 用于「手动 connect 成功后」登记该账号，使其后续 DEAD 断连仍受自动重连保护。
   */
  adopt(account) {
    const key = this._keyOf(account)
    if (!key || this._state.has(key)) return
    this._state.set(key, { attempt: 0, lastDisconnects: [], stop: false, timer: null, account })
  }

  /** 启动一个账号的连接编排（幂等：已存在则忽略） */
  start(account) {
    const key = this._keyOf(account)
    if (!key) return
    if (this._state.has(key)) return
    const st = { attempt: 0, lastDisconnects: [], stop: false, timer: null, account }
    this._state.set(key, st)
    this._run(key, st, account)
  }

  /** 停止一个账号的编排（不再重试） */
  stop(key) {
    const st = this._state.get(String(key))
    if (!st) return
    st.stop = true
    if (st.timer) clearTimeout(st.timer)
    this._state.delete(String(key))
  }

  /** 停止全部编排 */
  stopAll() {
    this._stopped = true
    for (const key of [...this._state.keys()]) this.stop(key)
  }

  /** 上报断连（供 DEAD / disconnect 事件调用，驱动限速统计与重连） */
  reportDisconnect(key, reason) {
    const st = this._state.get(String(key))
    if (!st) return
    const now = Date.now()
    st.lastDisconnects = st.lastDisconnects.filter(t => now - t < this.rateLimitWindowMs)
    st.lastDisconnects.push(now)
    if (st.lastDisconnects.length >= this.rateLimitThreshold) {
      this.onStatus('rate-limited', { key: String(key), cooldownMs: this.rateLimitCooldownMs, reason })
      return this._schedule(key, st, st.account, this.rateLimitCooldownMs / 1000)
    }
    // 未达阈值：立即重连（极小延迟防紧循环）
    this.onStatus('reconnecting', { key: String(key), reason })
    this._schedule(key, st, st.account, 0.05)
  }

  /** 是否正在编排某账号 */
  has(key) {
    return this._state.has(String(key))
  }

  _keyOf(account) {
    return String(account?.appId || account?.id || '')
  }

  async _run(key, st, account) {
    if (st.stop || this._stopped) return
    try {
      const ok = await this.connectFn(account)
      if (ok) {
        st.attempt = 0
        this.onStatus('connected', { key })
      } else {
        this._retry(key, st, account, '连接返回失败')
      }
    } catch (err) {
      this._retry(key, st, account, err?.message || String(err))
    }
  }

  _retry(key, st, account, reason) {
    if (st.stop || this._stopped) return
    st.attempt += 1
    if (st.attempt > this.maxRetries) {
      this.onStatus('give-up', { key, attempt: st.attempt, reason })
      return
    }
    const idx = Math.min(st.attempt - 1, this.backoff.length - 1)
    const delay = this.backoff[idx]
    this.onStatus('retrying', { key, attempt: st.attempt, delay, reason })
    this._schedule(key, st, account, delay)
  }

  _schedule(key, st, account, delaySeconds) {
    if (st.timer) clearTimeout(st.timer)
    st.timer = setTimeout(() => {
      st.timer = null
      this._run(key, st, account)
    }, delaySeconds * 1000)
    if (st.timer.unref) st.timer.unref()
  }
}
