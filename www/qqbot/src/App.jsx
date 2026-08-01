import { useCallback, useEffect, useMemo, useState } from 'react'
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
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { api } from './api.js'
import { deepClone } from './compat.js'

const { Text, Title } = Typography

function useNotify() {
  const { message } = AntApp.useApp()
  return useCallback(
    (text, type = 'ok') => {
      if (type === 'error') message.error(text)
      else message.success(text)
    },
    [message],
  )
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

function Brand({ sub }) {
  return (
    <div className="app-brand">
      <div className="app-brand-mark" aria-hidden />
      <div>
        <div className="app-brand-title">QQBot 管理</div>
        {sub ? <div className="app-brand-sub">{sub}</div> : null}
      </div>
    </div>
  )
}

function LoginView({ onAuthed }) {
  const notify = useNotify()
  const [mode, setMode] = useState('temp')
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm()

  const requestKey = async () => {
    setBusy(true)
    try {
      await api.requestTempKey()
      notify('临时 Key 已生成，请查看主服后台日志')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (values) => {
    setBusy(true)
    try {
      if (mode === 'temp') await api.tempLogin(String(values.tempKey || '').trim())
      else await api.login(values.password)
      notify('登录成功')
      onAuthed()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <Card className="login-card" style={{ width: '100%', maxWidth: 400 }}>
        <Brand sub="临时 Key 或管理密码登录" />
        <Divider style={{ margin: '20px 0 16px' }} />
        <Tabs
          activeKey={mode}
          onChange={setMode}
          items={[
            { key: 'temp', label: '临时 Key' },
            { key: 'password', label: '密码' },
          ]}
        />
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          {mode === 'temp' ? (
            <>
              <Form.Item
                name="tempKey"
                label="临时 Key"
                rules={[{ required: true, message: '请输入临时 Key' }]}
              >
                <Input placeholder="从主服日志复制" autoComplete="off" />
              </Form.Item>
              <Form.Item>
                <Button onClick={requestKey} loading={busy} block>
                  点击获取
                </Button>
              </Form.Item>
            </>
          ) : (
            <Form.Item
              name="password"
              label="管理密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" loading={busy} block size="large">
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}

function GlobalConfigForm({ form }) {
  return (
    <Form form={form} layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }}>
      <Form.Item name="sandbox" label="沙箱模式" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name="toQRCode" label="链接转二维码" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name="toCallback" label="按钮 Callback" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name="toBotUpload" label="Bot 图床上传" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name="hideGuildRecall" label="隐藏频道撤回" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name="defaultMarkdownSupport" label="默认 Markdown" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name="imageLength" label="图片压缩边长" rules={[{ required: true }]}>
        <InputNumber min={1} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="maxRetry" label="最大重试" rules={[{ required: true }]}>
        <InputNumber min={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="timeout" label="超时 (ms)" rules={[{ required: true }]}>
        <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
      </Form.Item>
    </Form>
  )
}

function GlobalConfigModal({ open, onClose, onSaved }) {
  const notify = useNotify()
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
        notify(err.message, 'error')
        onClose()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, form, notify, onClose])

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
      notify('全局配置已保存')
      onSaved?.()
      onClose()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="全局配置"
      open={open}
      onCancel={onClose}
      onOk={save}
      confirmLoading={saving}
      destroyOnHidden
      width={480}
    >
      <Spin spinning={loading}>
        <GlobalConfigForm form={form} />
      </Spin>
    </Modal>
  )
}

function AddBotModal({ open, onClose, onAdded }) {
  const notify = useNotify()
  const [form] = Form.useForm()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      form.resetFields()
      form.setFieldsValue({ enabled: true, markdownSupport: false })
    }
  }, [open, form])

  const test = async () => {
    const values = await form.validateFields(['appId', 'clientSecret'])
    setBusy(true)
    try {
      await api.testConnect({
        appId: values.appId.trim(),
        clientSecret: values.clientSecret.trim(),
      })
      notify('连接测试成功')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const values = await form.validateFields()
    setBusy(true)
    try {
      await api.addAccount({
        appId: values.appId.trim(),
        clientSecret: values.clientSecret.trim(),
        name: (values.name || '').trim() || values.appId.trim(),
        enabled: values.enabled !== false,
        markdownSupport: !!values.markdownSupport,
      })
      notify('账号已添加')
      onAdded?.()
      onClose()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="添加账号"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button loading={busy} onClick={test}>
            测试连接
          </Button>
          <Button type="primary" loading={busy} onClick={save}>
            保存
          </Button>
        </Space>
      }
      width={480}
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="appId" label="AppID" rules={[{ required: true, message: '必填' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="clientSecret" label="ClientSecret" rules={[{ required: true, message: '必填' }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="name" label="名称（botId，默认 AppID）">
          <Input placeholder="可选" />
        </Form.Item>
        <Form.Item name="enabled" label="启用并连接" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="markdownSupport" label="Markdown" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function BotSettingsModal({ bot, onClose }) {
  const notify = useNotify()
  const { modal } = AntApp.useApp()
  const [form] = Form.useForm()
  const [masters, setMasters] = useState([])
  const [newMaster, setNewMaster] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!bot) return
    let cancelled = false
    setLoading(true)
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
        notify(err.message, 'error')
        onClose()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bot, form, notify, onClose])

  if (!bot) return null

  const saveConfig = async () => {
    const values = await form.validateFields()
    setBusy(true)
    try {
      await api.putAccountConfig(bot.appId, values)
      notify('账号配置已保存')
    } catch (err) {
      notify(err.message, 'error')
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
      notify('已添加主人')
    } catch (err) {
      notify(err.message, 'error')
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
      notify('已移除主人')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const boolFields = [
    ['sandbox', '沙箱'],
    ['markdownSupport', 'Markdown'],
    ['autoConnect', '自动连接'],
    ['toQRCode', '链接转二维码'],
    ['toCallback', '按钮 Callback'],
    ['toBotUpload', 'Bot 图床'],
  ]

  return (
    <Modal
      title={`账号设置 · ${bot.nickname || bot.id}`}
      open
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" loading={busy} onClick={saveConfig}>
            保存配置
          </Button>
        </Space>
      }
      width={520}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        <Form form={form} layout="horizontal" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }}>
          {boolFields.map(([name, label]) => (
            <Form.Item key={name} name={name} label={label} valuePropName="checked">
              <Switch />
            </Form.Item>
          ))}
          <Form.Item name="imageLength" label="图片边长">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>

        <Divider />
        <Title level={5} style={{ marginTop: 0 }}>
          主人
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          写入 chatbot.master.qq，格式 {bot.id}:OpenID
        </Text>
        <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
          <Input
            value={newMaster}
            onChange={(e) => setNewMaster(e.target.value)}
            placeholder="OpenID / QQ"
            onPressEnter={addMaster}
          />
          <Button type="primary" loading={busy} disabled={!newMaster.trim()} onClick={addMaster}>
            添加
          </Button>
        </Space.Compact>
        <Table
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={masters.map((id) => ({ id }))}
          locale={{ emptyText: '暂无主人' }}
          columns={[
            { title: 'OpenID', dataIndex: 'id' },
            {
              title: '',
              width: 80,
              align: 'right',
              render: (_, row) => (
                <Button type="link" danger size="small" onClick={() => removeMaster(row.id)}>
                  删除
                </Button>
              ),
            },
          ]}
        />
      </Spin>
    </Modal>
  )
}

function Dashboard({ onLogout }) {
  const notify = useNotify()
  const { modal } = AntApp.useApp()
  const [status, setStatus] = useState(null)
  const [busyId, setBusyId] = useState('')
  const [showGlobal, setShowGlobal] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editBot, setEditBot] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const data = await api.status()
      setStatus(data)
    } catch (err) {
      notify(err.message, 'error')
      if (/Unauthorized|未授权|登录|Forbidden/i.test(err.message)) onLogout()
    }
  }, [notify, onLogout])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 8000)
    return () => clearInterval(t)
  }, [refresh])

  const run = async (id, fn, okMsg) => {
    setBusyId(id)
    try {
      await fn()
      if (okMsg) notify(okMsg)
      await refresh()
    } catch (err) {
      notify(err.message, 'error')
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
              <div style={{ fontWeight: 500 }}>{bot.nickname || bot.id}</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                AppID {bot.appId} · id {bot.id}
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
                onClick={() => run(bot.appId, () => api.disconnect(bot.appId), '已断开')}
              >
                断开
              </Button>
            ) : (
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={busyId === bot.appId}
                onClick={() => run(bot.appId, () => api.reconnect(bot.appId), '重连成功')}
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
                run(bot.appId, () => api.removeAccount(bot.appId), '已删除')
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
          <Button icon={<ReloadOutlined />} onClick={() => refresh()}>
            刷新
          </Button>
          <Button
            icon={<SyncOutlined />}
            loading={busyId === 'reload'}
            onClick={() => run('reload', () => api.reload(), '配置已重载')}
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

      <GlobalConfigModal open={showGlobal} onClose={() => setShowGlobal(false)} onSaved={refresh} />
      <AddBotModal open={showAdd} onClose={() => setShowAdd(false)} onAdded={refresh} />
      {editBot ? <BotSettingsModal bot={editBot} onClose={() => setEditBot(null)} /> : null}
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
