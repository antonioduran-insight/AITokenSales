'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const ACCENT = '#6C63FF'
const BG = '#0A0A0F'
const SURFACE = '#13131A'
const SURFACE_RAISED = '#1C1C27'
const BORDER = '#2A2A3A'
const TEXT_MUTED = '#52526A'
const TEXT_SECONDARY = '#8B8BA0'
const SUCCESS = '#22C55E'

const S: Record<string, React.CSSProperties> = {
  page: { backgroundColor: BG, color: '#F0F0F5', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', minHeight: '100vh', overflowX: 'hidden' },
  nav: { position: 'sticky', top: 0, zIndex: 100, backgroundColor: `${BG}EE`, backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BORDER}`, padding: '0 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 },
  logo: { fontSize: 20, fontWeight: 800, background: `linear-gradient(135deg, ${ACCENT}, #A78BFA)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.5px' },
  navLink: { fontSize: 14, color: TEXT_SECONDARY, textDecoration: 'none', cursor: 'pointer' },
  btnPrimary: { backgroundColor: ACCENT, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'inline-block' },
  btnSecondary: { backgroundColor: 'transparent', color: TEXT_SECONDARY, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 500, cursor: 'pointer', textDecoration: 'none', display: 'inline-block' },
  section: { maxWidth: 1100, margin: '0 auto', padding: '80px 40px' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 6, backgroundColor: `${ACCENT}18`, color: '#A78BFA', border: `1px solid ${ACCENT}44`, borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 20 },
  h1: { fontSize: 'clamp(40px, 6vw, 72px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-2px', margin: '0 0 24px' },
  featureCard: { backgroundColor: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '28px 24px', transition: 'border-color 0.2s, transform 0.2s' },
}

/* ─────────────────────────── DEMO MODAL ─────────────────────────── */

const STEPS = [
  {
    num: '01', label: '啟動抓取器', duration: 20000,
    title: '啟動 LinkedIn 智能抓取器',
    narration: '選擇目標受眾組合與市場。每個 Combo 對應不同的 LinkedIn 搜尋條件，精準定位科技、SaaS、金融等行業的決策者。',
  },
  {
    num: '02', label: '實時抓取中', duration: 20000,
    title: 'AI 正在抓取潛在客戶數據...',
    narration: '系統自動從 LinkedIn 提取並驗證潛在客戶的職位、公司、聯絡方式，即時去重並過濾無效資料。',
  },
  {
    num: '03', label: 'ICP 評分', duration: 20000,
    title: 'AI 生成 ICP 契合度評分',
    narration: 'AI 根據公司規模、行業、職位層級及 LinkedIn 活躍度，為每位潛在客戶打分，標記 HOT / WARM / COLD 溫度。',
  },
  {
    num: '04', label: '生成個性化消息', duration: 25000,
    title: '為每位潛在客戶生成個性化消息',
    narration: '針對每位潛在客戶，AI 自動撰寫個性化的 LinkedIn 連結請求，融入其公司動態與職位背景，避免千篇一律的模板感。',
  },
  {
    num: '05', label: '導入 CRM', duration: 18000,
    title: '一鍵導入 CRM，自動去重',
    narration: '將抓取結果導入 CRM，系統自動偵測重複資料。每位潛在客戶進入對應 SDR 的看板，準備開始觸達。',
  },
  {
    num: '06', label: '發送連結請求', duration: 20000,
    title: '在 LinkedIn 發送個性化連結請求',
    narration: '直接從 CRM 複製消息並在 LinkedIn 發送。消息引用對方公司的具體資訊，讓對方感受到是真誠的個人訊息，而非群發。',
  },
  {
    num: '07', label: '收到回覆！', duration: 20000,
    title: '🎉 對方接受連結並回覆了！',
    narration: '個性化的連結請求引起了對方的興趣。她主動回覆，表示對我們分享的內容感興趣，希望了解更多。',
  },
  {
    num: '08', label: '約定通話', duration: 25000,
    title: '成功約定視頻通話',
    narration: '整個流程從抓取到約定通話只需數天。關鍵在於：我們從未提銷售，只是建立連結、分享價值，讓對方主動想了解更多。',
  },
]

function useTypewriter(text: string, active: boolean, speed = 45) {
  const [displayed, setDisplayed] = useState('')
  const idx = useRef(0)
  useEffect(() => {
    if (!active) { setDisplayed(''); idx.current = 0; return }
    idx.current = 0
    setDisplayed('')
    const id = setInterval(() => {
      idx.current++
      setDisplayed(text.slice(0, idx.current))
      if (idx.current >= text.length) clearInterval(id)
    }, speed)
    return () => clearInterval(id)
  }, [text, active, speed])
  return displayed
}

function useCounter(target: number, active: boolean, durationMs = 2000) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!active) { setVal(0); return }
    const start = Date.now()
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(elapsed / durationMs, 1)
      setVal(Math.floor(pct * target))
      if (pct >= 1) clearInterval(id)
    }, 30)
    return () => clearInterval(id)
  }, [target, active, durationMs])
  return val
}

const FAKE_LEADS = [
  { name: '陳怡婷', co: 'CloudBase Taiwan', title: 'VP Growth', icp: 9, temp: 'HOT', tempColor: '#EF4444' },
  { name: '李明賢', co: 'FinTech Innovation', title: 'CEO', icp: 8, temp: 'HOT', tempColor: '#EF4444' },
  { name: '王佳慧', co: 'NovaSoft Ltd', title: 'Head of Sales', icp: 8, temp: 'WARM', tempColor: '#F59E0B' },
  { name: 'James Lin', co: 'TechVentures Asia', title: 'CTO', icp: 7, temp: 'WARM', tempColor: '#F59E0B' },
  { name: '張志遠', co: 'DataFlow Systems', title: 'VP Engineering', icp: 6, temp: 'COLD', tempColor: '#3B82F6' },
  { name: 'Mei Chen', co: 'Startup Hub TW', title: 'Co-founder', icp: 9, temp: 'HOT', tempColor: '#EF4444' },
]

const CONN_MSG = `您好，陳小姐！

我注意到 CloudBase Taiwan 最近在積極拓展企業客戶，在 B2B SaaS 增長領域做了不少有趣的嘗試。

我有一些關於提升 LinkedIn 銷售觸達效率的想法想與您交流，期待建立連結！`

const VALUE_MSG = `陳小姐，感謝接受連結！

分享一個案例：一家規模類似的 SaaS 公司透過優化 LinkedIn 觸達流程，在 90 天內將 demo 預約率提升了 3 倍。

這是我們在台灣市場的觀察，您是否有興趣聊聊？`

const CONVO = [
  { side: 'us', text: CONN_MSG, time: '週二 10:24' },
  { side: 'them', text: '您好！感謝您的消息。我們確實在尋找提升企業銷售效率的方案，您提到的案例聽起來很有意思，可以多分享嗎？', time: '週二 14:37' },
]
const FOLLOW_UP = [
  { side: 'us', text: '太好了，陳小姐！不如我們安排一個 15–20 分鐘的視頻通話？我可以根據 CloudBase 的具體情況分享更實用的建議。', time: '週二 15:02' },
  { side: 'them', text: '好的！這週四下午 2 點可以嗎？', time: '週二 16:15' },
  { side: 'us', text: '完美！日曆邀請已發送到您的信箱。期待週四的交流！🗓', time: '週二 16:18' },
]

function SlideContent({ step, subStep }: { step: number; subStep: number }) {
  const leadCount = useCounter(156, step === 1, 3500)
  const msgType = useTypewriter(CONN_MSG, step === 3, 22)

  const fakeWindow = (title: string, content: React.ReactNode) => (
    <div style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.6)', maxWidth: 780, width: '100%', margin: '0 auto' }}>
      <div style={{ backgroundColor: SURFACE_RAISED, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#EF4444' }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#F59E0B' }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: SUCCESS }} />
        <span style={{ fontSize: 11, color: TEXT_MUTED, marginLeft: 8 }}>{title}</span>
      </div>
      {content}
    </div>
  )

  // Slide 0: Scraper launch
  if (step === 0) {
    return fakeWindow('app.aitokenking.com/run', (
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, color: '#F0F0F5' }}>🚀 啟動新抓取任務</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>目標受眾組合</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(c => (
                <div key={c} style={{ width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, border: `1px solid ${['A','B','C'].includes(c) ? ACCENT : BORDER}`, backgroundColor: ['A','B','C'].includes(c) ? `${ACCENT}22` : 'transparent', color: ['A','B','C'].includes(c) ? '#A78BFA' : TEXT_MUTED, transition: 'all 0.3s', transform: ['A','B','C'].includes(c) ? 'scale(1.08)' : 'scale(1)' }}>
                  {c}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>市場</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ name: 'Taiwan 🇹🇼', active: true }, { name: 'LATAM', active: false }, { name: 'Vietnam', active: false }].map(m => (
                <div key={m.name} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${m.active ? ACCENT : BORDER}`, backgroundColor: m.active ? `${ACCENT}22` : 'transparent', color: m.active ? '#A78BFA' : TEXT_MUTED }}>{m.name}</div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>每個組合抓取數量</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, backgroundColor: SURFACE_RAISED, border: `1px solid ${BORDER}`, borderRadius: 7, padding: '8px 12px', fontSize: 13, color: '#F0F0F5', fontFamily: 'monospace' }}>50 leads</div>
            <div style={{ fontSize: 12, color: TEXT_MUTED }}>× 3 combos = <strong style={{ color: '#A78BFA' }}>150 leads</strong></div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 2, backgroundColor: BORDER }} />
          <button style={{ backgroundColor: subStep >= 1 ? SUCCESS : ACCENT, color: '#fff', border: 'none', borderRadius: 8, padding: '11px 28px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.3s' }}>
            {subStep >= 1 ? '✓ 已啟動！' : '▶ 啟動抓取'}
          </button>
        </div>
      </div>
    ))
  }

  // Slide 1: Scraping progress
  if (step === 1) {
    return fakeWindow('app.aitokenking.com/dashboard — 抓取中', (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: ACCENT, display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>正在抓取 Taiwan · Combo A, B, C</span>
          </div>
          <span style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: '#F0F0F5' }}>{leadCount} <span style={{ fontSize: 12, color: TEXT_MUTED, fontWeight: 400 }}>/ 156</span></span>
        </div>
        <div style={{ height: 6, backgroundColor: BORDER, borderRadius: 3, marginBottom: 20, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min((leadCount / 156) * 100, 100)}%`, backgroundColor: ACCENT, borderRadius: 3, transition: 'width 0.1s' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'hidden' }}>
          {FAKE_LEADS.slice(0, Math.min(Math.ceil(leadCount / 26) + 1, 6)).map((lead, i) => (
            <div key={lead.name} style={{ display: 'flex', alignItems: 'center', gap: 12, backgroundColor: SURFACE_RAISED, borderRadius: 8, padding: '8px 12px', opacity: i < Math.ceil(leadCount / 26) ? 1 : 0, transition: 'opacity 0.4s' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: `${ACCENT}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#A78BFA', flexShrink: 0 }}>{lead.name[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#F0F0F5' }}>{lead.name}</div>
                <div style={{ fontSize: 11, color: TEXT_MUTED }}>{lead.title} · {lead.co}</div>
              </div>
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, backgroundColor: '#22C55E22', color: SUCCESS }}>✓ 已驗證</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 16 }}>
          {['🔍 爬取資料', '✅ 驗證職位', '📝 清洗格式'].map((s, i) => (
            <div key={s} style={{ fontSize: 11, color: leadCount > i * 50 ? SUCCESS : TEXT_MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: leadCount > i * 50 ? SUCCESS : TEXT_MUTED, display: 'inline-block' }} />
              {s}
            </div>
          ))}
        </div>
      </div>
    ))
  }

  // Slide 2: ICP scoring
  if (step === 2) {
    return fakeWindow('app.aitokenking.com/leads — ICP 評分完成', (
      <div style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['姓名', '公司', '職位', 'ICP 分數', '溫度'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: TEXT_MUTED, fontWeight: 600, textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FAKE_LEADS.map((l, i) => (
              <tr key={l.name} style={{ opacity: subStep >= i ? 1 : 0, transition: `opacity 0.4s ${i * 0.15}s` }}>
                <td style={{ padding: '10px 14px', fontWeight: 600, borderBottom: `1px solid ${SURFACE_RAISED}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: `${ACCENT}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#A78BFA' }}>{l.name[0]}</div>
                    {l.name}
                  </div>
                </td>
                <td style={{ padding: '10px 14px', color: TEXT_SECONDARY, borderBottom: `1px solid ${SURFACE_RAISED}` }}>{l.co}</td>
                <td style={{ padding: '10px 14px', color: TEXT_SECONDARY, borderBottom: `1px solid ${SURFACE_RAISED}` }}>{l.title}</td>
                <td style={{ padding: '10px 14px', borderBottom: `1px solid ${SURFACE_RAISED}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ height: 4, width: `${l.icp * 8}px`, backgroundColor: l.icp >= 8 ? SUCCESS : l.icp >= 6 ? '#F59E0B' : TEXT_MUTED, borderRadius: 2 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: l.icp >= 8 ? SUCCESS : l.icp >= 6 ? '#F59E0B' : TEXT_MUTED }}>{l.icp}/10</span>
                  </div>
                </td>
                <td style={{ padding: '10px 14px', borderBottom: `1px solid ${SURFACE_RAISED}` }}>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, backgroundColor: `${l.tempColor}22`, color: l.tempColor, fontWeight: 700 }}>{l.temp}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ))
  }

  // Slide 3: Message generation
  if (step === 3) {
    return fakeWindow('app.aitokenking.com/leads — 陳怡婷 · 個性化消息', (
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, padding: 14, backgroundColor: SURFACE_RAISED, borderRadius: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: `${ACCENT}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#A78BFA', flexShrink: 0 }}>陳</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>陳怡婷</div>
            <div style={{ fontSize: 12, color: TEXT_MUTED }}>VP Growth · CloudBase Taiwan</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 4, backgroundColor: '#EF444422', color: '#EF4444', fontWeight: 700 }}>HOT</span>
            <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 4, backgroundColor: `${SUCCESS}22`, color: SUCCESS, fontWeight: 700 }}>ICP 9/10</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: ACCENT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>🔗 連結請求</div>
            <div style={{ backgroundColor: SURFACE_RAISED, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px', fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.7, minHeight: 140, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
              {msgType.replace(CONN_MSG, CONN_MSG)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#F59E0B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>💡 價值消息</div>
            <div style={{ backgroundColor: SURFACE_RAISED, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px', fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.7, minHeight: 140, whiteSpace: 'pre-wrap', opacity: subStep >= 3 ? 1 : 0, transition: 'opacity 0.6s' }}>{VALUE_MSG}</div>
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={{ padding: '7px 16px', borderRadius: 7, border: `1px solid ${BORDER}`, background: 'transparent', color: TEXT_SECONDARY, fontSize: 12, cursor: 'pointer' }}>📋 複製連結請求</button>
          <button style={{ padding: '7px 16px', borderRadius: 7, border: `1px solid ${BORDER}`, background: 'transparent', color: TEXT_SECONDARY, fontSize: 12, cursor: 'pointer' }}>📋 複製價值消息</button>
        </div>
      </div>
    ))
  }

  // Slide 4: Import success
  if (step === 4) {
    return fakeWindow('app.aitokenking.com/import — 導入完成', (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16, animation: 'bounceIn 0.5s' }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>導入成功！</div>
        <div style={{ fontSize: 13, color: TEXT_MUTED, marginBottom: 28 }}>Taiwan · Combo A/B/C · 已分配給 SDR 王大明</div>
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[{ n: 142, label: '成功導入', color: SUCCESS }, { n: 8, label: '重複跳過', color: '#F59E0B' }, { n: 6, label: '無姓名', color: TEXT_MUTED }, { n: 0, label: '錯誤', color: '#EF4444' }].map(r => (
            <div key={r.label} style={{ textAlign: 'center', minWidth: 80 }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: r.color, fontFamily: 'monospace' }}>{r.n}</div>
              <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>{r.label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 28, backgroundColor: SURFACE_RAISED, borderRadius: 10, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: ACCENT, animation: 'pulse 1.5s infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>142 個潛在客戶已進入看板「New」欄位，等待觸達</span>
        </div>
      </div>
    ))
  }

  // Slide 5: Sending connection request (LinkedIn-style)
  if (step === 5) {
    return (
      <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', gap: 16 }}>
        {fakeWindow('app.aitokenking.com/kanban — 陳怡婷', (
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: `${ACCENT}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#A78BFA' }}>陳</div>
              <div><div style={{ fontSize: 13, fontWeight: 700 }}>陳怡婷</div><div style={{ fontSize: 11, color: TEXT_MUTED }}>VP Growth · CloudBase Taiwan</div></div>
              <div style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 4, backgroundColor: `${ACCENT}22`, color: '#A78BFA' }}>New</div>
            </div>
            <div style={{ backgroundColor: SURFACE_RAISED, borderRadius: 8, padding: '12px 14px', fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.7, marginBottom: 14, whiteSpace: 'pre-wrap' }}>{CONN_MSG}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{
                padding: '8px 20px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                backgroundColor: subStep >= 2 ? `${SUCCESS}22` : ACCENT,
                color: subStep >= 2 ? SUCCESS : '#fff',
                border: subStep >= 2 ? `1px solid ${SUCCESS}` : 'none',
                transition: 'all 0.4s',
              }}>
                {subStep >= 2 ? '✓ 已在 LinkedIn 發送' : '📤 發送連結請求'}
              </div>
            </div>
            {subStep >= 2 && (
              <div style={{ marginTop: 12, fontSize: 11, color: TEXT_MUTED, textAlign: 'center' }}>狀態已自動更新為「Connection Sent」</div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // Slide 6: They replied
  if (step === 6) {
    return fakeWindow('app.aitokenking.com/kanban — 對話記錄', (
      <div style={{ padding: 20 }}>
        {subStep >= 0 && (
          <div style={{ marginBottom: 12, backgroundColor: `${ACCENT}15`, border: `1px solid ${ACCENT}40`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, animation: 'slideIn 0.4s' }}>
            <span style={{ fontSize: 20 }}>🎉</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#A78BFA' }}>陳怡婷接受了您的連結請求！</div>
              <div style={{ fontSize: 11, color: TEXT_MUTED }}>週二 14:30 · 系統自動更新狀態：Connected</div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {CONVO.slice(0, subStep >= 1 ? 2 : 1).map((msg, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: msg.side === 'us' ? 'row-reverse' : 'row', gap: 8, opacity: 1, transition: 'opacity 0.3s' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: msg.side === 'us' ? `${ACCENT}30` : '#F59E0B30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: msg.side === 'us' ? '#A78BFA' : '#F59E0B', flexShrink: 0 }}>
                {msg.side === 'us' ? '我' : '陳'}
              </div>
              <div style={{ maxWidth: '75%' }}>
                <div style={{ backgroundColor: msg.side === 'us' ? `${ACCENT}22` : SURFACE_RAISED, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#F0F0F5', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                <div style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 4, textAlign: msg.side === 'us' ? 'right' : 'left' }}>{msg.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ))
  }

  // Slide 7: Schedule call
  if (step === 7) {
    return fakeWindow('app.aitokenking.com/kanban — 約定通話', (
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {[...CONVO, ...FOLLOW_UP].slice(0, subStep + 2).map((msg, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: msg.side === 'us' ? 'row-reverse' : 'row', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: msg.side === 'us' ? `${ACCENT}30` : '#F59E0B30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: msg.side === 'us' ? '#A78BFA' : '#F59E0B', flexShrink: 0 }}>
                {msg.side === 'us' ? '我' : '陳'}
              </div>
              <div style={{ maxWidth: '72%' }}>
                <div style={{ backgroundColor: msg.side === 'us' ? `${ACCENT}22` : SURFACE_RAISED, borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#F0F0F5', lineHeight: 1.6 }}>{msg.text}</div>
                <div style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 3, textAlign: msg.side === 'us' ? 'right' : 'left' }}>{msg.time}</div>
              </div>
            </div>
          ))}
        </div>
        {subStep >= 4 && (
          <div style={{ backgroundColor: `${SUCCESS}15`, border: `1px solid ${SUCCESS}44`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, animation: 'slideIn 0.4s' }}>
            <span style={{ fontSize: 28 }}>🗓</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: SUCCESS }}>通話已確認！</div>
              <div style={{ fontSize: 12, color: TEXT_MUTED }}>週四 14:00–14:20 · 陳怡婷 & AITokenKing · Google Meet</div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 12px', borderRadius: 6, backgroundColor: `${SUCCESS}22`, color: SUCCESS, fontWeight: 600, whiteSpace: 'nowrap' }}>Demo Scheduled</div>
          </div>
        )}
      </div>
    ))
  }

  return null
}

function DemoModal({ onClose }: { onClose: () => void }) {
  const [currentStep, setCurrentStep] = useState(0)
  const [subStep, setSubStep] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progressPct, setProgressPct] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stepDuration = STEPS[currentStep]?.duration ?? 5000

  const goTo = useCallback((n: number) => {
    setCurrentStep(Math.max(0, Math.min(n, STEPS.length - 1)))
    setSubStep(0)
    setProgressPct(0)
  }, [])

  // Auto-advance
  useEffect(() => {
    if (paused) return
    setProgressPct(0)
    if (progressRef.current) clearInterval(progressRef.current)
    progressRef.current = setInterval(() => {
      setProgressPct(p => Math.min(p + (100 / (stepDuration / 80)), 100))
    }, 80)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setCurrentStep(s => {
        if (s < STEPS.length - 1) { setSubStep(0); setProgressPct(0); return s + 1 }
        return s
      })
    }, stepDuration)
    return () => { if (timerRef.current) clearTimeout(timerRef.current); if (progressRef.current) clearInterval(progressRef.current) }
  }, [currentStep, paused, stepDuration])

  // Sub-step animator
  useEffect(() => {
    const id = setInterval(() => setSubStep(s => s + 1), 700)
    return () => clearInterval(id)
  }, [currentStep])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(currentStep + 1)
      if (e.key === 'ArrowLeft') goTo(currentStep - 1)
      if (e.key === 'Escape') onClose()
      if (e.key === ' ') { e.preventDefault(); setPaused(p => !p) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentStep, goTo, onClose])

  const step = STEPS[currentStep]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes bounceIn { 0%{transform:scale(0)} 60%{transform:scale(1.15)} 100%{transform:scale(1)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
      `}</style>

      {/* Progress bar */}
      <div style={{ height: 3, backgroundColor: BORDER, flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${progressPct}%`, backgroundColor: ACCENT, transition: 'width 0.08s linear' }} />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, background: `linear-gradient(135deg, ${ACCENT}, #A78BFA)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AITokenKing</div>
          <span style={{ fontSize: 12, color: TEXT_MUTED }}>產品演示</span>
          <span style={{ fontSize: 11, backgroundColor: `${ACCENT}22`, color: '#A78BFA', padding: '2px 10px', borderRadius: 10, border: `1px solid ${ACCENT}44` }}>中文版</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setPaused(p => !p)} style={{ background: 'none', border: `1px solid ${BORDER}`, color: TEXT_SECONDARY, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
            {paused ? '▶ 繼續' : '⏸ 暫停'}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${BORDER}`, color: TEXT_SECONDARY, borderRadius: 6, padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}>✕ 關閉</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Step navigator */}
        <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${BORDER}`, padding: '20px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {STEPS.map((s, i) => (
            <button key={i} onClick={() => goTo(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: 'none', background: i === currentStep ? `${ACCENT}20` : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'background 0.2s' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, backgroundColor: i < currentStep ? SUCCESS : i === currentStep ? ACCENT : BORDER, color: i <= currentStep ? '#fff' : TEXT_MUTED }}>
                {i < currentStep ? '✓' : s.num}
              </span>
              <span style={{ fontSize: 12, fontWeight: i === currentStep ? 600 : 400, color: i === currentStep ? '#F0F0F5' : TEXT_MUTED, lineHeight: 1.3 }}>{s.label}</span>
            </button>
          ))}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Slide title */}
          <div style={{ padding: '20px 28px 12px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: ACCENT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>步驟 {step.num} / {STEPS.length.toString().padStart(2,'0')}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#F0F0F5' }}>{step.title}</div>
          </div>

          {/* Slide content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', alignItems: 'flex-start' }}>
            <SlideContent step={currentStep} subStep={subStep} />
          </div>

          {/* Narration + controls */}
          <div style={{ borderTop: `1px solid ${BORDER}`, padding: '16px 28px', flexShrink: 0, display: 'flex', gap: 20, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: ACCENT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>🎙 旁白</div>
              <div style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.65, maxWidth: 680 }}>{step.narration}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => goTo(currentStep - 1)} disabled={currentStep === 0} style={{ padding: '8px 18px', borderRadius: 7, border: `1px solid ${BORDER}`, background: 'transparent', color: currentStep === 0 ? TEXT_MUTED : TEXT_SECONDARY, cursor: currentStep === 0 ? 'not-allowed' : 'pointer', fontSize: 13 }}>← 上一步</button>
              {currentStep < STEPS.length - 1
                ? <button onClick={() => goTo(currentStep + 1)} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: ACCENT, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>下一步 →</button>
                : <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: SUCCESS, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>完成演示 ✓</button>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── LANDING PAGE ─────────────────────────── */

const features = [
  { icon: '📋', title: 'Kanban Pipeline', desc: 'Drag-and-drop cards through every outreach stage. Custom columns, colors, and stage names per organization.' },
  { icon: '🤖', title: 'LinkedIn Scraper', desc: 'AI-powered scraping — select audience combos, launch a run, get ICP-scored leads with generated outreach messages ready to copy.' },
  { icon: '🌏', title: 'Multi-Region SDRs', desc: 'Assign reps to specific markets. Each SDR sees only their area — full DB-level isolation via Supabase RLS policies.' },
  { icon: '📊', title: 'Analytics Dashboard', desc: 'Conversion rates by SDR and by region, temperature breakdowns, weekly velocity. Benchmarkable data for every team member.' },
  { icon: '💬', title: 'Conversation Logging', desc: 'Upload and archive every closed-deal chat. Search, filter, and replay conversations across your entire closed-deals history.' },
  { icon: '🛡️', title: 'Enterprise Security', desc: 'Supabase RLS policies enforce data isolation at the DB layer. Service-role key never leaves the server. Full audit trail.' },
  { icon: '📥', title: 'CSV Import Wizard', desc: '5-step import: upload → area → column mapping → duplicate detection → results. Handles LinkedIn exports out of the box.' },
  { icon: '🏢', title: 'Global Admin Plane', desc: 'Manage every client org from a single control plane. Edit plans, toggle addons, impersonate any org in read-only mode.' },
]

const steps = [
  { n: '01', title: 'Scrape LinkedIn', desc: 'Launch a scraper run against your target audience. AI scores each lead and drafts personalized outreach messages.' },
  { n: '02', title: 'Import to CRM', desc: 'One-click import from scraper → CRM. Dedup check runs automatically. Leads land in the right SDR\'s queue.' },
  { n: '03', title: 'Work the Pipeline', desc: 'SDRs drag cards through the kanban as they progress. Every status change is logged in the immutable audit trail.' },
  { n: '04', title: 'Close & Log', desc: 'Mark a deal closed, upload the conversation log. Your team\'s entire conversion history is searchable and analyzable.' },
]

const plans = [
  { name: 'Basic', price: '$550', seats: '3 seats', leads: '1,000 leads/mo', color: '#3B82F6', highlight: false, features: ['Kanban pipeline', 'CSV import', 'Scraper access', 'Audit log'] },
  { name: 'Premium', price: '$2,300', seats: '10 seats', leads: '3,000 leads/mo', color: ACCENT, highlight: true, features: ['Everything in Basic', 'Analytics dashboard', 'Multi-region SDRs', 'Support tickets'] },
  { name: 'Enterprise', price: 'Custom', seats: '15 seats', leads: '10,000 leads/mo', color: '#F59E0B', highlight: false, features: ['Everything in Premium', 'Custom pipeline stages', 'Account management', 'Priority support'] },
  { name: 'Ultra', price: 'Internal', seats: 'Unlimited', leads: 'Unlimited', color: '#EF4444', highlight: false, features: ['Unlimited everything', 'All add-ons included', 'SSO integration', 'Dedicated infra'] },
]

export default function LandingPage() {
  const [hovered, setHovered] = useState<number | null>(null)
  const [showDemo, setShowDemo] = useState(false)

  return (
    <>
      {showDemo && <DemoModal onClose={() => setShowDemo(false)} />}

      <div style={S.page}>
        <style>{`
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
          * { box-sizing: border-box; }
        `}</style>

        {/* Nav */}
        <nav style={S.nav}>
          <div style={S.logo}>AITokenKing</div>
          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
            <a href="#features" style={S.navLink}>Features</a>
            <a href="#how" style={S.navLink}>How it works</a>
            <a href="#pricing" style={S.navLink}>Pricing</a>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <a href="/en/login" style={S.btnSecondary}>Log in</a>
            <a href="/en/login" style={S.btnPrimary}>Get started</a>
          </div>
        </nav>

        {/* Hero */}
        <div style={{ ...S.section, paddingBottom: 40, textAlign: 'center' }}>
          <div style={S.chip}>⚡ B2B LinkedIn Outreach Platform</div>
          <h1 style={S.h1}>
            Close more deals with{' '}
            <span style={{ background: `linear-gradient(135deg, ${ACCENT}, #A78BFA)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AI-powered</span>
            <br />LinkedIn outreach
          </h1>
          <p style={{ fontSize: 20, color: TEXT_SECONDARY, maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.6 }}>
            From prospect scraping to closed deal — one platform for your entire outreach team. Built for multi-region sales teams that need real data isolation and accountability.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/en/login" style={{ ...S.btnPrimary, padding: '14px 32px', fontSize: 16, borderRadius: 10, boxShadow: `0 4px 24px ${ACCENT}40` }}>
              Start free trial
            </a>
            <button
              onClick={() => setShowDemo(true)}
              style={{ ...S.btnSecondary, padding: '14px 32px', fontSize: 16, borderRadius: 10 }}
            >
              ▶ Watch demo 中文
            </button>
          </div>
          <div style={{ marginTop: 48, display: 'flex', justifyContent: 'center', gap: 40, flexWrap: 'wrap' }}>
            {[['10K+', 'Leads managed'], ['97%', 'Import accuracy'], ['4 markets', 'Taiwan · LATAM · VN · EU'], ['< 2min', 'Avg time to import']].map(([stat, label]) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#F0F0F5' }}>{stat}</div>
                <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* App preview mockup */}
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 40px 80px' }}>
          <div style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', boxShadow: `0 32px 80px rgba(0,0,0,0.5)` }}>
            <div style={{ backgroundColor: SURFACE_RAISED, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#EF4444' }} />
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#F59E0B' }} />
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: SUCCESS }} />
              <div style={{ flex: 1, backgroundColor: BG, borderRadius: 6, padding: '4px 12px', fontSize: 12, color: TEXT_MUTED, marginLeft: 8 }}>app.aitokenking.com/kanban</div>
            </div>
            <div style={{ padding: 24, display: 'flex', gap: 14, overflowX: 'auto' }}>
              {[
                { stage: 'New', color: '#3B82F6', cards: ['Sarah Chen — Acme Corp', 'James Liu — TechVentures', 'Ana García — DataFlow'] },
                { stage: 'Connection Sent', color: '#8B5CF6', cards: ['Wei Zhang — NovaSoft', 'Carlos Mendez — LatamAI'] },
                { stage: 'Connected', color: ACCENT, cards: ['Yuki Tanaka — CloudBase', 'Mei Lin — FinTechPro', 'Diego Ruiz — MarketAI'] },
                { stage: 'Demo Scheduled', color: SUCCESS, cards: ['Park Jimin — SeoulTech'] },
                { stage: 'Closed', color: '#F59E0B', cards: ['Raj Patel — IndiaFirst', 'Emma Wilson — EuroTech'] },
              ].map(({ stage, color, cards }) => (
                <div key={stage} style={{ minWidth: 200, flex: '0 0 200px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: TEXT_SECONDARY }}>{stage}</span>
                    <span style={{ fontSize: 11, color: TEXT_MUTED, marginLeft: 'auto' }}>{cards.length}</span>
                  </div>
                  {cards.map(card => (
                    <div key={card} style={{ backgroundColor: SURFACE_RAISED, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#F0F0F5', marginBottom: 3 }}>{card.split(' — ')[0]}</div>
                      <div style={{ fontSize: 11, color: TEXT_MUTED }}>{card.split(' — ')[1]}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                        <span style={{ fontSize: 10, backgroundColor: `${color}22`, color, borderRadius: 4, padding: '1px 6px' }}>WARM</span>
                        <span style={{ fontSize: 10, backgroundColor: `${ACCENT}22`, color: '#A78BFA', borderRadius: 4, padding: '1px 6px' }}>ICP 8</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Features */}
        <div id="features" style={{ ...S.section, paddingTop: 60 }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={S.chip}>Features</div>
            <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px', margin: '0 0 16px' }}>Everything your team needs</h2>
            <p style={{ fontSize: 17, color: TEXT_SECONDARY, maxWidth: 500, margin: '0 auto' }}>From first contact to closed deal, every workflow is covered.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {features.map((f, i) => (
              <div key={f.title} style={{ ...S.featureCard, borderColor: hovered === i ? ACCENT + '60' : BORDER, transform: hovered === i ? 'translateY(-3px)' : 'none' }}
                onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: '#F0F0F5' }}>{f.title}</div>
                <div style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div id="how" style={{ backgroundColor: SURFACE, borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ ...S.section, paddingTop: 70, paddingBottom: 70 }}>
            <div style={{ textAlign: 'center', marginBottom: 56 }}>
              <div style={S.chip}>How it works</div>
              <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px', margin: '0 0 16px' }}>From zero to closed deal in 4 steps</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 32 }}>
              {steps.map((step, i) => (
                <div key={step.n} style={{ position: 'relative' }}>
                  <div style={{ fontSize: 48, fontWeight: 900, color: BORDER, lineHeight: 1, marginBottom: 16, fontFamily: 'monospace' }}>{step.n}</div>
                  <div style={{ position: 'absolute', top: 24, left: 0, width: 3, height: 40, backgroundColor: ACCENT, borderRadius: 2 }} />
                  <div style={{ paddingLeft: 16 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: '#F0F0F5' }}>{step.title}</div>
                    <div style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.6 }}>{step.desc}</div>
                  </div>
                  {i < steps.length - 1 && <div style={{ position: 'absolute', top: 32, right: -16, fontSize: 20, color: TEXT_MUTED }}>→</div>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div id="pricing" style={S.section}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={S.chip}>Pricing</div>
            <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px', margin: '0 0 16px' }}>Simple, transparent pricing</h2>
            <p style={{ fontSize: 17, color: TEXT_SECONDARY }}>Scale as your team grows. Switch plans anytime.</p>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {plans.map(plan => (
              <div key={plan.name} style={{ ...(plan.highlight ? { backgroundColor: `${ACCENT}10`, border: `2px solid ${ACCENT}`, borderRadius: 16, padding: '32px 28px', flex: 1, minWidth: 220, position: 'relative' } : { backgroundColor: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '32px 28px', flex: 1, minWidth: 220 }) }}>
                {plan.highlight && <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', backgroundColor: ACCENT, color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 14px', borderRadius: 20, whiteSpace: 'nowrap' }}>Most Popular</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: plan.color }} />
                  <div style={{ fontSize: 16, fontWeight: 700, color: plan.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{plan.name}</div>
                </div>
                <div style={{ fontSize: 38, fontWeight: 900, letterSpacing: '-1px', margin: '12px 0 4px', color: '#F0F0F5' }}>
                  {plan.price}{plan.price !== 'Custom' && plan.price !== 'Internal' && <span style={{ fontSize: 16, fontWeight: 400, color: TEXT_SECONDARY }}>/mo</span>}
                </div>
                <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 24 }}>{plan.seats} · {plan.leads}</div>
                <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {plan.features.map(f => (
                    <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ color: SUCCESS, fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>✓</span>
                      <span style={{ fontSize: 13, color: TEXT_SECONDARY, lineHeight: 1.4 }}>{f}</span>
                    </div>
                  ))}
                </div>
                <a href="/en/login" style={{ display: 'block', marginTop: 28, textAlign: 'center', padding: '11px', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none', backgroundColor: plan.highlight ? ACCENT : 'transparent', color: plan.highlight ? '#fff' : TEXT_SECONDARY, border: plan.highlight ? 'none' : `1px solid ${BORDER}` }}>
                  {plan.price === 'Custom' || plan.price === 'Internal' ? 'Contact us' : 'Get started'}
                </a>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ background: `linear-gradient(135deg, ${ACCENT}20, #A78BFA10)`, borderTop: `1px solid ${ACCENT}30`, borderBottom: `1px solid ${ACCENT}30` }}>
          <div style={{ ...S.section, paddingTop: 70, paddingBottom: 70, textAlign: 'center' }}>
            <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px', margin: '0 0 16px' }}>Ready to scale your outreach?</h2>
            <p style={{ fontSize: 17, color: TEXT_SECONDARY, maxWidth: 480, margin: '0 auto 36px' }}>Get your team set up in minutes. Import your first leads the same day.</p>
            <a href="/en/login" style={{ ...S.btnPrimary, padding: '16px 40px', fontSize: 16, borderRadius: 10, boxShadow: `0 4px 32px ${ACCENT}50` }}>Get started for free</a>
          </div>
        </div>

        {/* Footer */}
        <footer style={{ borderTop: `1px solid ${BORDER}`, padding: '32px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={S.logo}>AITokenKing</div>
          <div style={{ display: 'flex', gap: 24 }}>
            {['Features', 'Pricing', 'Support', 'Login'].map(l => (
              <a key={l} href={l === 'Login' ? '/en/login' : `#${l.toLowerCase()}`} style={{ fontSize: 13, color: TEXT_MUTED, textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
          <div style={{ fontSize: 12, color: TEXT_MUTED }}>© 2025 AITokenKing. All rights reserved.</div>
        </footer>
      </div>
    </>
  )
}
