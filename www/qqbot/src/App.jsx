import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App as AntApp,
  Avatar,
  Button,
  Card,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import {
  ApiOutlined,
  DisconnectOutlined,
  KeyOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { api } from './api.js'
import { deepClone } from './compat.js'

const { Text } = Typography
const TEMP_KEY_COOLDOWN_STORAGE = 'qqbot_temp_key_cooldown_until'
const DEFAULT_TEMP_KEY_COOLDOWN_SEC = 5 * 60
const STATUS_POLL_MS = 20000

function useNotifyError() {
  const { message } = AntApp.useApp()
  return useCallback((text) => {
    if (text) message.error(String(text))
  }, [message])
}

function confirmAction(modal, options) {
  return new Promise((resolve) => {
    modal.confirm({
      ...options,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

function formatRemain(sec) {
  const s = Math.max(0, Math.ceil(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function readCooldownUntil() {
  const raw = Number(localStorage.getItem(TEMP_KEY_COOLDOWN_STORAGE) || 0)
  return Number.isFinite(raw) && raw > Date.now() ? raw : 0
}

function writeCooldownUntil(untilMs) {
  if (untilMs > Date.now()) localStorage.setItem(TEMP_KEY_COOLDOWN_STORAGE, String(untilMs))
  else localStorage.removeItem(TEMP_KEY_COOLDOWN_STORAGE)
}

function Brand({ sub }) {
  return (
    <div className="app-brand">
      <img
        className="app-brand-mark"
        src={`${import.meta.env.BASE_URL}qqbot-icon.png`}
        alt=""
        width={28}
        height={28}
        aria-hidden="true"
      />
      <div>
        <div className="app-brand-title">QQBot 管理</div>
        {sub ? <div className="app-brand-sub">{sub}</div> : null}
      </div>
    </div>
  )
}

function LoginView({ onAuthed }) {
  const notifyError = useNotifyError()
  const [busy, setBusy] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState(() => readCooldownUntil())
  const [now, setNow] = useState(() => Date.now())
  const [form] = Form.useForm()

  const remainSec = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  const onCooldown = remainSec > 0

  useEffect(() => {
    if (!onCooldown) {
      writeCooldownUntil(0)
      return undefined
    }
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [onCooldown])

  const startCooldown = (seconds) => {
    const sec = Math.max(1, Number(seconds) || DEFAULT_TEMP_KEY_COOLDOWN_SEC)
    const until = Date.now() + sec * 1000
    writeCooldownUntil(until)
    setCooldownUntil(until)
    setNow(Date.now())
  }

  const requestKey = async () => {
    if (onCooldown) return
    setBusy(true)
    try {
      const data = await api.requestTempKey()
      startCooldown(data?.cooldownSeconds || DEFAULT_TEMP_KEY_COOLDOWN_SEC)
    } catch (err) {
      if (err.retryAfter > 0) startCooldown(err.retryAfter)
      notifyError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (values) => {
    setBusy(true)
    try {
      await api.tempLogin(String(values.tempKey || '').trim())
      onAuthed()
    } catch (err) {
      notifyError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <Card className="login-card" bordered={false}>
        <Brand sub="临时 Key 登录" />
        <Divider style={{ margin: '20px 0 16px' }} />
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} size="middle">
          <div className="login-temp-panel">
            <p className="login-hint">
              获取后 Key 写入主服日志，<strong>1 天内</strong>可登录一次；同一 IP 每 5 分钟只能获取 1 次。
            </p>
            <Form.Item
              name="tempKey"
              label="临时 Key"
              rules={[{ required: true, message: '请输入临时 Key' }]}
            >
              <Input
                prefix={<KeyOutlined style={{ color: '#8c8c8c' }} />}
                placeholder="从主服日志复制"
                autoComplete="off"
                allowClear
              />
            </Form.Item>
            <Button
              onClick={requestKey}
              loading={busy}
              disabled={onCooldown}
              block
              className="login-get-key-btn"
            >
              {onCooldown ? `冷却中 ${formatRemain(remainSec)}` : '获取临时 Key'}
            </Button>
          </div>
          <Button type="primary" htmlType="submit" loading={busy} block size="large" className="login-submit">
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}

const GLOBAL_SWITCHES = [
  ['sandbox', '沙箱模式'],
  ['toQRCode', '链接转二维码'],
  ['toCallback', '按钮 Callback'],
  ['toBotUpload', 'Bot 图床上传'],
  ['hideGuildRecall', '隐藏频道撤回'],
  ['defaultMarkdownSupport', '默认 Markdown'],
]

function DenseSwitchGrid({ fields }) {
  return (
    <div className="dense-switch-grid">
      {fields.map(([name, label]) => (
        <label key={name} className="dense-switch-item">
          <span>{label}</span>
          <Form.Item name={name} valuePropName="checked" noStyle>
            <Switch size="small" />
          </Form.Item>
        </label>
      ))}
    </div>
  )
}

function GlobalConfigForm({ form }) {
  return (
    <Form form={form} layout="vertical" className="dense-fields" size="small">
      <DenseSwitchGrid fields={GLOBAL_SWITCHES} />
      <div className="dense-switch-grid">
        <Form.Item name="imageLength" label="图片压缩边长" rules={[{ required: true }]}>
          <InputNumber min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="maxRetry" label="最大重试" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="timeout" label="超时 (ms)" rules={[{ required: true }]} style={{ gridColumn: '1 / -1' }}>
          <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
        </Form.Item>
      </div>
    </Form>
  )
}

function GlobalConfigModal({ open, onClose, onSaved }) {
  const notifyError = useNotifyError()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const data = await api.getConfig()
        if (cancelled) return
        form.setFieldsValue({
          sandbox: data.bot?.sandbox ?? false,
          toQRCode: data.toQRCode ?? true,
          toCallback: data.toCallback ?? true,
          toBotUpload: data.toBotUpload ?? true,
          hideGuildRecall: data.hideGuildRecall ?? false,
          defaultMarkdownSupport: data.defaultMarkdownSupport ?? false,
          imageLength: data.imageLength ?? 3,
          maxRetry: data.bot?.maxRetry ?? 10,
          timeout: data.bot?.timeout ?? 30000,
        })
      } catch (err) {
        notifyError(err.message)
        onClose()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, form, notifyError, onClose])

  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await api.putConfig({
        toQRCode: values.toQRCode,
        toCallback: values.toCallback,
        toBotUpload: values.toBotUpload,
        hideGuildRecall: values.hideGuildRecall,
        imageLength: values.imageLength,
        defaultMarkdownSupport: values.defaultMarkdownSupport,
        bot: {
          sandbox: values.sandbox,
          maxRetry: values.maxRetry,
          timeout: values.timeout,
        },
      })
      onSaved?.()
      onClose()
    } catch (err) {
      notifyError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      className="qq-modal"
      title="全局配置"
      open={open}
      onCancel={onClose}
      onOk={save}
      okText="保存"
      confirmLoading={saving}
      destroyOnHidden
      centered
      width={520}
    >
      <Spin spinning={loading}>
        <GlobalConfigForm form={form} />
      </Spin>
    </Modal>
  )
}

function AddBotModal({ open, onClose, onAdded }) {
  const notifyError = useNotifyError()
  const [form] = Form.useForm()
  const [busy, setBusy] = useState(false)
  /** 仅当前 AppID+Secret 测通后才允许保存 */
  const [verifiedKey, setVerifiedKey] = useState('')

  const watchAppId = Form.useWatch('appId', form)
  const watchSecret = Form.useWatch('clientSecret', form)
  const credKey = `${String(watchAppId || '').trim()}\0${String(watchSecret || '').trim()}`
  const canSave = !!verifiedKey && verifiedKey === credKey

  useEffect(() => {
    if (open) {
      form.resetFields()
      form.setFieldsValue({ enabled: true, markdownSupport: false })
      setVerifiedKey('')
    }
  }, [open, form])

  useEffect(() => {
    if (verifiedKey && verifiedKey !== credKey) setVerifiedKey('')
  }, [credKey, verifiedKey])

  const test = async () => {
    const values = await form.validateFields(['appId', 'clientSecret'])
    setBusy(true)
    try {
      const appId = values.appId.trim()
      const clientSecret = values.clientSecret.trim()
      await api.testConnect({ appId, clientSecret })
      setVerifiedKey(`${appId}\0${clientSecret}`)
    } catch (err) {
      setVerifiedKey('')
      notifyError(err.message || '凭证校验失败')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const values = await form.validateFields()
    const appId = values.appId.trim()
    const clientSecret = values.clientSecret.trim()
    if (`${appId}\0${clientSecret}` !== verifiedKey) {
      notifyError('请先校验凭证再保存')
      return
    }
    setBusy(true)
    try {
      await api.addAccount({
        appId,
        clientSecret,
        enabled: values.enabled !== false,
        markdownSupport: !!values.markdownSupport,
      })
      onAdded?.()
      onClose()
    } catch (err) {
      notifyError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      className="qq-modal"
      title="添加账号"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      centered
      width={480}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button loading={busy} onClick={test}>
            校验凭证
          </Button>
          <Button type="primary" loading={busy} disabled={!canSave} onClick={save}>
            保存并连接
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" size="small" requiredMark={false} className="dense-fields">
        <Form.Item name="appId" label="AppID" rules={[{ required: true, message: '必填' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="clientSecret" label="ClientSecret" rules={[{ required: true, message: '必填' }]}>
          <Input.Password />
        </Form.Item>
        <DenseSwitchGrid
          fields={[
            ['enabled', '启用并连接'],
            ['markdownSupport', 'Markdown'],
          ]}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          校验只验 AppID/Secret，不占网关登录名额；正式连接在保存时进行一次。
          {canSave ? ' 已校验，可保存。' : ' 须先校验凭证再保存。'}
        </Text>
      </Form>
    </Modal>
  )
}

const ACCOUNT_SWITCHES = [
  ['sandbox', '沙箱'],
  ['markdownSupport', 'Markdown'],
  ['autoConnect', '自动连接'],
  ['toQRCode', '链接转二维码'],
  ['toCallback', '按钮 Callback'],
  ['toBotUpload', 'Bot 图床'],
]

function BotSettingsModal({ bot, onClose, onSaved }) {
  const notifyError = useNotifyError()
  const { modal } = AntApp.useApp()
  const [form] = Form.useForm()
  const [masters, setMasters] = useState([])
  const [newMaster, setNewMaster] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('config')

  useEffect(() => {
    if (!bot) return
    let cancelled = false
    setLoading(true)
    setTab('config')
    ;(async () => {
      try {
        const [cfgRes, masterRes] = await Promise.all([
          api.getAccountConfig(bot.appId),
          api.listMasters(bot.id),
        ])
        if (cancelled) return
        form.setFieldsValue(deepClone(cfgRes.config || cfgRes))
        setMasters(masterRes.masters || [])
      } catch (err) {
        notifyError(err.message)
        onClose()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bot, form, notifyError, onClose])

  if (!bot) return null

  const saveConfig = async () => {
    const values = await form.validateFields()
    setBusy(true)
    try {
      await api.putAccountConfig(bot.appId, values)
      onSaved?.()
    } catch (err) {
      notifyError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const addMaster = async () => {
    const uid = newMaster.trim()
    if (!uid) return
    setBusy(true)
    try {
      await api.addMaster(bot.id, uid)
      setNewMaster('')
      const res = await api.listMasters(bot.id)
      setMasters(res.masters || [])
    } catch (err) {
      notifyError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeMaster = async (m) => {
    const ok = await confirmAction(modal, {
      title: '移除主人',
      content: `确认移除 ${m}？`,
      okText: '移除',
      okButtonProps: { danger: true },
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.removeMaster(bot.id, m)
      setMasters((list) => list.filter((x) => x !== m))
    } catch (err) {
      notifyError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const title = bot.nickname || bot.appId

  return (
    <Modal
      className="qq-modal"
      title={`账号设置 · ${title}`}
      open
      onCancel={onClose}
      centered
      width={560}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          {tab === 'config' ? (
            <Button type="primary" loading={busy} onClick={saveConfig}>
              保存配置
            </Button>
          ) : null}
        </Space>
      }
    >
      <Spin spinning={loading}>
        <div className="qq-modal-meta">
          <Tag color="blue" style={{ margin: 0 }}>
            {title}
          </Tag>
          <span className="meta-id">AppID {bot.appId}</span>
          <Tag color={bot.status === 'online' ? 'success' : 'default'} style={{ margin: 0 }}>
            {bot.status === 'online' ? '在线' : '离线'}
          </Tag>
        </div>

        <Tabs
          size="small"
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'config',
              label: '配置',
              children: (
                <Form form={form} layout="vertical" size="small" className="dense-fields">
                  <Form.Item name="remark" label="备注" style={{ marginBottom: 10 }}>
                    <Input placeholder="本地备注（可选）" maxLength={200} allowClear />
                  </Form.Item>
                  <DenseSwitchGrid fields={ACCOUNT_SWITCHES} />
                  <Form.Item name="imageLength" label="图片边长" style={{ marginBottom: 0, maxWidth: 200 }}>
                    <InputNumber min={1} style={{ width: '100%' }} />
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'masters',
              label: `主人 (${masters.length})`,
              children: (
                <div className="master-compact">
                  <p className="master-compact-hint">
                    写入 chatbot.master.qq · 格式 {bot.appId}:OpenID
                  </p>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      size="small"
                      value={newMaster}
                      onChange={(e) => setNewMaster(e.target.value)}
                      placeholder="OpenID / QQ"
                      onPressEnter={addMaster}
                    />
                    <Button
                      type="primary"
                      size="small"
                      loading={busy}
                      disabled={!newMaster.trim()}
                      onClick={addMaster}
                    >
                      添加
                    </Button>
                  </Space.Compact>
                  <div className="master-compact-list">
                    {masters.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        暂无主人
                      </Text>
                    ) : (
                      masters.map((m) => (
                        <Tag
                          key={m}
                          closable
                          onClose={(ev) => {
                            ev.preventDefault()
                            removeMaster(m)
                          }}
                        >
                          {m}
                        </Tag>
                      ))
                    )}
                  </div>
                </div>
              ),
            },
          ]}
        />
      </Spin>
    </Modal>
  )
}

function Dashboard({ onLogout }) {
  const notifyError = useNotifyError()
  const { modal } = AntApp.useApp()
  const [status, setStatus] = useState(null)
  const [busyId, setBusyId] = useState('')
  const [showGlobal, setShowGlobal] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editBot, setEditBot] = useState(null)
  const refreshing = useRef(false)

  const refresh = useCallback(async ({ silent = true } = {}) => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const data = await api.status()
      setStatus(data)
    } catch (err) {
      if (/Unauthorized|未授权|登录|Forbidden/i.test(err.message || '')) {
        onLogout()
        return
      }
      if (!silent) notifyError(err.message)
    } finally {
      refreshing.current = false
    }
  }, [notifyError, onLogout])

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      refresh({ silent: true })
    }
    tick()
    const t = setInterval(tick, STATUS_POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refresh])

  const run = async (id, fn) => {
    setBusyId(id)
    try {
      await fn()
      await refresh({ silent: true })
    } catch (err) {
      notifyError(err.message)
    } finally {
      setBusyId('')
    }
  }

  const bots = status?.bots || []

  const columns = useMemo(
    () => [
      {
        title: '账号',
        key: 'bot',
        render: (_, bot) => (
          <Space>
            <Avatar src={bot.avatar} size={40} />
            <div>
              <div style={{ fontWeight: 500 }}>{bot.nickname || bot.appId}</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                AppID {bot.appId}
                {bot.remark ? ` · ${bot.remark}` : ''}
              </Text>
            </div>
          </Space>
        ),
      },
      {
        title: '状态',
        width: 120,
        render: (_, bot) => (
          <Space size={4} direction="vertical">
            <Tag color={bot.status === 'online' ? 'success' : 'default'}>
              {bot.status === 'online' ? '在线' : '离线'}
            </Tag>
            {bot.enabled === false ? <Tag>已禁用</Tag> : null}
          </Space>
        ),
      },
      {
        title: '操作',
        width: 280,
        align: 'right',
        render: (_, bot) => (
          <Space wrap>
            <Button size="small" icon={<SettingOutlined />} onClick={() => setEditBot(bot)}>
              设置
            </Button>
            {bot.status === 'online' ? (
              <Button
                size="small"
                icon={<DisconnectOutlined />}
                loading={busyId === bot.appId}
                onClick={() => run(bot.appId, () => api.disconnect(bot.appId))}
              >
                断开
              </Button>
            ) : (
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={busyId === bot.appId}
                onClick={() => run(bot.appId, () => api.reconnect(bot.appId))}
              >
                重连
              </Button>
            )}
            <Button
              size="small"
              danger
              loading={busyId === bot.appId}
              onClick={async () => {
                const ok = await confirmAction(modal, {
                  title: '删除账号',
                  content: `确认删除 ${bot.nickname || bot.appId}？`,
                  okText: '删除',
                  okButtonProps: { danger: true },
                })
                if (!ok) return
                run(bot.appId, () => api.removeAccount(bot.appId))
              }}
            >
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [busyId, modal],
  )

  const sub = status
    ? `v${status.version || '-'} · ${status.onlineCount ?? 0}/${status.botCount ?? 0} 在线`
    : '加载中…'

  return (
    <div className="app-page">
      <header className="app-header">
        <Brand sub={sub} />
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => refresh({ silent: false })}>
            刷新
          </Button>
          <Button
            icon={<SyncOutlined />}
            loading={busyId === 'reload'}
            onClick={() => run('reload', () => api.reload())}
          >
            重载
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => setShowGlobal(true)}>
            全局配置
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowAdd(true)}>
            添加账号
          </Button>
          <Button
            icon={<LogoutOutlined />}
            onClick={async () => {
              try {
                await api.logout()
              } catch {
                /* ignore */
              }
              onLogout()
            }}
          >
            登出
          </Button>
        </Space>
      </header>

      <main className="app-main">
        <Card title="账号列表" styles={{ body: { paddingTop: 8 } }}>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={bots}
            pagination={false}
            locale={{
              emptyText: <Empty description="暂无账号，点击「添加账号」开始" />,
            }}
          />
        </Card>
      </main>

      <GlobalConfigModal open={showGlobal} onClose={() => setShowGlobal(false)} onSaved={() => refresh({ silent: true })} />
      <AddBotModal open={showAdd} onClose={() => setShowAdd(false)} onAdded={() => refresh({ silent: true })} />
      {editBot ? (
        <BotSettingsModal
          bot={editBot}
          onClose={() => setEditBot(null)}
          onSaved={() => refresh({ silent: true })}
        />
      ) : null}
    </div>
  )
}

export default function App() {
  const [auth, setAuth] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await api.checkAuth()
        if (!cancelled) setAuth(!!data.authenticated)
      } catch {
        if (!cancelled) setAuth(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (auth === null) {
    return (
      <div className="login-wrap">
        <Spin size="large" />
      </div>
    )
  }

  return auth ? (
    <Dashboard onLogout={() => setAuth(false)} />
  ) : (
    <LoginView onAuthed={() => setAuth(true)} />
  )
}
