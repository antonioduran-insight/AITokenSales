import { NextRequest, NextResponse } from 'next/server'

const BACKEND = process.env.SCRAPER_API_URL || process.env.NEXT_PUBLIC_SCRAPER_API_URL || 'http://localhost:8000'

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const pathStr = '/' + path.join('/')
  const search = req.nextUrl.search ?? ''
  const url = `${BACKEND}${pathStr}${search}`

  const init: RequestInit = { method: req.method, headers: { 'Content-Type': 'application/json' } }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }

  try {
    const res = await fetch(url, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}

export const GET    = proxy
export const POST   = proxy
export const PATCH  = proxy
export const DELETE = proxy
