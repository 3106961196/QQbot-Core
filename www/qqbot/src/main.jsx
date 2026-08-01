import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App.jsx'
import { officeTheme } from './theme.js'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={officeTheme}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
)
