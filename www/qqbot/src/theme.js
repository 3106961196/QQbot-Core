/** 极简蓝色办公风 — Ant Design 主题 */
export const officeTheme = {
  token: {
    colorPrimary: '#1677ff',
    colorInfo: '#1677ff',
    colorSuccess: '#389e0d',
    colorWarning: '#d48806',
    colorError: '#cf1322',
    colorText: '#1f1f1f',
    colorTextSecondary: '#595959',
    colorTextTertiary: '#8c8c8c',
    colorBorder: '#d9e2ef',
    colorBorderSecondary: '#e8eef6',
    colorBgLayout: '#f0f4f9',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    borderRadius: 8,
    borderRadiusLG: 10,
    fontFamily:
      '"IBM Plex Sans", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 14,
    controlHeight: 32,
    boxShadow: '0 1px 2px rgba(15, 35, 70, 0.04)',
    boxShadowSecondary: '0 4px 16px rgba(15, 35, 70, 0.06)',
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      bodyBg: '#f0f4f9',
      headerHeight: 56,
      headerPadding: '0 24px',
    },
    Card: {
      paddingLG: 16,
    },
    Button: {
      primaryShadow: 'none',
      defaultShadow: 'none',
    },
    Form: {
      itemMarginBottom: 12,
    },
    Table: {
      headerBg: '#f5f8fc',
      rowHoverBg: '#f7faff',
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 8,
    },
    Modal: {
      paddingMD: 16,
      titleFontSize: 16,
    },
    Tabs: {
      horizontalItemPadding: '8px 0',
      horizontalMargin: '0 0 12px 0',
    },
  },
}
