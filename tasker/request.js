/**
 * request.js
 * QQBot 通用 OpenAPI 请求入口（R8 落地）。
 *
 * 背景：SDK（qq-group-bot）的 `bot.request` 是带鉴权/错误规范化的 axios 实例，
 * SDK 内部 70+ API 全部基于它。本文件提供 Tasker 侧薄封装：
 *  - 统一入口 bot.request(method, path, payload, opts)
 *  - 按 (botId, apiKey) 滑动窗口限频（骨架：默认每 key 5 次/秒，可配置）
 *  - 未覆盖能力显式抛 NotImplemented（避免插件误用未实现的官方能力）
 *
 * 用法（插件侧）：
 *   e.bot.request('put', `/guilds/${guild_id}/members/${user_id}/mute`, { mute_seconds: 600 })
 *   e.bot.request('post', `/channels/${channel_id}/pins/${message_id}`)
 */

/** 官方能力路径 → 是否需要特别权限/未实现（P2 再开放） */
const NOT_IMPLEMENTED = [
  // 长尾/需白名单（官方文档标注），暂不开放
  '/audio',       // 音频控制
  '/threads',     // 帖子
  '/schedules',   // 日程
  '/forum',       // 论坛
]

/** 默认限频：每 key 每秒 5 次（主动消息官方频控较严，保守默认） */
const DEFAULT_RATE = { windowMs: 1000, max: 5 }

export class QQBotRequestError extends Error {
  constructor(message, { code = null, status = null, api = '' } = {}) {
    super(message)
    this.name = 'QQBotRequestError'
    this.code = code
    this.status = status
    this.api = api
  }
}

export class NotImplementedError extends Error {
  constructor(api) {
    super(`QQBot 能力 ${api} 尚未开放（见 docs/FEATURE_MATRIX.md 标注）`)
    this.name = 'NotImplementedError'
    this.api = api
  }
}

/**
 * 在 bot entry 上挂载 request 封装。
 * @param {object} bot   createBotEntry 生成的 bot 对象（含 sdk）
 * @param {object} [opts]
 * @param {object} [opts.rate]  限频配置 { windowMs, max }，null 关闭限频
 */
export function attachRequest(bot, opts = {}) {
  if (!bot?.sdk?.request) throw new TypeError('attachRequest: bot.sdk.request 缺失')
  const rate = opts.rate === null ? null : { ...DEFAULT_RATE, ...(opts.rate || {}) }
  const counters = new Map()  // key → { times: number[], blockedUntil }

  const hit = (key) => {
    if (!rate) return true
    const now = Date.now()
    const c = counters.get(key) || { times: [], blockedUntil: 0 }
    if (now < c.blockedUntil) return false
    c.times = c.times.filter(t => now - t < rate.windowMs)
    if (c.times.length >= rate.max) {
      c.blockedUntil = now + rate.windowMs
      counters.set(key, c)
      return false
    }
    c.times.push(now)
    counters.set(key, c)
    return true
  }

  bot.request = async (method, path, payload, reqOpts = {}) => {
    const api = `${String(method).toUpperCase()} ${path}`
    if (NOT_IMPLEMENTED.some(p => path.includes(p))) throw new NotImplementedError(api)

    const key = `${bot.uin || ''}|${api}`
    if (!hit(key)) {
      throw new QQBotRequestError(`请求过于频繁，已限频（${rate.windowMs / 1000}s 内最多 ${rate.max} 次）`, { api })
    }

    const axiosReq = {
      method,
      url: path,
      data: payload,
      ...reqOpts,
    }
    try {
      // sdk.request 是 axios 实例（callable）；用 .request() 最规范
      const res = await bot.sdk.request.request(axiosReq)
      return res?.data ?? res
    } catch (err) {
      // SDK 响应拦截器已把 axios 错误规范化为 Error(message: request "url" error with code: msg)
      throw new QQBotRequestError(err?.message || String(err), {
        status: err?.response?.status,
        api,
      })
    }
  }
  return bot
}
