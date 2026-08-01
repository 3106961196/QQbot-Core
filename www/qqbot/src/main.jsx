import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App.jsx'
import { officeTheme } from './theme.js'
import './styles.css'

/** 挂到本应用路由下的 ico，覆盖站点根 /favicon.ico */
;(function applyMountFavicon() {
  const href = `${import.meta.env.BASE_URL}favicon.ico`
  for (const el of document.querySelectorAll('link[rel*="icon"]')) {
    if (el.getAttribute('type') === 'image/svg+xml' || /\.svg($|\?)/i.test(el.href)) {
      el.remove()
      continue
    }
    el.setAttribute('href', href)
    el.setAttribute('type', 'image/x-icon')
  }
  if (!document.querySelector('link[rel="icon"]')) {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = 'image/x-icon'
    link.href = href
    document.head.appendChild(link)
  }
})()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={officeTheme}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
)
