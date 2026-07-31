'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  LayoutGrid, Users, PlayCircle, Handshake, MessageSquare, BarChart3,
  Loader2, Check, X, ChevronRight, Building2,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  PieChart, Pie,
} from 'recharts'

/**
 * An interactive stand-in for the product, embedded in the landing page.
 *
 * It is a MOCKUP, not the app: no network, no auth, no database. Everything
 * is local state over fixed sample data, so it can be clicked freely by an
 * anonymous visitor and can never expose a real prospect. The names,
 * companies, bios and message bodies below are invented for exactly that
 * reason, and are deliberately NOT translated — the same way a real
 * screenshot wouldn't change language depending on who's viewing the landing
 * page. Only the screen chrome (nav labels, headers, buttons, status
 * vocabulary) goes through next-intl, because that's what a real user of any
 * locale would actually see translated.
 *
 * It stays dark in both landing themes (see theme.css, `.ld-app`) because the
 * product itself is dark-only — a light version would advertise an interface
 * that does not exist.
 */

export type Screen = 'kanban' | 'leads' | 'conversations' | 'run' | 'bridge' | 'analytics'

type Demo = {
  id: string
  name: string
  company: string
  title: string
  market: string
  score: number
  temp: 'Hot' | 'Warm' | 'Cold'
  status: string
  starred?: boolean
}

// Deliberately invented. Mirrors the shape of a real pipeline — a few very
// strong leads, a long warm middle, some cold, one closed, one in nurture —
// so the screen looks like work in progress rather than a showroom where
// everything is perfect.
const DEMO: Demo[] = [
  { id: 'chen', name: 'Chen Wei-Lin', company: 'Nexora Semiconductor', title: 'Chief Information Officer', market: 'Taiwan', score: 94, temp: 'Hot', status: 'demo_scheduled', starred: true },
  { id: 'aiko', name: 'Aiko Tanaka', company: 'Meridian Robotics', title: 'VP of Engineering', market: 'Japan', score: 91, temp: 'Hot', status: 'replied', starred: true },
  { id: 'marcus', name: 'Marcus Lindqvist', company: 'Northwind Analytics', title: 'Head of IT', market: 'Singapore', score: 88, temp: 'Hot', status: 'replied' },
  { id: 'priya', name: 'Priya Raghavan', company: 'Lumen Data Systems', title: 'IT Director', market: 'India', score: 86, temp: 'Hot', status: 'connected' },
  { id: 'daniel', name: 'Daniel Okafor', company: 'Vertex Cloud', title: 'CTO', market: 'Singapore', score: 85, temp: 'Hot', status: 'connected' },
  { id: 'sofia', name: 'Sofia Marchetti', company: 'Aurora Logistics', title: 'Chief Digital Officer', market: 'Malaysia', score: 83, temp: 'Hot', status: 'connected' },
  { id: 'minjun', name: 'Kim Min-Jun', company: 'Halcyon Payments', title: 'Head of Technology', market: 'South Korea', score: 81, temp: 'Hot', status: 'connection_sent' },
  { id: 'carlos', name: 'Carlos Mendoza', company: 'Vertika Soluciones', title: 'Director de Tecnología', market: 'Mexico', score: 82, temp: 'Hot', status: 'replied' },
  { id: 'elena', name: 'Elena Petrova', company: 'Cobalt Manufacturing', title: 'IT Manager', market: 'Vietnam', score: 78, temp: 'Hot', status: 'replied' },
  { id: 'yuhsuan', name: 'Lin Yu-Hsuan', company: 'Skyline Media Group', title: 'Systems Manager', market: 'Taiwan', score: 75, temp: 'Hot', status: 'connection_sent' },
  { id: 'rafael', name: 'Rafael Duarte', company: 'Solstice Retail', title: 'IT Operations Manager', market: 'Philippines', score: 72, temp: 'Hot', status: 'new' },
  { id: 'isabelle', name: 'Isabelle Laurent', company: 'Solvex Materials', title: 'VP Operations', market: 'France', score: 90, temp: 'Hot', status: 'closed' },
  { id: 'hannah', name: 'Hannah Brooks', company: 'Quantum Freight', title: 'Digital Transformation Lead', market: 'Australia', score: 68, temp: 'Warm', status: 'connected' },
  { id: 'tomas', name: 'Tomas Nowak', company: 'Pinewood Chemicals', title: 'Head of IT', market: 'Thailand', score: 65, temp: 'Warm', status: 'connection_sent' },
  { id: 'yuki', name: 'Yuki Nakamura', company: 'Crestline Insurance', title: 'IT Director', market: 'Japan', score: 63, temp: 'Warm', status: 'connection_sent' },
  { id: 'omar', name: 'Omar Haddad', company: 'Vantage Energy', title: 'Systems Architect', market: 'Saudi Arabia', score: 61, temp: 'Warm', status: 'new' },
  { id: 'grace', name: 'Grace Wong', company: 'Ember Hospitality', title: 'IT Manager', market: 'Hong Kong', score: 58, temp: 'Warm', status: 'new' },
  { id: 'lucas', name: 'Lucas Ferreira', company: 'Trailhead Agritech', title: 'Head of Systems', market: 'Indonesia', score: 55, temp: 'Warm', status: 'new' },
  { id: 'peter', name: 'Peter Andersson', company: 'Granite Construction', title: 'Technology Manager', market: 'New Zealand', score: 48, temp: 'Cold', status: 'new' },
  { id: 'meiling', name: 'Mei-Ling Chou', company: 'Silverpine Foods', title: 'Office IT Lead', market: 'Taiwan', score: 44, temp: 'Cold', status: 'nurture' },
]

const COLUMNS = ['new', 'connection_sent', 'connected', 'replied', 'demo_scheduled', 'closed', 'nurture'] as const

const STATUS_COLOR: Record<string, string> = {
  new: '#6C63FF', connection_sent: '#3B82F6', connected: '#22C55E',
  replied: '#F59E0B', demo_scheduled: '#EC4899', closed: '#22C55E', nurture: '#8B8BA0',
}
const TEMP_COLOR: Record<string, string> = { Hot: '#F87171', Warm: '#FBBF24', Cold: '#60A5FA' }

function scoreColor(n: number) {
  if (n >= 70) return '#22C55E'
  if (n >= 50) return '#F59E0B'
  return '#EF4444'
}

const MARKETS = ['Taiwan', 'Japan', 'Singapore', 'South Korea', 'Hong Kong', 'Vietnam', 'Malaysia', 'India']

// A handful of leads "discovered" live while a run animates, distinct from
// the pipeline above so the run screen reads as its own moment rather than a
// rerun of the Leads table.
const LIVE_FOUND = [
  { name: 'Nathan Cole', company: 'Brightline Freight', title: 'IT Director' },
  { name: 'Sakura Ito', company: 'Kaida Robotics', title: 'Head of Engineering' },
  { name: 'Wen Jia-Hao', company: 'Formosa Cloud', title: 'CTO' },
  { name: 'Aditya Rao', company: 'Skyforge Analytics', title: 'VP Technology' },
  { name: 'Choi Ye-Jin', company: 'Hanbit Systems', title: 'IT Manager' },
  { name: 'Farah Zainal', company: 'Meridian Retail', title: 'Digital Lead' },
]

// Deliberately invented, contextualized to each lead's own company — and
// deliberately written in FOUR different real languages, not translated
// per landing locale. This is the whole point of the screen: the product
// generates outreach in the language of the prospect's own market, so the
// proof has to be multi-language regardless of which locale the visitor is
// currently browsing the landing page in. Mixing zh-TW / es / vi / en here
// is the demo, not an oversight — see THREAD_LANG below for the labels.
const THREADS: Record<string, Array<{ side: 'us' | 'them'; text: string; time: string }>> = {
  chen: [
    { side: 'us', text: '陳先生您好，注意到 Nexora Semiconductor 最近在積極擴編雲端基礎架構團隊，想和您分享類似團隊如何把開發時間縮短一半。這週方便簡短聊聊嗎？', time: '週一 10:12' },
    { side: 'them', text: '您好，謝謝您的訊息。我們確實在尋找加快海外業務開發速度的方法，很樂意多了解一些。', time: '週一 15:47' },
    { side: 'us', text: '太好了——星期四下午兩點方便通話 20 分鐘嗎？我會先寄出行事曆邀請。', time: '週二 09:03' },
    { side: 'them', text: '星期四兩點沒問題，到時候見！', time: '週二 11:20' },
  ],
  carlos: [
    { side: 'us', text: 'Hola Carlos, vi que Vertika Soluciones viene creciendo rápido en el mercado mexicano — me encantaría contarte cómo equipos similares están acelerando la prospección internacional. ¿Tenés unos minutos esta semana?', time: 'Jue 09:40' },
    { side: 'them', text: '¡Hola! Gracias por escribir. Justo estamos evaluando cómo mejorar nuestro proceso de ventas hacia otros países de LATAM. Contame más.', time: 'Jue 14:15' },
  ],
  elena: [
    { side: 'us', text: 'Chào chị Elena, tôi thấy Cobalt Manufacturing gần đây đang mở rộng dây chuyền sản xuất tại Việt Nam — rất muốn chia sẻ cách các đội tương tự đang tăng tốc việc tìm kiếm khách hàng quốc tế. Tuần này chị có vài phút để trao đổi nhanh không?', time: 'Th4 09:20' },
    { side: 'them', text: 'Chào anh, cảm ơn đã liên hệ. Bên em đang tìm cách cải thiện quy trình tiếp cận khách hàng ở nước ngoài, rất muốn nghe thêm.', time: 'Th4 13:50' },
  ],
  daniel: [
    { side: 'us', text: 'Hi Daniel, saw Vertex Cloud just opened a Singapore office — congrats on the expansion. Would love to connect and share what we’re seeing work for teams scaling across APAC.', time: 'Fri 16:50' },
  ],
}
const THREAD_LEAD_IDS = ['chen', 'carlos', 'elena', 'daniel'] as const
const THREAD_LANG: Record<string, string> = { chen: '繁中', carlos: 'Español', elena: 'Tiếng Việt', daniel: 'English' }

type BridgeStatus = 'pending' | 'confirmed' | 'rejected'
type BridgeContact = { id: string; name: string; title: string; location: string; bio: string }
const BRIDGE_COMPANIES: Array<{ company: string; contacts: BridgeContact[] }> = [
  {
    company: 'CloudBridge Systems',
    contacts: [
      { id: 'mark', name: 'Mark Chen', title: 'VP Partnerships', location: 'Singapore', bio: '10+ years building channel programs for SaaS companies expanding into APAC.' },
      { id: 'lucia', name: 'Lucia Fernandez', title: 'Head of Business Development', location: 'Singapore', bio: 'Leads BD for cloud infrastructure partnerships across Southeast Asia.' },
    ],
  },
  {
    company: 'DataForge Partners',
    contacts: [
      { id: 'ravi', name: 'Ravi Shankar', title: 'Managing Director', location: 'India', bio: 'Runs a boutique systems-integration firm serving mid-market enterprises.' },
    ],
  },
]

export function ProductDemo({
  screen: controlledScreen, onScreenChange,
}: {
  // Both optional: the "How it works" steps below the demo drive it from
  // outside (clicking "Personalized messages" jumps straight to the
  // Messages screen), but the component still works standalone with no
  // props — same fallback-to-internal-state pattern as a controlled <input>.
  screen?: Screen
  onScreenChange?: (s: Screen) => void
} = {}) {
  const t = useTranslations('landing')
  const [internalScreen, setInternalScreen] = useState<Screen>('kanban')
  const screen = controlledScreen ?? internalScreen
  const setScreen = onScreenChange ?? setInternalScreen

  // ── New Run simulation ────────────────────────────────────────────────
  const [picked, setPicked] = useState<string[]>(['Taiwan', 'Japan', 'Singapore'])
  const [runState, setRunState] = useState<'idle' | 'running' | 'done'>('idle')
  const [found, setFound] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Every timer is tracked and cleared on unmount: this component lives on a
  // public page where people navigate away mid-animation, and a stray timer
  // calling setState afterwards is a console error visitors would see.
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  function startRun() {
    if (runState === 'running') return
    timers.current.forEach(clearTimeout)
    timers.current = []
    setRunState('running')
    setFound(0)
    const target = 25
    for (let i = 1; i <= target; i++) {
      timers.current.push(setTimeout(() => setFound(i), 90 * i))
    }
    timers.current.push(setTimeout(() => setRunState('done'), 90 * target + 350))
  }

  function resetRun() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setRunState('idle')
    setFound(0)
  }

  // ── Conversations ────────────────────────────────────────────────────
  const [activeThread, setActiveThread] = useState<string>('chen')

  // ── Bridge ────────────────────────────────────────────────────────────
  const [bridgeStatus, setBridgeStatus] = useState<Record<string, BridgeStatus>>({})

  const NAV: Array<{ key: Screen; icon: typeof LayoutGrid; label: string }> = [
    { key: 'kanban', icon: LayoutGrid, label: t('demoNavPipeline') },
    { key: 'leads', icon: Users, label: t('demoNavLeads') },
    { key: 'conversations', icon: MessageSquare, label: t('demoNavConversations') },
    { key: 'run', icon: PlayCircle, label: t('demoNavRun') },
    { key: 'bridge', icon: Handshake, label: t('demoNavBridge') },
    { key: 'analytics', icon: BarChart3, label: t('demoNavAnalytics') },
  ]

  return (
    <div
      className="ld-app"
      style={{
        border: '1px solid var(--ld-app-border)', borderRadius: 14, overflow: 'hidden',
        boxShadow: 'var(--ld-shadow)', display: 'flex', minHeight: 560, fontSize: 13,
      }}
    >
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside style={{
        width: 184, flexShrink: 0, borderRight: '1px solid var(--ld-app-border)',
        background: 'var(--ld-app-surface)', padding: '14px 10px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ padding: '0 8px 14px', fontSize: 13, fontWeight: 800, letterSpacing: '-0.3px' }}>
          <span style={{ color: 'var(--ld-app-text)' }}>Your</span>
          <span style={{ color: 'var(--ld-app-accent)' }}>CRM</span>
        </div>

        {NAV.map(item => {
          const active = screen === item.key
          const Icon = item.icon
          return (
            <button
              key={item.key}
              onClick={() => setScreen(item.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: active ? 'var(--ld-app-accent)' : 'transparent',
                color: active ? '#FFF' : 'var(--ld-app-soft)',
                fontSize: 12.5, fontWeight: active ? 600 : 500, textAlign: 'left',
                transition: 'background .15s, color .15s',
              }}
            >
              <Icon size={15} />
              {item.label}
            </button>
          )
        })}

        <div style={{ marginTop: 'auto', padding: '10px 8px 0', borderTop: '1px solid var(--ld-app-border)' }}>
          <div style={{ fontSize: 11, color: 'var(--ld-app-soft)', fontWeight: 600 }}>{t('demoUser')}</div>
          <div style={{ fontSize: 10, color: 'var(--ld-app-muted)' }}>{t('demoUserRole')}</div>
        </div>
      </aside>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, background: 'var(--ld-app-bg)', padding: 16, overflow: 'hidden' }}>
        {screen === 'kanban' && <KanbanView t={t} />}
        {screen === 'leads' && <LeadsView t={t} />}
        {screen === 'conversations' && (
          <ConversationsView t={t} activeThread={activeThread} setActiveThread={setActiveThread} />
        )}
        {screen === 'run' && (
          <RunView
            t={t} picked={picked} setPicked={setPicked}
            runState={runState} found={found} startRun={startRun} resetRun={resetRun}
          />
        )}
        {screen === 'bridge' && (
          <BridgeView t={t} status={bridgeStatus} setStatus={setBridgeStatus} />
        )}
        {screen === 'analytics' && <AnalyticsView t={t} />}
      </div>
    </div>
  )
}

type T = ReturnType<typeof useTranslations<'landing'>>

function KanbanView({ t }: { t: T }) {
  return (
    <>
      <Head title={t('demoPipelineTitle')} subtitle={t('demoPipelineSubtitle')} />
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
        {COLUMNS.map(col => {
          const items = DEMO.filter(d => d.status === col)
          return (
            <div key={col} style={{ minWidth: 168, flex: '0 0 168px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
                paddingBottom: 6, borderBottom: `2px solid ${STATUS_COLOR[col]}`,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ld-app-text)' }}>
                  {t(`demoStatus_${col}`)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--ld-app-muted)' }}>{items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map(d => (
                  <div key={d.name} style={{
                    background: 'var(--ld-app-surface)', border: '1px solid var(--ld-app-border)',
                    borderRadius: 8, padding: '8px 9px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                      {d.starred && <Star size={10} />}
                      <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{d.name}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ld-app-soft)', marginTop: 2, lineHeight: 1.35 }}>
                      {d.title} · {d.company}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                        background: `${TEMP_COLOR[d.temp]}22`, color: TEMP_COLOR[d.temp],
                      }}>{t(`demoTemp_${d.temp}`)}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: scoreColor(d.score) }}>
                        {d.score}
                      </span>
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div style={{ fontSize: 10.5, color: 'var(--ld-app-muted)', padding: '4px 2px' }}>—</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function Star({ size }: { size: number }) {
  return <span style={{ color: '#F59E0B', fontSize: size, lineHeight: 1, marginTop: 2 }}>★</span>
}

function LeadsView({ t }: { t: T }) {
  return (
    <>
      <Head title={t('demoLeadsTitle')} subtitle={t('demoLeadsSubtitle')} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
          <thead>
            <tr>
              {[t('demoColName'), t('demoColCompany'), t('demoColMarket'), t('demoColScore'), t('demoColTemp')].map(h => (
                <th key={h} style={{
                  textAlign: 'left', padding: '7px 9px', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '.05em',
                  color: 'var(--ld-app-muted)', borderBottom: '1px solid var(--ld-app-border)',
                  whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEMO.slice(0, 9).map(d => (
              <tr key={d.name}>
                <td style={cell}>
                  <div style={{ fontWeight: 600 }}>{d.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--ld-app-muted)' }}>{d.title}</div>
                </td>
                <td style={{ ...cell, color: 'var(--ld-app-soft)' }}>{d.company}</td>
                <td style={{ ...cell, color: 'var(--ld-app-soft)', whiteSpace: 'nowrap' }}>{d.market}</td>
                <td style={{ ...cell, fontFamily: 'monospace', fontWeight: 700, color: scoreColor(d.score) }}>{d.score}</td>
                <td style={cell}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: `${TEMP_COLOR[d.temp]}22`, color: TEMP_COLOR[d.temp],
                  }}>{t(`demoTemp_${d.temp}`)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ── Conversations ────────────────────────────────────────────────────── */

function ConversationsView({
  t, activeThread, setActiveThread,
}: {
  t: T; activeThread: string; setActiveThread: (id: string) => void
}) {
  const active = DEMO.find(d => d.id === activeThread)!
  const messages = THREADS[activeThread] ?? []

  return (
    <>
      <Head title={t('demoConvTitle')} subtitle={t('demoConvSubtitle')} />
      <p style={{ fontSize: 11.5, color: 'var(--ld-app-soft)', lineHeight: 1.55, marginTop: -6, marginBottom: 14, maxWidth: 560 }}>
        {t('demoConvNote')}
      </p>
      <div style={{ display: 'flex', gap: 12, height: 360 }}>
        <div style={{ width: 168, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {THREAD_LEAD_IDS.map(id => {
            const lead = DEMO.find(d => d.id === id)!
            const on = id === activeThread
            return (
              <button
                key={id}
                onClick={() => setActiveThread(id)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                  padding: '8px 10px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--ld-app-accent)' : 'var(--ld-app-border)'}`,
                  background: on ? 'var(--ld-app-accent)22' : 'var(--ld-app-surface)',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ld-app-text)' }}>{lead.name}</span>
                <span style={{ fontSize: 10, color: 'var(--ld-app-muted)' }}>{lead.company}</span>
                <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                    background: `${STATUS_COLOR[lead.status]}22`, color: STATUS_COLOR[lead.status],
                  }}>{t(`demoStatus_${lead.status}`)}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                    background: 'var(--ld-app-accent)22', color: 'var(--ld-app-accent)',
                  }}>{THREAD_LANG[id]}</span>
                </div>
              </button>
            )
          })}
        </div>

        <div style={{
          flex: 1, minWidth: 0, border: '1px solid var(--ld-app-border)', borderRadius: 10,
          background: 'var(--ld-app-surface)', padding: 14, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 11, color: 'var(--ld-app-muted)', marginBottom: 2 }}>
            {active.title} · {active.company} · {THREAD_LANG[activeThread]}
          </div>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: msg.side === 'us' ? 'row-reverse' : 'row', gap: 8 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
                background: msg.side === 'us' ? 'var(--ld-app-accent)30' : '#F59E0B30',
                color: msg.side === 'us' ? 'var(--ld-app-accent)' : '#F59E0B',
              }}>
                {msg.side === 'us' ? 'Me' : active.name[0]}
              </div>
              <div style={{ maxWidth: '76%' }}>
                <div style={{
                  borderRadius: 10, padding: '9px 12px', fontSize: 12, lineHeight: 1.6,
                  background: msg.side === 'us' ? 'var(--ld-app-accent)22' : 'var(--ld-app-raised)',
                  color: 'var(--ld-app-text)',
                }}>{msg.text}</div>
                <div style={{
                  fontSize: 10, color: 'var(--ld-app-muted)', marginTop: 3,
                  textAlign: msg.side === 'us' ? 'right' : 'left',
                }}>{msg.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/* ── New Run ─────────────────────────────────────────────────────────── */

function RunView({
  t, picked, setPicked, runState, found, startRun, resetRun,
}: {
  t: T
  picked: string[]
  setPicked: (v: string[]) => void
  runState: 'idle' | 'running' | 'done'
  found: number
  startRun: () => void
  resetRun: () => void
}) {
  const visibleLive = LIVE_FOUND.slice(0, Math.min(Math.ceil(found / 4), LIVE_FOUND.length))

  return (
    <>
      <Head title={t('demoRunTitle')} subtitle={t('demoRunSubtitle')} />

      {runState === 'idle' && (
        <div className="ld-in">
          <Label>{t('demoRunMarkets')}</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {MARKETS.map(m => {
              const on = picked.includes(m)
              return (
                <button
                  key={m}
                  onClick={() => setPicked(on ? picked.filter(x => x !== m) : [...picked, m])}
                  style={{
                    padding: '5px 11px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--ld-app-accent)' : 'var(--ld-app-border)'}`,
                    background: on ? 'var(--ld-app-accent)' : 'var(--ld-app-surface)',
                    color: on ? '#FFF' : 'var(--ld-app-soft)', transition: 'all .15s',
                  }}
                >{m}</button>
              )
            })}
          </div>

          <Label>{t('demoRunStrategy')}</Label>
          <div style={{
            padding: '9px 11px', borderRadius: 8, background: 'var(--ld-app-surface)',
            border: '1px solid var(--ld-app-accent)', marginBottom: 16,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t('demoComboName')}</div>
            <div style={{ fontSize: 10.5, color: 'var(--ld-app-muted)', marginTop: 2 }}>{t('demoComboDesc')}</div>
          </div>

          <button
            onClick={startRun}
            disabled={picked.length === 0}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 9, border: 'none',
              background: picked.length ? 'var(--ld-app-accent)' : 'var(--ld-app-raised)',
              color: picked.length ? '#FFF' : 'var(--ld-app-muted)',
              fontSize: 12.5, fontWeight: 700, cursor: picked.length ? 'pointer' : 'not-allowed',
            }}
          >
            <PlayCircle size={15} />
            {t('demoRunStart')}
          </button>
          <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ld-app-muted)' }}>
            {t('demoRunHint', { count: picked.length })}
          </div>
        </div>
      )}

      {runState === 'running' && (
        <div className="ld-in">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 14, paddingBottom: 18 }}>
            <Loader2 size={34} style={{ color: 'var(--ld-app-accent)', animation: 'ld-spin 1s linear infinite' }} />
            <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700 }}>{t('demoRunWorking')}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ld-app-soft)' }}>
              {t('demoRunProgress', { count: found })}
            </div>
            <div style={{ marginTop: 14, width: 220, height: 4, borderRadius: 3, background: 'var(--ld-app-raised)', overflow: 'hidden' }}>
              <div style={{ width: `${(found / 25) * 100}%`, height: '100%', background: 'var(--ld-app-accent)', transition: 'width .09s linear' }} />
            </div>
          </div>

          {visibleLive.length > 0 && (
            <div style={{ maxWidth: 420, margin: '0 auto' }}>
              <Label>{t('demoRunLiveLabel')}</Label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {visibleLive.map(p => (
                  <div key={p.name} className="ld-in" style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                    background: 'var(--ld-app-surface)', border: '1px solid var(--ld-app-border)', borderRadius: 8,
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0, fontSize: 10,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--ld-app-accent)30', color: 'var(--ld-app-accent)',
                    }}>{p.name[0]}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--ld-app-muted)' }}>{p.title} · {p.company}</div>
                    </div>
                    <Check size={13} color="#22C55E" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {runState === 'done' && (
        <div className="ld-in" style={{ paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{
              width: 26, height: 26, borderRadius: '50%', background: '#22C55E22',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Check size={15} color="#22C55E" />
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t('demoRunDone')}</div>
              <div style={{ fontSize: 11, color: 'var(--ld-app-soft)' }}>
                {t('demoRunDoneSub', { count: 25, markets: picked.length })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {([['Hot', 12], ['Warm', 9], ['Cold', 4]] as const).map(([temp, n]) => (
              <div key={temp} style={{
                flex: 1, padding: '10px 12px', borderRadius: 9,
                background: 'var(--ld-app-surface)', border: '1px solid var(--ld-app-border)',
              }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: TEMP_COLOR[temp] }}>{n}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ld-app-soft)' }}>{t(`demoTemp_${temp}`)}</div>
              </div>
            ))}
          </div>

          <div style={{
            padding: '10px 12px', borderRadius: 9, background: 'var(--ld-app-surface)',
            border: '1px solid var(--ld-app-border)', marginBottom: 14,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ld-app-muted)', marginBottom: 6 }}>
              {t('demoRunMessageLabel')}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.6, color: 'var(--ld-app-soft)' }}>
              {t('demoRunMessageBody')}
            </div>
          </div>

          <button
            onClick={resetRun}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              borderRadius: 8, border: '1px solid var(--ld-app-border)',
              background: 'transparent', color: 'var(--ld-app-soft)',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t('demoRunAgain')} <ChevronRight size={13} />
          </button>
        </div>
      )}
    </>
  )
}

/* ── Bridge ──────────────────────────────────────────────────────────── */

function BridgeView({
  t, status, setStatus,
}: {
  t: T
  status: Record<string, BridgeStatus>
  setStatus: (fn: (prev: Record<string, BridgeStatus>) => Record<string, BridgeStatus>) => void
}) {
  function set(id: string, next: BridgeStatus) {
    setStatus(prev => ({ ...prev, [id]: next }))
  }

  return (
    <>
      <Head title={t('demoBridgeTitle')} subtitle={t('demoBridgeSubtitle')} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9,
        background: 'var(--ld-app-surface)', border: '1px solid var(--ld-app-accent)', marginBottom: 16,
      }}>
        <Handshake size={16} color="var(--ld-app-accent)" />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{t('demoBridgeSeedListLabel')}</div>
          <div style={{ fontSize: 10.5, color: 'var(--ld-app-muted)', marginTop: 1 }}>
            {t('demoBridgeChannelReseller')} · {BRIDGE_COMPANIES.length} {t('demoBridgeCandidatesLabel').toLowerCase()}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 340, overflowY: 'auto' }}>
        {BRIDGE_COMPANIES.map(group => (
          <div key={group.company}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Building2 size={13} color="var(--ld-app-muted)" />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{group.company}</span>
              <span style={{ fontSize: 10, color: 'var(--ld-app-muted)' }}>{group.contacts.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {group.contacts.map(c => {
                const st = status[c.id] ?? 'pending'
                return (
                  <div key={c.id} style={{
                    padding: '10px 12px', borderRadius: 9,
                    background: 'var(--ld-app-surface)', border: '1px solid var(--ld-app-border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--ld-app-soft)', marginTop: 1 }}>{c.title} · {c.location}</div>
                      </div>
                      {st === 'pending' ? (
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button onClick={() => set(c.id, 'confirmed')} style={pillBtn('#22C55E')}>
                            <Check size={12} /> {t('demoBridgeConfirm')}
                          </button>
                          <button onClick={() => set(c.id, 'rejected')} style={pillBtn('#EF4444')}>
                            <X size={12} /> {t('demoBridgeReject')}
                          </button>
                        </div>
                      ) : (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, flexShrink: 0,
                          background: st === 'confirmed' ? '#22C55E22' : '#EF444422',
                          color: st === 'confirmed' ? '#22C55E' : '#EF4444',
                        }}>
                          {st === 'confirmed' ? t('demoBridgeConfirmed') : t('demoBridgeRejected')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ld-app-soft)', lineHeight: 1.55, marginTop: 7 }}>
                      {c.bio}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function pillBtn(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 6,
    fontSize: 10.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${color}55`,
    background: `${color}18`, color,
  }
}

/* ── Analytics ───────────────────────────────────────────────────────── */

function AnalyticsView({ t }: { t: T }) {
  const funnel = useMemo(
    () => COLUMNS.map(col => ({
      key: col,
      label: t(`demoStatus_${col}`),
      count: DEMO.filter(d => d.status === col).length,
      color: STATUS_COLOR[col],
    })),
    [t],
  )
  const temps = useMemo(
    () => (['Hot', 'Warm', 'Cold'] as const).map(temp => ({
      key: temp,
      label: t(`demoTemp_${temp}`),
      value: DEMO.filter(d => d.temp === temp).length,
      color: TEMP_COLOR[temp],
    })),
    [t],
  )
  const total = DEMO.length
  const repliedOrBeyond = DEMO.filter(d => ['replied', 'demo_scheduled', 'closed'].includes(d.status)).length
  const closed = DEMO.filter(d => d.status === 'closed').length
  const replyRate = Math.round((repliedOrBeyond / total) * 100)
  const conversionRate = Math.round((closed / total) * 100)

  const tooltipStyle = {
    background: 'var(--ld-app-surface)', border: '1px solid var(--ld-app-border)',
    borderRadius: 8, fontSize: 11, color: 'var(--ld-app-text)',
  }

  return (
    <>
      <Head title={t('demoAnalyticsTitle')} subtitle={t('demoAnalyticsSubtitle')} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
        {[
          { label: t('demoStatTotalLeads'), value: total, color: 'var(--ld-app-accent)' },
          { label: t('demoStatReplyRate'), value: `${replyRate}%`, color: '#F59E0B' },
          { label: t('demoStatConversion'), value: `${conversionRate}%`, color: '#22C55E' },
        ].map(s => (
          <div key={s.label} style={{
            padding: '12px 14px', borderRadius: 10, background: 'var(--ld-app-surface)',
            border: '1px solid var(--ld-app-border)',
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.value}</div>
            <div style={{ fontSize: 10.5, color: 'var(--ld-app-muted)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
        <div style={{ padding: '12px 14px 4px', borderRadius: 10, background: 'var(--ld-app-surface)', border: '1px solid var(--ld-app-border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ld-app-soft)', marginBottom: 6 }}>
            {t('demoChartFunnelTitle')}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={funnel} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--ld-app-muted)' }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={46} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--ld-app-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--ld-app-raised)' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {funnel.map(f => <Cell key={f.key} fill={f.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--ld-app-surface)', border: '1px solid var(--ld-app-border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ld-app-soft)', marginBottom: 6 }}>
            {t('demoChartTempTitle')}
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie data={temps} dataKey="value" nameKey="label" innerRadius={30} outerRadius={55} paddingAngle={3}>
                {temps.map(tt => <Cell key={tt.key} fill={tt.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
            {temps.map(tt => (
              <div key={tt.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: tt.color, display: 'inline-block' }} />
                <span style={{ fontSize: 10, color: 'var(--ld-app-soft)' }}>{tt.label} ({tt.value})</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

const cell: React.CSSProperties = {
  padding: '8px 9px', borderBottom: '1px solid var(--ld-app-surface)', fontSize: 11.5,
}

function Head({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--ld-app-muted)', marginTop: 1 }}>{subtitle}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
      color: 'var(--ld-app-muted)', marginBottom: 7,
    }}>{children}</div>
  )
}
