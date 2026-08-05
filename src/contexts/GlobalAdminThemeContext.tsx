'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { darkTheme, lightTheme } from '@/lib/theme'

type Theme = 'dark' | 'light'
type Lang = 'zh' | 'en'

interface GlobalAdminThemeContextType {
  theme: Theme
  lang: Lang
  colors: typeof darkTheme
  toggleTheme: () => void
  setLang: (l: Lang) => void
  t: (key: string) => string
}

const translations = {
  zh: {
    demoRequests: '導覽申請', demoRequestsSubtitle: '從公開網站送出的聯絡表單',
    demoRequestsEmpty: '目前沒有任何申請', demoRequestsEmptyFiltered: '此狀態下沒有申請',
    demoRequestsLoadError: '無法載入申請', demoRequestsSaveError: '無法儲存變更',
    demoRequestsAddNote: '新增備註', demoRequestsEditNote: '編輯備註',
    demoStatus_new: '新申請', demoStatus_contacted: '已聯絡', demoStatus_qualified: '已確認需求',
    demoStatus_converted: '已成交', demoStatus_discarded: '已排除',
    refresh: '重新整理', all: '全部',
    organizations: '組織', revenue: '收入', vendors: '銷售商', support: '支援', logout: '登出',
    newOrganization: '新增組織', name: '名稱', plan: '方案', seats: '席位',
    leadsPerMonth: '每月線索', vendor: '銷售商', mrr: 'MRR', created: '創建日期',
    status: '狀態', actions: '操作', active: '活躍', inactive: '停用',
    impersonate: '查看', edit: '編輯', internal: '內部', allPlans: '所有方案',
    allStatus: '所有狀態', allVendors: '所有銷售商', adminEmail: '管理員郵箱',
    slug: '識別碼', maxSeats: '最大席位數', maxLeads: '每月最大線索數',
    logoUrl: 'Logo URL', markets: '市場',
    internalNotes: '內部備註', createOrganization: '創建組織', cancel: '取消',
    addOns: '附加功能', temporaryPassword: '臨時密碼', adminName: '管理員姓名',
    customPrice: '自定義價格', mrrTotal: 'MRR 總計', activeClients: '活躍客戶',
    ultraClients: 'Ultra 客戶', payingClients: '付費客戶', revenueByPlan: '按方案收入',
    revenueByVendor: '按銷售商收入', mrrByOrg: '按組織 MRR', commission: '佣金',
    subject: '主題', priority: '優先級', lastReply: '最後回覆', reply: '回覆',
    viewWorkspace: '查看工作區', organization: '組織', newVendor: '新增銷售商',
    email: '郵箱', commissionPct: '佣金 %', add: '添加', noVendors: '暫無銷售商',
    detail: '詳情', openTickets: '待處理工單', allOrgs: '所有組織', activate: '啟用',
    addOn_account_management: '帳戶管理', addOn_multi_workspace: '多工作區',
    addOn_extended_data_retention: '延長數據保留', addOn_sso: 'SSO 整合',
    addOn_linkedin_auto_messaging: 'LinkedIn 自動發送', addOn_bridge: 'Bridge（合作夥伴探索）',
    addOnHistory: '附加功能異動紀錄', addOnOn: '啟用', addOnOff: '停用',
    addOnIncludedInPlan: '方案已內含', addOnNotOnPlan: '此方案不適用', addOnPlanMismatch: '與方案不符',
    billingDay: '計費日', save: '保存', saving: '保存中...', saved: '已保存',
    // `deactivate` is generic on purpose (it pairs with `activate` and is
    // reused on the Vendors screen, where "Deactivate Organization" was
    // plainly wrong). Screens that need the noun use the specific key.
    deactivate: '停用', deactivateOrganization: '停用組織',
    changeStatus: '更改狀態', sendReply: '發送回覆',
    noTickets: '暫無工單', loading: '加載中...',
    monthlyCosts: '每月成本', infrastructure: '基礎設施', apiCosts: 'API 成本',
    subtotal: '小計', total: '總計', monthlyTotal: '每月總計',
  },
  en: {
    demoRequests: 'Demo requests', demoRequestsSubtitle: 'Contact forms submitted from the public site',
    demoRequestsEmpty: 'No requests yet', demoRequestsEmptyFiltered: 'No requests with this status',
    demoRequestsLoadError: 'Could not load requests', demoRequestsSaveError: 'Could not save the change',
    demoRequestsAddNote: 'Add a note', demoRequestsEditNote: 'Edit note',
    demoStatus_new: 'New', demoStatus_contacted: 'Contacted', demoStatus_qualified: 'Qualified',
    demoStatus_converted: 'Converted', demoStatus_discarded: 'Discarded',
    refresh: 'Refresh', all: 'All',
    organizations: 'Organizations', revenue: 'Revenue', vendors: 'Vendors',
    support: 'Support', logout: 'Logout', newOrganization: 'New Organization',
    name: 'Name', plan: 'Plan', seats: 'Seats', leadsPerMonth: 'Leads/mo',
    vendor: 'Vendor', mrr: 'MRR', created: 'Created', status: 'Status',
    actions: 'Actions', active: 'Active', inactive: 'Inactive',
    impersonate: 'View', edit: 'Edit', internal: 'Internal',
    allPlans: 'All Plans', allStatus: 'All Status', allVendors: 'All Vendors',
    adminEmail: 'Admin Email', slug: 'Slug', maxSeats: 'Max Seats',
    maxLeads: 'Max Leads/mo',
    logoUrl: 'Logo URL', markets: 'Markets', internalNotes: 'Internal Notes',
    createOrganization: 'Create Organization', cancel: 'Cancel', addOns: 'Add-ons',
    temporaryPassword: 'Temporary Password', adminName: 'Admin Name',
    customPrice: 'Custom Price/mo', mrrTotal: 'MRR Total', activeClients: 'Active Clients',
    ultraClients: 'Ultra Clients', payingClients: 'Paying Clients',
    revenueByPlan: 'Revenue by Plan', revenueByVendor: 'Revenue by Vendor',
    mrrByOrg: 'MRR by Organization', commission: 'Commission', subject: 'Subject',
    priority: 'Priority', lastReply: 'Last Reply', reply: 'Reply',
    viewWorkspace: 'View Workspace', organization: 'Organization',
    newVendor: 'New Vendor', email: 'Email', commissionPct: 'Commission %',
    add: 'Add', noVendors: 'No vendors yet', detail: 'Detail', openTickets: 'Open Tickets', allOrgs: 'All Orgs', activate: 'Activate',
    addOn_account_management: 'Account Management', addOn_multi_workspace: 'Multi-workspace',
    addOn_extended_data_retention: 'Extended Data Retention', addOn_sso: 'SSO Integration',
    addOn_linkedin_auto_messaging: 'LinkedIn Auto-messaging', addOn_bridge: 'Bridge (Partnerships)',
    addOnHistory: 'Add-on history', addOnOn: 'ON', addOnOff: 'OFF',
    addOnIncludedInPlan: 'included in plan', addOnNotOnPlan: 'not on this plan', addOnPlanMismatch: 'plan mismatch',
    billingDay: 'Billing Day', save: 'Save Changes', saving: 'Saving...', saved: 'Saved',
    deactivate: 'Deactivate', deactivateOrganization: 'Deactivate Organization',
    changeStatus: 'Change Status',
    sendReply: 'Send Reply', noTickets: 'No open tickets', loading: 'Loading...',
    monthlyCosts: 'Monthly Costs', infrastructure: 'Infrastructure', apiCosts: 'API Costs',
    subtotal: 'Subtotal', total: 'Total', monthlyTotal: 'Monthly Total',
  }
}

export const GlobalAdminThemeContext = createContext<GlobalAdminThemeContextType>({
  theme: 'dark', lang: 'zh', colors: darkTheme,
  toggleTheme: () => {}, setLang: () => {}, t: (k) => k,
})

export function GlobalAdminThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark'
    return (localStorage.getItem('ga_theme') as Theme) || 'dark'
  })
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'zh'
    return (localStorage.getItem('ga_lang') as Lang) || 'zh'
  })

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('ga_theme', next)
  }

  const setLang = (l: Lang) => {
    setLangState(l)
    localStorage.setItem('ga_lang', l)
  }

  const t = (key: string) => (translations[lang] as Record<string, string>)[key] ?? key

  const colors = theme === 'dark' ? darkTheme : lightTheme

  return (
    <GlobalAdminThemeContext.Provider value={{ theme, lang, colors, toggleTheme, setLang, t }}>
      <div style={{
        backgroundColor: colors.bg, color: colors.textPrimary,
        minHeight: '100vh', transition: 'background-color 0.2s, color 0.2s',
        fontFamily: 'Inter, -apple-system, sans-serif',
      }}>
        {children}
      </div>
    </GlobalAdminThemeContext.Provider>
  )
}

export const useGlobalAdminTheme = () => useContext(GlobalAdminThemeContext)
