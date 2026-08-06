import { unwrapSuccess, abortTimeout } from './compat.js'

const DEFAULT_TIMEOUT = 20000

async function request(path, options = {}) {
  const { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = options
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: abortTimeout(timeout),
  })
  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(res.ok ? '响应不是 JSON' : `HTTP ${res.status}`)
  }
  if (!res.ok && !json?.success) {
    const err = new Error(json?.message || `HTTP ${res.status}`)
    err.status = res.status
    err.code = json?.code
    const headerRetry = Number(res.headers.get('Retry-After'))
    err.retryAfter = Number(json?.retryAfter) || (Number.isFinite(headerRetry) ? headerRetry : 0)
    throw err
  }
  return unwrapSuccess(json)
}

export const api = {
  checkAuth: () => request('/api/qqbot/auth/check'),
  requestTempKey: () => request('/api/qqbot/auth/temp-key', { method: 'POST', body: {} }),
  tempLogin: (tempKey) => request('/api/qqbot/auth/temp-login', { method: 'POST', body: { tempKey } }),
  logout: () => request('/api/qqbot/auth/logout', { method: 'POST', body: {} }),

  status: () => request('/api/qqbot/status'),
  getConfig: () => request('/api/qqbot/config'),
  putConfig: (body) => request('/api/qqbot/config', { method: 'PUT', body }),

  addAccount: (body) => request('/api/qqbot/accounts', { method: 'POST', body }),
  removeAccount: (appId) =>
    request(`/api/qqbot/accounts/${encodeURIComponent(appId)}`, { method: 'DELETE' }),
  disconnect: (appId) =>
    request(`/api/qqbot/disconnect/${encodeURIComponent(appId)}`, { method: 'POST', body: {} }),
  reconnect: (appId) =>
    request(`/api/qqbot/reconnect/${encodeURIComponent(appId)}`, { method: 'POST', body: {} }),
  reload: () => request('/api/qqbot/reload', { method: 'POST', body: {} }),
  testConnect: (body) =>
    request('/api/qqbot/test-connect', { method: 'POST', body, timeout: 20000 }),

  getAccountConfig: (appId) =>
    request(`/api/qqbot/accounts/${encodeURIComponent(appId)}/config`),
  putAccountConfig: (appId, body) =>
    request(`/api/qqbot/accounts/${encodeURIComponent(appId)}/config`, { method: 'PUT', body }),

  listMasters: (botId) =>
    request(`/api/qqbot/master/${encodeURIComponent(botId)}`),
  addMaster: (botId, user_id) =>
    request(`/api/qqbot/master/${encodeURIComponent(botId)}`, {
      method: 'POST',
      body: { user_id },
    }),
  removeMaster: (botId, master) =>
    request(`/api/qqbot/master/${encodeURIComponent(botId)}/${encodeURIComponent(master)}`, {
      method: 'DELETE',
    }),
}
