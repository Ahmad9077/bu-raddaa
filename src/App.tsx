import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { CONFIG } from './config'
import './App.css'

type Screen =
  | 'title'
  | 'howTo'
  | 'stage1'
  | 'stage2'
  | 'stage3'
  | 'win'
  | 'score'
  | 'leaderboard'
  | 'fail'

type FailKind = 'FAIL_1' | 'FAIL_2' | 'FAIL_3_CAUGHT' | 'FAIL_3_TIMEOUT'
type StageKey = 's1' | 's2' | 's3'
type Vec = { x: number; y: number }
type HudState = { stage: number; hearts: number; wife: number; mood?: 'jump' | 'shake' | 'sweat' }
type LeaderRow = { id?: string; name: string; score: number; created_at?: string; rank?: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const totalScore = (scores: Record<StageKey, number>, wife: number) =>
  clamp(Math.round(scores.s1 + scores.s2 + scores.s3 + wife * 3), 0, 5000)
const stageLabel = ['المرحلة ١ من ٣', 'المرحلة ٢ من ٣', 'المرحلة ٣ من ٣']
const failText: Record<FailKind, string> = {
  FAIL_1: 'البيبي مجوّع والزوجة عصبية 😭 — ما راح تطلع الليلة',
  FAIL_2: 'المطبخ كارثة وأم الزوجة ياية 😱 — الطلعة ملغاة',
  FAIL_3_CAUGHT: 'وييين تروح؟! 😡 — جلسة إرضاع عقابية بالليل 🍼',
  FAIL_3_TIMEOUT: 'ما لقيت الباب وراح وقت القعدة 🥲',
}
const caughtLines = ['وييين رايح؟!', 'شفتك تتحرك!', 'ارجع البيت الحين!']
const inspectionLines = ['شنو هذا الفوضى؟!', 'ليش الكاسات هني؟', 'ما خلّصت لحد الحين؟']

function useCanvasResize(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      const ctx = canvas.getContext('2d')
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    let frame = requestAnimationFrame(resize)
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(resize)
    })
    observer.observe(canvas)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [canvasRef])
}

function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number) {
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, x, y)
}

function Hud({ hud }: { hud: HudState }) {
  return (
    <header className="hud" aria-live="polite">
      <div className="wife-meter">
        <span>رضا الزوجة 👸</span>
        <div className="bar">
          <i style={{ width: `${hud.wife}%` }} />
        </div>
      </div>
      <strong>{stageLabel[hud.stage - 1]}</strong>
      <div className="hearts" aria-label={`القلوب ${hud.hearts}`}>
        {Array.from({ length: 3 }, (_, i) => (i < hud.hearts ? '❤️' : '🖤')).join('')}
      </div>
    </header>
  )
}

function PlayerAvatar({ mood, wife }: { mood?: HudState['mood']; wife: number }) {
  const className = ['avatar', mood, wife < 35 ? 'sweat' : ''].filter(Boolean).join(' ')
  return (
    <div className={className} aria-label={CONFIG.PLAYER_NAME}>
      <span>🧔</span>
      {wife < 35 ? <b>💦</b> : null}
    </div>
  )
}

function StageShell({
  hud,
  title,
  toast,
  children,
}: {
  hud: HudState
  title: string
  toast: string
  children: React.ReactNode
}) {
  return (
    <main className="game-screen stage-screen">
      <Hud hud={hud} />
      <div className="sadu" />
      <section className="stage-title">
        <h1>{title}</h1>
        <p>{toast}</p>
      </section>
      {children}
      <PlayerAvatar mood={hud.mood} wife={hud.wife} />
    </main>
  )
}

function Stage1({
  wife,
  setWife,
  onWin,
  onFail,
}: {
  wife: number
  setWife: (updater: (value: number) => number) => void
  onWin: (score: number) => void
  onFail: (kind: FailKind) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useCanvasResize(canvasRef)
  const [hud, setHud] = useState<HudState>({ stage: 1, hearts: 3, wife })
  const [toast, setToast] = useState('المرحلة الأولى: البيبي يبي رضعته الحين')
  const state = useRef({
    start: 0,
    last: 0,
    feed: 0,
    misses: 0,
    currentFeedFails: 0,
    hearts: 3,
    bottle: { x: 52, y: 440 },
    stunned: 0,
    hold: 0,
    swat: null as null | { x: number; y: number; fromLeft: boolean; age: number; active: boolean },
    done: false,
  })

  useEffect(() => {
    let frame = 0
    const loop = (now: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) {
        frame = requestAnimationFrame(loop)
        return
      }
      const rect = canvas.getBoundingClientRect()
      const s = state.current
      if (!s.start) s.start = now
      const dt = Math.min((now - (s.last || now)) / 1000, 0.04)
      s.last = now
      const elapsed = (now - s.start) / 1000
      const w = rect.width
      const h = rect.height
      const mouthOpenWindow = Math.max(1.2, 2.8 - s.feed * 0.3)
      const cycle = mouthOpenWindow + 1.5
      const cycleTime = elapsed % cycle
      const mouthOpen = cycleTime < mouthOpenWindow
      const baby = {
        x: w / 2 + Math.sin(elapsed * 1.2) * Math.min(44, w * 0.12),
        y: h * 0.34 + Math.sin(elapsed * 2.4) * 22,
      }
      const mouth = { x: baby.x, y: baby.y + 26 }
      const nearMouth = dist(s.bottle, mouth) < 30
      const isStunned = now < s.stunned

      if (nearMouth && mouthOpen && !isStunned) {
        s.hold += dt
        if (!s.swat && Math.random() < 0.009 + s.feed * 0.0018) {
          s.swat = { x: baby.x + (Math.random() > 0.5 ? -78 : 78), y: baby.y + 8, fromLeft: Math.random() > 0.5, age: 0, active: false }
          setToast('انتبه! كف البيبي بالطريق ⚠️')
        }
        if (s.hold >= 1.5) {
          s.feed += 1
          s.currentFeedFails = 0
          s.hold = 0
          setWife((value) => clamp(value + 9, 0, 100))
          setToast(s.feed >= 4 ? 'شبع البيبي 🎉' : `رضعة ناجحة ${s.feed}/4 🎉`)
          if (s.feed >= 4 && !s.done) {
            s.done = true
            const seconds = (now - s.start) / 1000
            onWin(Math.max(0, Math.round(800 - s.misses * 30 - seconds * 2)))
            return
          }
        }
      } else if (s.hold > 0 && !isStunned) {
        s.hold = 0
        s.misses += 1
        s.currentFeedFails += 1
        setWife((value) => clamp(value - 5, 0, 100))
        setToast('لا تحرك الرضّاعة! 😭')
        if (s.currentFeedFails >= 3) {
          s.currentFeedFails = 0
          s.hearts -= 1
          setToast('خسرت قلب... البيبي عصّب 😭')
          if (s.hearts <= 0) {
            onFail('FAIL_1')
            return
          }
        }
      }

      if (s.swat) {
        s.swat.age += dt
        s.swat.active = s.swat.age > 0.3
        const travel = clamp((s.swat.age - 0.3) / 0.45, 0, 1)
        s.swat.x = baby.x + (s.swat.fromLeft ? -88 + travel * 176 : 88 - travel * 176)
        s.swat.y = baby.y + 6
        if (s.swat.active && dist(s.swat, s.bottle) < 40) {
          s.stunned = now + 600
          s.bottle = { x: s.swat.fromLeft ? 44 : w - 44, y: h - 86 }
          s.hold = 0
          s.misses += 1
          s.currentFeedFails += 1
          setWife((value) => clamp(value - 5, 0, 100))
          setToast('البيبي طيّر الرضّاعة ✋')
          s.swat = null
        } else if (s.swat.age > 0.85) {
          s.swat = null
        }
      }

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#1E1206'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(245,166,35,.1)'
      for (let x = -20; x < w; x += 34) {
        ctx.fillRect(x + ((elapsed * 12) % 34), 0, 3, h)
      }
      ctx.fillStyle = 'rgba(245, 166, 35, 0.22)'
      ctx.beginPath()
      ctx.arc(baby.x, baby.y + 4, Math.min(74, w * 0.17), 0, Math.PI * 2)
      ctx.fill()
      drawEmoji(ctx, '👶', baby.x, baby.y, Math.min(112, w * 0.25))
      drawEmoji(ctx, mouthOpen ? '😮' : '😐', mouth.x, mouth.y, 30)
      ctx.strokeStyle = mouthOpen ? '#30A46C' : '#E5484D'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.arc(mouth.x, mouth.y, 34, 0, Math.PI * 2)
      ctx.stroke()
      if (s.hold > 0) {
        ctx.strokeStyle = '#F5A623'
        ctx.beginPath()
        ctx.arc(mouth.x, mouth.y, 44, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.hold / 1.5))
        ctx.stroke()
      }
      if (s.swat) {
        if (!s.swat.active) drawEmoji(ctx, '⚠️', s.swat.x, s.swat.y - 38, 28)
        drawEmoji(ctx, '✋', s.swat.x, s.swat.y, 38)
      }
      drawEmoji(ctx, '🍼', s.bottle.x, s.bottle.y, 54)
      ctx.fillStyle = '#F5EFE6'
      ctx.font = '900 22px Cairo, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`${s.feed}/4`, w / 2, h - 24)
      setHud({ stage: 1, hearts: s.hearts, wife, mood: s.hold > 0.4 ? 'jump' : undefined })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [onFail, onWin, setWife, wife])

  const moveBottle = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas || performance.now() < state.current.stunned) return
    const rect = canvas.getBoundingClientRect()
    state.current.bottle = {
      x: clamp(clientX - rect.left, 24, rect.width - 24),
      y: clamp(clientY - rect.top, 28, rect.height - 28),
    }
  }

  return (
    <StageShell hud={hud} title="صوّب الرضّاعة 🍼" toast={toast}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          moveBottle(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => moveBottle(e.clientX, e.clientY)}
      />
    </StageShell>
  )
}

type Dish = { id: number; lane: number; y: number; type: 'plate' | 'pot' | 'glass' | 'bottle'; scrubs: number; value: number; speed: number }
const dishDefs = {
  plate: { emoji: '🍽️', name: 'صحن عادي', scrubs: 1, value: 100 },
  pot: { emoji: '🫕', name: 'قدر', scrubs: 3, value: 180 },
  glass: { emoji: '🥛', name: 'كاسة زجاج', scrubs: 1, value: 140 },
  bottle: { emoji: '🍼', name: 'رضّاعة بيبي', scrubs: 2, value: 160 },
}

function pickDish(id: number): Dish {
  const r = Math.random()
  const type = r < 0.5 ? 'plate' : r < 0.7 ? 'pot' : r < 0.85 ? 'glass' : 'bottle'
  return { id, lane: Math.floor(rand(0, 4)), y: -60, type, scrubs: 0, value: dishDefs[type].value, speed: rand(72, 128) }
}

function Stage2({
  wife,
  setWife,
  onWin,
  onFail,
}: {
  wife: number
  setWife: (updater: (value: number) => number) => void
  onWin: (score: number) => void
  onFail: (kind: FailKind) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useCanvasResize(canvasRef)
  const [hud, setHud] = useState<HudState>({ stage: 2, hearts: 3, wife })
  const [toast, setToast] = useState('المرحلة الثانية: المطبخ بحاجة عاجلة')
  const state = useRef({
    start: 0,
    last: 0,
    nextDish: 1,
    spawn: 0,
    dishes: [] as Dish[],
    active: null as null | Dish,
    hearts: 3,
    cleaned: 0,
    misses: 0,
    score: 0,
    lastAngle: null as null | number,
    scrubProgress: 0,
    lastPointer: null as null | { x: number; y: number; t: number },
    inspections: [15, 35, 55],
    doneInspections: new Set<number>(),
    done: false,
  })

  const endStage = useCallback((timeLeft: number) => {
    const s = state.current
    if (s.done) return
    s.done = true
    onWin(Math.max(0, Math.round(s.cleaned * 100 + timeLeft * 8 - s.misses * 20 + s.score)))
  }, [onWin])

  useEffect(() => {
    let frame = 0
    const loop = (now: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) {
        frame = requestAnimationFrame(loop)
        return
      }
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      const s = state.current
      if (!s.start) s.start = now
      const dt = Math.min((now - (s.last || now)) / 1000, 0.04)
      s.last = now
      const elapsed = (now - s.start) / 1000
      const timeLeft = Math.max(0, 60 - elapsed)
      if (timeLeft <= 0 || s.cleaned >= 10) {
        endStage(timeLeft)
        return
      }
      s.spawn -= dt
      if (s.spawn <= 0) {
        s.dishes.push(pickDish(s.nextDish++))
        s.spawn = rand(0.55, 1.0)
      }
      s.dishes.forEach((dish) => {
        dish.y += dish.speed * dt
      })
      const before = s.dishes.length
      s.dishes = s.dishes.filter((dish) => dish.y < h - 88)
      const missed = before - s.dishes.length
      if (missed > 0) {
        s.misses += missed
        setWife((value) => clamp(value - 4 * missed - (s.misses >= 4 ? 10 : 0), 0, 100))
        setToast(s.misses >= 4 ? 'كارثة! الصحون تتراكم 😱' : 'طاح صحن بالحوض 😬')
      }
      for (const at of s.inspections) {
        if (elapsed >= at && !s.doneInspections.has(at)) {
          s.doneInspections.add(at)
          const line = inspectionLines[Math.floor(Math.random() * inspectionLines.length)]
          if (s.active) {
            s.hearts -= 1
            setWife((value) => clamp(value - 10, 0, 100))
            setToast(`الزوجة تتفقد ⚠️ ${line}`)
            if (s.hearts <= 0) {
              onFail('FAIL_2')
              return
            }
          } else {
            setWife((value) => clamp(value + 6, 0, 100))
            setToast('يلمع ✨')
          }
        }
      }
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#1E1206'
      ctx.fillRect(0, 0, w, h)
      const laneW = w / 4
      for (let i = 0; i < 4; i += 1) {
        ctx.fillStyle = i % 2 ? 'rgba(245,166,35,.07)' : 'rgba(245,239,230,.04)'
        ctx.fillRect(i * laneW, 0, laneW, h)
        ctx.strokeStyle = 'rgba(245,166,35,.18)'
        ctx.strokeRect(i * laneW, 0, laneW, h)
      }
      ctx.fillStyle = '#0F0A04'
      ctx.fillRect(0, h - 86, w, 86)
      ctx.fillStyle = '#F5EFE6'
      ctx.font = '900 18px Cairo, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`نظّفت ${s.cleaned}/10`, w / 2, h - 52)
      ctx.fillText(`الوقت ${Math.ceil(timeLeft)}`, w / 2, h - 24)
      s.dishes.forEach((dish) => {
        drawEmoji(ctx, dishDefs[dish.type].emoji, dish.lane * laneW + laneW / 2, dish.y, 42)
      })
      if (s.active) {
        const center = { x: w / 2, y: h * 0.58 }
        ctx.fillStyle = 'rgba(15,10,4,.72)'
        ctx.beginPath()
        ctx.roundRect(center.x - 90, center.y - 90, 180, 180, 22)
        ctx.fill()
        drawEmoji(ctx, dishDefs[s.active.type].emoji, center.x, center.y, 78)
        const need = dishDefs[s.active.type].scrubs
        ctx.strokeStyle = s.active.type === 'glass' ? '#E5484D' : '#F5A623'
        ctx.lineWidth = 10
        ctx.beginPath()
        ctx.arc(center.x, center.y, 86, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ((s.active.scrubs + s.scrubProgress) / need))
        ctx.stroke()
        if (s.active.type === 'glass') {
          ctx.fillStyle = '#F5EFE6'
          ctx.font = '700 15px Cairo, sans-serif'
          ctx.fillText('بهدوء على الكاسة', center.x, center.y + 112)
        }
      }
      setHud({ stage: 2, hearts: s.hearts, wife, mood: s.hearts < 3 ? 'shake' : undefined })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [endStage, onFail, setWife, wife])

  const pointer = (clientX: number, clientY: number, down = false) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const s = state.current
    if (!s.active) {
      const laneW = rect.width / 4
      const hit = s.dishes.find((dish) => Math.abs(dish.lane * laneW + laneW / 2 - x) < 42 && Math.abs(dish.y - y) < 44)
      if (hit) {
        s.active = hit
        s.dishes = s.dishes.filter((dish) => dish.id !== hit.id)
        s.lastAngle = null
        s.scrubProgress = 0
        setToast(`${dishDefs[hit.type].name} في اليد`)
      }
      return
    }
    const center = { x: rect.width / 2, y: rect.height * 0.58 }
    if (!down && dist({ x, y }, center) > 120) return
    const angle = Math.atan2(y - center.y, x - center.x)
    const now = performance.now()
    if (s.lastAngle !== null && s.lastPointer) {
      let delta = angle - s.lastAngle
      if (delta > Math.PI) delta -= Math.PI * 2
      if (delta < -Math.PI) delta += Math.PI * 2
      const speed = dist({ x, y }, s.lastPointer) / Math.max(16, now - s.lastPointer.t)
      if (s.active.type === 'glass' && speed > 1.25) {
        s.hearts -= 1
        setWife((value) => clamp(value - 8, 0, 100))
        setToast('انكسرت الكاسة!! 😱')
        s.active = null
        if (s.hearts <= 0) onFail('FAIL_2')
      } else {
        s.scrubProgress += Math.abs(delta) / (Math.PI * 2)
        if (s.scrubProgress >= 1) {
          s.active.scrubs += 1
          s.scrubProgress = 0
          if (s.active.scrubs >= dishDefs[s.active.type].scrubs) {
            s.cleaned += 1
            s.score += s.active.value
            setWife((value) => clamp(value + 4, 0, 100))
            setToast('خلصت وغسلتها ✨')
            s.active = null
          }
        }
      }
    }
    s.lastAngle = angle
    s.lastPointer = { x, y, t: now }
  }

  return (
    <StageShell hud={hud} title="ماكينة الصحون 🍽️" toast={toast}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pointer(e.clientX, e.clientY, true)
        }}
        onPointerMove={(e) => pointer(e.clientX, e.clientY)}
        onPointerUp={() => {
          state.current.lastAngle = null
          state.current.lastPointer = null
        }}
      />
    </StageShell>
  )
}

const mazeRows = [
  'W W W W W W W E W W W W W W W',
  'W . . . . . . . . . . . . . W',
  'W . W W W . W W W . W W W . W',
  'W . W . . . . . . . . . W . W',
  'W . W . W W B W W . W . W . W',
  'W . . . W . . . W . . . . . W',
  'W . W . W . . . W . W W W . W',
  'W o W . . . . . . . . W . o W',
  'W . W W W W W W W W W W W . W',
  'W . . . . . . . . . . . . . W',
  'W . W W . W W W W W . W W . W',
  'W . W M . . . . . G . . W . W',
  'W . W W . W W W W W . W W . W',
  'W . . . . . . . . . . . . . W',
  'W . W W W . W W W . W W W . W',
  'W . W . . . . . . . . . W . W',
  'W . W . W W W W W . W . W . W',
  'W . . . . . . P . . . . . . W',
  'W W W W W W W W W W W W W W W',
].map((row) => row.split(' '))
const dirs: Record<string, Vec> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }
const starts = {
  player: { x: 7, y: 17 },
  wife: { x: 9, y: 11 },
  mother: { x: 3, y: 11 },
}

function isWall(tile: Vec) {
  return mazeRows[Math.round(tile.y)]?.[Math.round(tile.x)] === 'W'
}

function bfsNext(from: Vec, target: Vec) {
  const start = { x: Math.round(from.x), y: Math.round(from.y) }
  const end = { x: clamp(Math.round(target.x), 0, 14), y: clamp(Math.round(target.y), 0, 18) }
  const queue = [start]
  const seen = new Set([`${start.x},${start.y}`])
  const prev = new Map<string, Vec>()
  while (queue.length) {
    const cur = queue.shift()!
    if (cur.x === end.x && cur.y === end.y) break
    for (const d of Object.values(dirs)) {
      const next = { x: cur.x + d.x, y: cur.y + d.y }
      const key = `${next.x},${next.y}`
      if (next.x < 0 || next.y < 0 || next.x >= 15 || next.y >= 19 || isWall(next) || seen.has(key)) continue
      seen.add(key)
      prev.set(key, cur)
      queue.push(next)
    }
  }
  let key = `${end.x},${end.y}`
  if (!prev.has(key)) return start
  let step = end
  while (prev.has(key)) {
    const p = prev.get(key)!
    if (p.x === start.x && p.y === start.y) return step
    step = p
    key = `${p.x},${p.y}`
  }
  return step
}

function moveEntity(entity: Vec, target: Vec, speed: number, dt: number) {
  const next = bfsNext(entity, target)
  const dx = next.x - entity.x
  const dy = next.y - entity.y
  const len = Math.hypot(dx, dy) || 1
  entity.x += (dx / len) * speed * dt
  entity.y += (dy / len) * speed * dt
  if (Math.abs(entity.x - next.x) < 0.04) entity.x = next.x
  if (Math.abs(entity.y - next.y) < 0.04) entity.y = next.y
}

function Stage3({
  wife,
  onWin,
  onFail,
}: {
  wife: number
  onWin: (score: number) => void
  onFail: (kind: FailKind) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useCanvasResize(canvasRef)
  const [hud, setHud] = useState<HudState>({ stage: 3, hearts: 3, wife })
  const [toast, setToast] = useState('المرحلة الثالثة: الربع ينتظرون… اطلع بهدوء')
  const [heldDir, setHeldDir] = useState<keyof typeof dirs | null>(null)
  const foodSeed = useMemo(
    () =>
      [
        { x: 2, y: 1 },
        { x: 11, y: 1 },
        { x: 5, y: 3 },
        { x: 10, y: 3 },
        { x: 3, y: 5 },
        { x: 12, y: 5 },
        { x: 6, y: 7 },
        { x: 9, y: 7 },
        { x: 1, y: 9 },
        { x: 13, y: 9 },
        { x: 4, y: 11 },
        { x: 10, y: 11 },
        { x: 2, y: 13 },
        { x: 12, y: 13 },
        { x: 8, y: 15 },
      ].map((tile, i) => ({
        ...tile,
        id: i,
        emoji: i % 3 === 0 ? '🍗' : '🍔',
        value: i % 3 === 0 ? 60 : 40,
      })),
    [],
  )
  const state = useRef({
    start: 0,
    last: 0,
    hearts: 3,
    player: { ...starts.player },
    wifeGhost: { ...starts.wife },
    mother: { ...starts.mother },
    direction: 'up' as keyof typeof dirs,
    keys: new Set(['1,7', '13,7']),
    freezeUntil: 0,
    invincibleUntil: 0,
    babyBoostUntil: 0,
    food: foodSeed,
    foodScore: 0,
    slowUntil: 0,
    slowMultiplier: 1,
    stageStartWife: wife,
    done: false,
  })

  useEffect(() => {
    let frame = 0
    const loop = (now: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) {
        frame = requestAnimationFrame(loop)
        return
      }
      const rect = canvas.getBoundingClientRect()
      const s = state.current
      if (!s.start) s.start = now
      const dt = Math.min((now - (s.last || now)) / 1000, 0.04)
      s.last = now
      const elapsed = (now - s.start) / 1000
      const timeLeft = Math.max(0, 120 - elapsed)
      if (timeLeft <= 0 && !s.done) {
        s.done = true
        onFail('FAIL_3_TIMEOUT')
        return
      }
      const tile = Math.floor(Math.min(rect.width, (rect.height * 15) / 19, 540) / 15)
      const mapW = tile * 15
      const mapH = tile * 19
      const offX = (rect.width - mapW) / 2
      const offY = Math.max(0, (rect.height - mapH) * 0.05)
      const baseSpeed = 2.8 * (now < s.slowUntil ? s.slowMultiplier : 1)
      if (heldDir) {
        s.direction = heldDir
        const d = dirs[heldDir]
        const candidate = { x: s.player.x + d.x * baseSpeed * dt, y: s.player.y + d.y * baseSpeed * dt }
        if (!isWall(candidate)) s.player = candidate
      }
      s.player.x = clamp(s.player.x, 1, 13)
      s.player.y = clamp(s.player.y, 1, 17)
      const pTile = { x: Math.round(s.player.x), y: Math.round(s.player.y) }
      if (mazeRows[pTile.y]?.[pTile.x] === 'E' && !s.done) {
        s.done = true
        const unusedKeys = s.keys.size
        const heroBonus = s.stageStartWife < 40 ? 600 : 0
        onWin(Math.max(0, Math.round(timeLeft * 25 + s.foodScore + unusedKeys * 250 + wife * 3 + heroBonus)))
        return
      }
      const keyId = `${pTile.x},${pTile.y}`
      if (s.keys.has(keyId)) {
        s.keys.delete(keyId)
        s.freezeUntil = now + 5000
        setToast('خذيت المفاتيح 🗝️ الكل تجمّد!')
      }
      const foodHit = s.food.find((food) => food.x === pTile.x && food.y === pTile.y)
      if (foodHit) {
        s.food = s.food.filter((food) => food.id !== foodHit.id)
        s.foodScore += foodHit.value
        s.slowUntil = now + (foodHit.emoji === '🍗' ? 10000 : 8000)
        s.slowMultiplier = foodHit.emoji === '🍗' ? 0.93 : 0.96
        setToast(`${foodHit.emoji} +${foodHit.value}`)
      }
      if (pTile.x >= 5 && pTile.x <= 7 && pTile.y >= 3 && pTile.y <= 5) {
        s.babyBoostUntil = now + 5000
        setToast('البيبي صحى! لاااا ⚠️')
      }
      if (now > s.freezeUntil) {
        if (elapsed > 3) {
          const wifeMult = wife >= 65 ? 0.8 : wife >= 40 ? 1 : 1.2
          const boost = now < s.babyBoostUntil ? 1.3 : 1
          moveEntity(s.wifeGhost, s.player, baseSpeed * wifeMult * boost, dt)
        }
        if (elapsed > 25) {
          const ahead = dirs[s.direction]
          moveEntity(s.mother, { x: s.player.x + ahead.x * 3, y: s.player.y + ahead.y * 3 }, baseSpeed * 0.85, dt)
        }
      }
      const caught =
        now > s.invincibleUntil &&
        now > s.freezeUntil &&
        (dist(s.player, s.wifeGhost) < 0.55 || (elapsed > 25 && dist(s.player, s.mother) < 0.55))
      if (caught) {
        s.hearts -= 1
        setToast(caughtLines[Math.floor(Math.random() * caughtLines.length)])
        if (s.hearts <= 0) {
          onFail('FAIL_3_CAUGHT')
          return
        }
        s.player = { ...starts.player }
        s.wifeGhost = { ...starts.wife }
        s.mother = { ...starts.mother }
        s.invincibleUntil = now + 2000
      }
      if (now <= s.freezeUntil && s.freezeUntil - now < 60) {
        s.wifeGhost = { ...starts.wife }
        s.mother = { ...starts.mother }
      }
      const w = rect.width
      const h = rect.height
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#120B05'
      ctx.fillRect(0, 0, w, h)
      for (let y = 0; y < 19; y += 1) {
        for (let x = 0; x < 15; x += 1) {
          const px = offX + x * tile
          const py = offY + y * tile
          const cell = mazeRows[y][x]
          if (cell === 'W') {
            ctx.fillStyle = '#050302'
            ctx.shadowColor = 'rgba(245,166,35,.28)'
            ctx.shadowBlur = 7
            ctx.beginPath()
            ctx.roundRect(px + 2, py + 2, tile - 4, tile - 4, 7)
            ctx.fill()
            ctx.shadowBlur = 0
          } else {
            ctx.fillStyle = '#211308'
            ctx.fillRect(px, py, tile, tile)
          }
          if (cell === 'E') {
            ctx.fillStyle = 'rgba(245,166,35,.28)'
            ctx.fillRect(px, py, tile, tile)
            drawEmoji(ctx, '🚪', px + tile / 2, py + tile / 2, tile * 0.78)
          }
        }
      }
      ctx.fillStyle = 'rgba(245,239,230,.72)'
      ctx.font = `700 ${Math.max(11, tile * 0.32)}px Cairo, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('غرفة البيبي', offX + 6.2 * tile, offY + 4.15 * tile)
      ctx.fillText('مطبخ', offX + 4.3 * tile, offY + 10.3 * tile)
      ctx.fillText('غرفة النوم', offX + 7.3 * tile, offY + 16.55 * tile)
      s.keys.forEach((id) => {
        const [x, y] = id.split(',').map(Number)
        drawEmoji(ctx, '🗝️', offX + x * tile + tile / 2, offY + y * tile + tile / 2, tile * 0.62)
      })
      s.food.forEach((food) => drawEmoji(ctx, food.emoji, offX + food.x * tile + tile / 2, offY + food.y * tile + tile / 2, tile * 0.48))
      const freeze = now < s.freezeUntil
      drawEmoji(ctx, freeze ? '💙' : wife < 30 ? '👹' : '👸', offX + s.wifeGhost.x * tile + tile / 2, offY + s.wifeGhost.y * tile + tile / 2, tile * 0.72)
      drawEmoji(ctx, freeze ? '💙' : '👵', offX + s.mother.x * tile + tile / 2, offY + s.mother.y * tile + tile / 2, tile * 0.72)
      drawEmoji(ctx, now < s.invincibleUntil ? '🧔‍♂️' : '🧔', offX + s.player.x * tile + tile / 2, offY + s.player.y * tile + tile / 2, tile * 0.78)
      ctx.fillStyle = '#F5EFE6'
      ctx.font = '900 18px Cairo, sans-serif'
      ctx.fillText(`الوقت ${Math.ceil(timeLeft)}`, w / 2, h - 10)
      setHud({ stage: 3, hearts: s.hearts, wife, mood: s.hearts < 3 ? 'shake' : undefined })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [heldDir, onFail, onWin, wife])

  const dpad = (dir: keyof typeof dirs, label: string) => (
    <button
      type="button"
      className="dpad-button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setHeldDir(dir)
      }}
      onPointerUp={() => setHeldDir(null)}
      onPointerCancel={() => setHeldDir(null)}
      onPointerLeave={() => setHeldDir((current) => (current === dir ? null : current))}
    >
      {label}
    </button>
  )

  return (
    <StageShell hud={hud} title="التسلل 🕹️" toast={toast}>
      <canvas ref={canvasRef} className="stage-canvas maze-canvas" />
      <div className="dpad" aria-label="أزرار الحركة">
        <span />
        {dpad('up', '⬆️')}
        <span />
        {dpad('right', '➡️')}
        <span className="dpad-core">🧔</span>
        {dpad('left', '⬅️')}
        <span />
        {dpad('down', '⬇️')}
        <span />
      </div>
    </StageShell>
  )
}

function ScoreScreen({
  scores,
  wife,
  onSubmit,
}: {
  scores: Record<StageKey, number>
  wife: number
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(CONFIG.PLAYER_NAME)
  const total = totalScore(scores, wife)
  return (
    <main className="game-screen card-screen">
      <section className="panel score-panel">
        <p className="eyebrow">سجّل النقاط 🏆</p>
        <h1>الحسبة النهائية</h1>
        <dl>
          <div><dt>المرحلة ١ (رضاعة)</dt><dd>{scores.s1}</dd></div>
          <div><dt>المرحلة ٢ (مطبخ)</dt><dd>{scores.s2}</dd></div>
          <div><dt>المرحلة ٣ (تسلل)</dt><dd>{scores.s3}</dd></div>
          <div><dt>رضا الزوجة</dt><dd>{wife * 3}</dd></div>
          <div className="total"><dt>المجموع</dt><dd>{total}</dd></div>
        </dl>
        <label>
          الاسم
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="button" onClick={() => onSubmit(name.trim() || CONFIG.PLAYER_NAME)}>
          سجّل النقاط 🏆
        </button>
      </section>
      <PlayerAvatar wife={wife} mood="jump" />
    </main>
  )
}

function Leaderboard({
  rows,
  status,
  playerName,
  playerScore,
  onRetry,
  onRestart,
}: {
  rows: LeaderRow[]
  status: string
  playerName: string
  playerScore: number
  onRetry: () => void
  onRestart: () => void
}) {
  const top = rows.slice(0, 10)
  const player = rows.find((row) => row.name === playerName && row.score === playerScore)
  return (
    <main className="game-screen card-screen">
      <section className="panel leaderboard">
        <p className="eyebrow">ليدربورد</p>
        <h1>أساطير الديوانية</h1>
        <p>{status}</p>
        {top.length ? (
          <ol>
            {top.map((row, index) => (
              <li className={row.name === playerName && row.score === playerScore ? 'mine' : ''} key={`${row.name}-${row.score}-${index}`}>
                <span>{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}</span>
                <strong>{row.name}</strong>
                <b>{row.score}</b>
              </li>
            ))}
          </ol>
        ) : null}
        {player && (player.rank ?? 0) > 10 ? <p className="rank-note">ترتيبك: #{player.rank}</p> : null}
        <div className="actions">
          {status.includes('خطأ') ? <button type="button" onClick={onRetry}>إعادة المحاولة</button> : null}
          <button type="button" className="secondary" onClick={onRestart}>العب من جديد 🎮</button>
        </div>
      </section>
      <PlayerAvatar wife={70} mood="jump" />
    </main>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [wife, setWifeRaw] = useState(35)
  const [scores, setScores] = useState<Record<StageKey, number>>({ s1: 0, s2: 0, s3: 0 })
  const [failKind, setFailKind] = useState<FailKind>('FAIL_1')
  const [playerName, setPlayerName] = useState(CONFIG.PLAYER_NAME)
  const [rows, setRows] = useState<LeaderRow[]>([])
  const [leaderStatus, setLeaderStatus] = useState('الليدربورد غير مفعّل بعد 🔌')

  const setWife = useCallback((updater: (value: number) => number) => {
    setWifeRaw((value) => clamp(Math.round(updater(value)), 0, 100))
  }, [])

  const restart = () => {
    setWifeRaw(35)
    setScores({ s1: 0, s2: 0, s3: 0 })
    setFailKind('FAIL_1')
    setRows([])
    setLeaderStatus('الليدربورد غير مفعّل بعد 🔌')
    setScreen('title')
  }

  const fail = (kind: FailKind) => {
    setFailKind(kind)
    setScreen('fail')
  }

  const submitScore = async (name: string) => {
    const score = totalScore(scores, wife)
    setPlayerName(name)
    setScreen('leaderboard')
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      setRows([{ name, score, rank: 1 }])
      setLeaderStatus('الليدربورد غير مفعّل بعد 🔌')
      return
    }
    try {
      setLeaderStatus('نرفع النتيجة...')
      const client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
      const { error: insertError } = await client.from('leaderboard').insert({ name, score })
      if (insertError) throw insertError
      const { data, error } = await client.from('leaderboard').select('id,name,score,created_at').order('score', { ascending: false }).limit(50)
      if (error) throw error
      const best = new Map<string, LeaderRow>()
      for (const row of data ?? []) {
        const current = best.get(row.name)
        if (!current || row.score > current.score) best.set(row.name, row)
      }
      const ranked = [...best.values()].sort((a, b) => b.score - a.score).map((row, index) => ({ ...row, rank: index + 1 }))
      setRows(ranked)
      setLeaderStatus('تم التسجيل 🔥')
    } catch {
      setLeaderStatus('صار خطأ بالشبكة. جرّب مرة ثانية.')
    }
  }

  if (screen === 'stage1') {
    return (
      <Stage1
        wife={wife}
        setWife={setWife}
        onFail={fail}
        onWin={(score) => {
          setScores((value) => ({ ...value, s1: score }))
          setScreen('stage2')
        }}
      />
    )
  }
  if (screen === 'stage2') {
    return (
      <Stage2
        wife={wife}
        setWife={setWife}
        onFail={fail}
        onWin={(score) => {
          setScores((value) => ({ ...value, s2: score }))
          setScreen('stage3')
        }}
      />
    )
  }
  if (screen === 'stage3') {
    return (
      <Stage3
        wife={wife}
        onFail={fail}
        onWin={(score) => {
          setScores((value) => ({ ...value, s3: score }))
          setScreen('win')
        }}
      />
    )
  }
  if (screen === 'score') return <ScoreScreen scores={scores} wife={wife} onSubmit={submitScore} />
  if (screen === 'leaderboard') {
    return <Leaderboard rows={rows} status={leaderStatus} playerName={playerName} playerScore={totalScore(scores, wife)} onRetry={() => submitScore(playerName)} onRestart={restart} />
  }
  if (screen === 'fail') {
    return (
      <main className="game-screen card-screen">
        <section className="panel fail-panel">
          <p className="eyebrow">انتهت المهمة</p>
          <h1>{failText[failKind]}</h1>
          <button type="button" onClick={restart}>حاول مرة ثانية 🔄</button>
        </section>
        <PlayerAvatar wife={wife} mood="shake" />
      </main>
    )
  }
  if (screen === 'win') {
    return (
      <main className="game-screen card-screen win-screen" onClick={() => setScreen('score')}>
        <div className="confetti">🎉🔥🍗😂🎉🔥🍗😂</div>
        <section className="panel">
          <p className="eyebrow">وصلت الديوانية! 🎉</p>
          <h1>نجحت بمهمة المستحيل يا {CONFIG.PLAYER_NAME}!</h1>
          <div className="whatsapp">
            <p>الأسطورة وصل 🔥🔥🔥</p>
            <p>اللي ما ييي ما يعرف شنو فاته</p>
          </div>
          <button type="button">كمّل</button>
        </section>
        <PlayerAvatar wife={wife} mood="jump" />
      </main>
    )
  }
  if (screen === 'howTo') {
    return (
      <main className="game-screen card-screen">
        <section className="panel">
          <p className="eyebrow">شلون ألعب؟</p>
          <h1>٣ مهام قبل الديوانية</h1>
          <ul className="howto-list">
            <li>صوّب الرضّاعة للبيبي ٤ مرات 🍼</li>
            <li>نظّف الصحون قبل ما الزوجة تتفقد 🍽️</li>
            <li>تسلّل من البيت واوصل الباب 🕹️</li>
          </ul>
          <button type="button" onClick={() => setScreen('stage1')}>كمّل</button>
        </section>
        <PlayerAvatar wife={wife} />
      </main>
    )
  }
  return (
    <main className="game-screen title-screen">
      <section className="title-hero">
        <p className="eyebrow">ديوانية ليلية</p>
        <h1>بو رضّاعة: مهمة الديوانية</h1>
        <p>يوم واحد… ٣ مهام… والديوانية تنتظر 🔥</p>
        <div className="actions">
          <button type="button" onClick={() => setScreen('stage1')}>ابدأ 🎮</button>
          <button type="button" className="secondary" onClick={() => setScreen('howTo')}>شلون ألعب؟</button>
        </div>
      </section>
      <div className="night-scene" aria-hidden="true">
        <span>🍼</span>
        <span>🍽️</span>
        <span>🚪</span>
        <span>🔥</span>
      </div>
      <PlayerAvatar wife={wife} />
    </main>
  )
}

export default App
