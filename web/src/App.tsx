import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'

import { SECTIONS } from './sections'
import { TOC_GROUPS } from './tocGroups'
import { getJaGuide, getSectionTitleJa } from './jaGuides'
import { GLOSSARY } from './glossary'
import { DAILY_QUOTES } from './quotes'
import { SzCompletion } from './SzCompletion'

import './App.css'

const DE_DATA_URL = '/data/de-sections.json'
const JA_DATA_URL = '/data/ja-sections.json'
const OVERVIEW_BASE_URL = '/overview'
const LS_KEY = 'suz-idx-v1'
const LS_DONE = 'suz-done-v1'

type LangMap = Record<string, string>

function loadIdx(): number {
  try {
    const n = Number(localStorage.getItem(LS_KEY))
    if (!Number.isFinite(n)) return 0
    return Math.min(Math.max(0, n), SECTIONS.length - 1)
  } catch {
    return 0
  }
}

function loadDone(): Set<number> {
  try {
    const j = localStorage.getItem(LS_DONE)
    if (!j) return new Set()
    return new Set(JSON.parse(j) as number[])
  } catch {
    return new Set()
  }
}

export default function App() {
  const [siteView, setSiteView] = useState<'reader' | 'completion'>('reader')
  const [idx, setIdx] = useState(loadIdx)
  const [done, setDone] = useState<Set<number>>(loadDone)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [quoteI] = useState(() => Math.floor(Math.random() * DAILY_QUOTES.length))
  const [deMap, setDeMap] = useState<LangMap | null>(null)
  const [deError, setDeError] = useState<string | null>(null)
  const [jaMap, setJaMap] = useState<LangMap | null>(null)
  const [jaError, setJaError] = useState<string | null>(null)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [overviewMd, setOverviewMd] = useState<string | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const deScrollRef = useRef<HTMLDivElement>(null)
  const jaTransScrollRef = useRef<HTMLDivElement>(null)
  const jaGuideScrollRef = useRef<HTMLDivElement>(null)
  const overviewBodyRef = useRef<HTMLDivElement>(null)

  const section = SECTIONS[idx] ?? SECTIONS[0]!
  const overviewNo = String(section.n).padStart(2, '0')
  const overviewUrl = `${OVERVIEW_BASE_URL}/No.${overviewNo}.md`

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(DE_DATA_URL)
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const data = (await res.json()) as LangMap
        if (!cancelled) {
          setDeMap(data)
          setDeError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setDeMap(null)
          setDeError(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(JA_DATA_URL)
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const data = (await res.json()) as LangMap
        if (!cancelled) {
          setJaMap(typeof data === 'object' && data !== null ? data : {})
          setJaError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setJaMap(null)
          setJaError(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(LS_KEY, String(idx))
  }, [idx])

  useEffect(() => {
    localStorage.setItem(LS_DONE, JSON.stringify([...done]))
  }, [done])

  useEffect(() => {
    deScrollRef.current?.scrollTo({ top: 0 })
    jaTransScrollRef.current?.scrollTo({ top: 0 })
    jaGuideScrollRef.current?.scrollTo({ top: 0 })
  }, [section.n])

  useEffect(() => {
    // Mermaid は初期化を一度だけ行う
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
  }, [])

  const openOverview = useCallback(async () => {
    setOverviewOpen(true)
    setOverviewMd(null)
    setOverviewError(null)
    try {
      const res = await fetch(overviewUrl)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const text = await res.text()
      setOverviewMd(text)
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : String(e))
    }
  }, [overviewUrl])

  const openOverviewSourceInNewTab = useCallback(async () => {
    try {
      const md =
        overviewMd ??
        (await (async () => {
          const res = await fetch(overviewUrl)
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
          return await res.text()
        })())

      marked.setOptions({ gfm: true, breaks: false, async: false } as any)
      const rendered = String(marked.parse(md))
        .replaceAll(
          /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
          (_m: string, code: string) => `<pre class="mermaid">${unescapeHtml(code)}</pre>`,
        )
        .replaceAll(/<pre class="mermaid">\s*<\/pre>/g, '')

      const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>解説 No.${overviewNo}</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 18px 18px 48px; font-family: system-ui, -apple-system, Segoe UI, Roboto, 'Noto Sans JP', sans-serif; line-height: 1.75; }
      main { max-width: 900px; margin: 0 auto; }
      h2 { margin: 0.25rem 0 0.9rem; }
      h3 { margin: 1.35rem 0 0.55rem; }
      pre { overflow: auto; border: 1px solid rgba(120,110,95,.35); border-radius: 10px; padding: 12px; background: rgba(0,0,0,.03); }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace; font-size: 0.92em; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid rgba(120,110,95,.35); padding: 8px 10px; vertical-align: top; }
      blockquote { margin: 0.9rem 0; padding: 0.2rem 0 0.2rem 0.9rem; border-left: 3px solid rgba(120,110,95,.6); color: rgba(0,0,0,.78); }
      details { margin-top: 1.2rem; }
      @media (prefers-color-scheme: dark) {
        pre { background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.18); }
        th, td { border-color: rgba(255,255,255,.18); }
        blockquote { color: rgba(255,255,255,.78); border-left-color: rgba(255,255,255,.35); }
      }
    </style>
  </head>
  <body>
    <main>
      ${rendered}
      <details>
        <summary>元Markdown（テキスト）</summary>
        <pre>${escapeHtml(md)}</pre>
      </details>
    </main>
    <script type="module">
      import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
      try { await mermaid.run({ querySelector: '.mermaid' }); } catch (e) {}
    </script>
  </body>
</html>`

      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      window.open(url, '_blank', 'noreferrer')
      // しばらくしてから解放（タブが読み込む時間を確保）
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : String(e))
    }
  }, [overviewMd, overviewNo, overviewUrl])

  const overviewHtml = useMemo(() => {
    if (!overviewMd) return null
    // marked の型定義はバージョン差があるため最小指定に留める
    marked.setOptions({ gfm: true, breaks: false, async: false } as any)
    // Mermaid は fenced code を <pre class="mermaid"> に変換して後でレンダリングする
    const raw = marked.parse(overviewMd) as unknown as string
    return String(raw)
      .replaceAll(
        /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
        (_m: string, code: string) => `<pre class="mermaid">${unescapeHtml(code)}</pre>`,
      )
      .replaceAll(/<pre class="mermaid">\s*<\/pre>/g, '')
  }, [overviewMd])

  useEffect(() => {
    if (!overviewOpen) return
    if (!overviewHtml) return
    const el = overviewBodyRef.current
    if (!el) return
    // Mermaid を再実行
    ;(async () => {
      try {
        await mermaid.run({ nodes: el.querySelectorAll('.mermaid') })
      } catch {
        // ignore render errors
      }
    })()
  }, [overviewOpen, overviewHtml])

  const ja = useMemo(() => getJaGuide(section), [section])

  const deText = deMap?.[String(section.n)] ?? null
  const jaTransRaw = jaMap?.[String(section.n)]
  const jaTrans =
    typeof jaTransRaw === 'string' && jaTransRaw.trim().length > 0 ? jaTransRaw.trim() : null

  const toggleDone = useCallback(() => {
    setDone((prev) => {
      const n = section.n
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }, [section.n])

  const go = useCallback((delta: number) => {
    setIdx((i) => Math.min(SECTIONS.length - 1, Math.max(0, i + delta)))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'j' || e.key === 'J') go(1)
      if (e.key === 'k' || e.key === 'K') go(-1)
      if (e.key === 'd' || e.key === 'D') toggleDone()
      if (e.key === 'g' || e.key === 'G') setGlossaryOpen((v) => !v)
      if (e.key === 'f' || e.key === 'F') setFocusMode((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, toggleDone])

  const progress = Math.round((done.size / SECTIONS.length) * 100)

  if (siteView === 'completion') {
    return <SzCompletion onBack={() => setSiteView('reader')} />
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">SZ</span>
          <div>
            <h1>存在と時間 — じっくり読書室</h1>
            <p className="sub">
              ドイツ語原文と日本語訳（<code>ja-sections.json</code>）・学習メモを並べて読めます（キー: <kbd>J</kbd>/<kbd>K</kbd> 次の§/前の§、
              <kbd>D</kbd> 読了、<kbd>G</kbd> 用語、<kbd>F</kbd> 集中）
            </p>
          </div>
        </div>
        <div className="stats">
          <div className="pill">
            読了 <strong>{done.size}</strong> / {SECTIONS.length}（{progress}%）
          </div>
          <button type="button" className="ghost" onClick={() => setSiteView('completion')}>
            内的完結稿
          </button>
          <button type="button" className="ghost" onClick={() => setGlossaryOpen(true)}>
            用語集
          </button>
        </div>
      </header>

      {!focusMode && (
        <aside className="quote">
          <span className="qtag">今日の一文</span>
          {DAILY_QUOTES[quoteI]}
        </aside>
      )}

      <main className={`grid ${focusMode ? 'grid--focus' : ''}`}>
        {!focusMode && (
          <nav className="toc" aria-label="段落目次">
            <div className="toc-head">段落（§）</div>
            <ul className="toc-list">
              {SECTIONS.map((s, i) => {
                const showGroup = TOC_GROUPS.some((g) => g.fromN === s.n)
                const g = TOC_GROUPS.find((x) => x.fromN === s.n)
                return (
                  <li key={s.n}>
                    {showGroup && g && <div className="toc-group">{g.label}</div>}
                    <button
                      type="button"
                      className={`toc-item ${i === idx ? 'is-active' : ''} ${done.has(s.n) ? 'is-done' : ''}`}
                      onClick={() => setIdx(i)}
                    >
                      <span className="toc-n">§{s.n}</span>
                      <span className="toc-t">{getSectionTitleJa(s.n)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}

        <section className="de-pane" aria-label="ドイツ語原文">
          <div className="pane-head de-head">
            <div>
              <span className="de-kicker">§{section.n}</span>
              <h2 className="de-title">{section.titleDe}</h2>
              <p className="muted de-ref">刷り {section.bookPage} 頁相当（紙の版との照合用）</p>
            </div>
          </div>
          <div className="de-body" ref={deScrollRef}>
            {deError && (
              <p className="de-status de-status--err">
                原文データを読み込めませんでした（{deError}）。リポジトリ直下で{' '}
                <code>python3 scripts/extract_de_sections.py</code> を実行し、<code>web/public/data/de-sections.json</code>{' '}
                を生成してから再読み込みしてください。
              </p>
            )}
            {!deError && deMap === null && <p className="de-status">原文テキストを読み込み中…</p>}
            {!deError && deText !== null && <article className="de-text">{deText}</article>}
          </div>
        </section>

        <section className="ja-pane" aria-label="日本語">
          <div className="pane-head ja-head">
            <div>
              <h2>{ja.titleJa}</h2>
              <p className="de">{section.titleDe}</p>
            </div>
            <button type="button" className={`done ${done.has(section.n) ? 'is-on' : ''}`} onClick={toggleDone}>
              {done.has(section.n) ? '読了にした' : '読了にする'}
            </button>
          </div>

          <div className="ja-trans-head">
            <span>日本語訳（Claude API 生成）</span>
            <button type="button" className="overview-link" onClick={openOverview}>
              解説
            </button>
          </div>
          <div className="ja-trans-body" ref={jaTransScrollRef}>
            {jaMap === null && jaError && (
              <p className="de-status de-status--err">
                訳データの読み込みに失敗しました（{jaError}）。<code>web/public/data/ja-sections.json</code> を確認してください。
              </p>
            )}
            {jaMap === null && !jaError && <p className="de-status">日本語訳データを読み込み中…</p>}
            {jaMap !== null && !jaTrans && (
              <p className="de-status">
                この§の日本語訳はまだありません。リポジトリルートに <code>.env</code> で{' '}
                <code>ANTHROPIC_API_KEY</code> を設定し、<code>web</code> ディレクトリで{' '}
                <code>npm run translate:ja</code> を実行してください（<code>--from</code> / <code>--to</code> で範囲指定可）。
              </p>
            )}
            {jaTrans !== null && <article className="ja-trans">{jaTrans}</article>}
          </div>

          <div className="ja-guide-head">学習メモ（要旨）</div>
          <article className="ja-body" ref={jaGuideScrollRef}>
            {(ja.body ?? '').split(/\n\n+/).map((p, i) => (
              <p key={i}>{inlineMd(p)}</p>
            ))}
          </article>
          <footer className="ja-foot">
            <p>
              日本語訳は API による自動生成です。確定稿ではありません。学習メモは従来どおりの補助説明です。必要に応じて刊行訳と照合してください。
            </p>
          </footer>
        </section>
      </main>

      {glossaryOpen && (
        <dialog
          className="sheet"
          open
          aria-modal
          onClick={(e) => {
            if (e.target === e.currentTarget) setGlossaryOpen(false)
          }}
        >
          <div className="sheet-inner" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>用語集（抜粋）</h3>
              <button type="button" className="ghost" onClick={() => setGlossaryOpen(false)}>
                閉じる
              </button>
            </header>
            <dl className="gloss">
              {GLOSSARY.map((g) => (
                <div key={g.term} className="gloss-row">
                  <dt>
                    {g.term} → {g.ja}
                  </dt>
                  {g.note && <dd>{g.note}</dd>}
                </div>
              ))}
            </dl>
          </div>
        </dialog>
      )}

      {overviewOpen && (
        <dialog
          className="sheet"
          open
          aria-modal
          onClick={(e) => {
            if (e.target === e.currentTarget) setOverviewOpen(false)
          }}
        >
          <div className="sheet-inner sheet-inner--wide" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>
                解説 No.{overviewNo}（§{section.n}）
              </h3>
              <div className="sheet-actions">
                <button type="button" className="ghost" onClick={openOverviewSourceInNewTab}>
                  元Markdown
                </button>
                <button type="button" className="ghost" onClick={() => setOverviewOpen(false)}>
                  閉じる
                </button>
              </div>
            </header>
            <div className="overview" ref={overviewBodyRef}>
              {overviewError && (
                <p className="de-status de-status--err">
                  解説を読み込めませんでした（{overviewError}）。まず <code>npm run overview:sync</code> を実行して、{'\n'}
                  <code>doc/overview</code> → <code>web/public/overview</code> を同期してください（No.XX.md が無い場合は <code>npm run overview:gen</code>）。
                </p>
              )}
              {!overviewError && overviewMd === null && <p className="de-status">解説を読み込み中…</p>}
              {!overviewError && overviewHtml && <div className="overview-html" dangerouslySetInnerHTML={{ __html: overviewHtml }} />}
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}

function inlineMd(s: string) {
  const parts = s.split(/\*\*(.+?)\*\*/g)
  return parts.map((chunk, i) =>
    i % 2 === 1 ? (
      <strong key={i}>{chunk}</strong>
    ) : (
      <span key={i}>{chunk}</span>
    ),
  )
}

function unescapeHtml(s: string) {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
