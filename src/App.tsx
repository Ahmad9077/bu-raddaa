import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { CONFIG } from './config'
import './App.css'

type Screen = 'title' | 'howTo' | 'stage1' | 'stage2' | 'stage3' | 'win' | 'score' | 'leaderboard' | 'fail'
type StageKey = 's1' | 's2' | 's3'
type FailKind = 'FAIL_1' | 'FAIL_2' | 'FAIL_3'
type HudState = { stage: number; hearts: number; wife: number; mood?: 'jump' | 'shake' | 'sweat' }
type LeaderRow = { id?: string; name: string; score: number; rank?: number }

const PLAYER_STAGE1_SRC = `${import.meta.env.BASE_URL}player-stage1.jpg`
const SNAKE_HEAD_SRC = `${import.meta.env.BASE_URL}snake-head.jpg`
const SNAKE_TARGET_SRCS = Array.from({ length: 7 }, (_, index) => `${import.meta.env.BASE_URL}snake-target-${index + 1}.jpg`)
const stageLabel = ['المرحلة ١ من ٣', 'المرحلة ٢ من ٣', 'المرحلة ٣ من ٣']
const failText: Record<FailKind, string> = {
  FAIL_1: 'البيبي قال: لا تحاول مرة ثانية بهالطريقة 😭',
  FAIL_2: 'الزوجة والطفل وقفوا طريقك 😱',
  FAIL_3: 'الثعبان خبط وانتهت الجولة 🐍',
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const scoreBreakdown = (scores: Record<StageKey, number>, wife: number) => {
  const stageTotal = Math.round(scores.s1 + scores.s2 + scores.s3)
  const wifeBonus = Math.round(wife * 3)
  const completionBonus = scores.s1 > 0 && scores.s2 > 0 && scores.s3 > 0 ? 500 : 0
  const total = clamp(stageTotal + wifeBonus + completionBonus, 0, 6500)
  return { stageTotal, wifeBonus, completionBonus, total }
}
const totalScore = (scores: Record<StageKey, number>, wife: number) => scoreBreakdown(scores, wife).total

function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number) {
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, x, y)
}

function drawRoundImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
  fallback: string,
) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, size / 2, 0, Math.PI * 2)
  ctx.clip()
  if (image?.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, 0, image.naturalHeight * 0.03, image.naturalWidth, image.naturalHeight * 0.78, x - size / 2, y - size / 2, size, size)
  } else {
    ctx.fillStyle = '#fff7d8'
    ctx.fillRect(x - size / 2, y - size / 2, size, size)
    drawEmoji(ctx, fallback, x, y, size * 0.7)
  }
  ctx.restore()
  ctx.strokeStyle = '#175f78'
  ctx.lineWidth = Math.max(2, size * 0.08)
  ctx.beginPath()
  ctx.arc(x, y, size / 2, 0, Math.PI * 2)
  ctx.stroke()
}

function useCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const box = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(box.width * dpr))
      canvas.height = Math.max(1, Math.floor(box.height * dpr))
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
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

function useNoLongPressSelection() {
  useEffect(() => {
    const prevent = (event: Event) => event.preventDefault()
    document.addEventListener('contextmenu', prevent)
    document.addEventListener('selectstart', prevent)
    return () => {
      document.removeEventListener('contextmenu', prevent)
      document.removeEventListener('selectstart', prevent)
    }
  }, [])
}

function Hud({ hud }: { hud: HudState }) {
  return (
    <header className="hud">
      <div className="wife-meter">
        <span>رضا الزوجة 👸</span>
        <div className="bar">
          <i style={{ width: `${hud.wife}%` }} />
        </div>
      </div>
      <strong>{stageLabel[hud.stage - 1]}</strong>
      <div className="hearts">{Array.from({ length: 3 }, (_, i) => (i < hud.hearts ? '❤️' : '🖤')).join('')}</div>
    </header>
  )
}

function PlayerAvatar({ mood, wife }: { mood?: HudState['mood']; wife: number }) {
  return (
    <div className={['avatar', mood, wife < 35 ? 'sweat' : ''].filter(Boolean).join(' ')}>
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
  hideAvatar = false,
}: {
  hud: HudState
  title: string
  toast: string
  children: React.ReactNode
  hideAvatar?: boolean
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
      {hideAvatar ? null : <PlayerAvatar mood={hud.mood} wife={hud.wife} />}
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
  useCanvas(canvasRef)
  const [hud, setHud] = useState<HudState>({ stage: 1, hearts: 3, wife })
  const [toast, setToast] = useState('حرّك المضرب واضرب الرضاعة لفم البيبي')
  const state = useRef({
    start: 0,
    last: 0,
    hearts: 3,
    feeds: 0,
    hits: 0,
    misses: 0,
    paddleX: 190,
    targetX: 190,
    fingerX: 190,
    bottle: { x: 190, y: 260, vx: 130, vy: 310, spin: 0 },
    pauseUntil: 0,
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
      const box = canvas.getBoundingClientRect()
      const w = box.width
      const h = box.height
      const s = state.current
      if (!s.start) s.start = now
      const dt = Math.min((now - (s.last || now)) / 1000, 0.04)
      s.last = now
      const elapsed = (now - s.start) / 1000
      const paddleW = clamp(w * 0.36, 112, 152)
      const paddleY = h - 92
      const baby = {
        x: w * 0.5 + Math.sin(elapsed * 0.95) * Math.min(64, w * 0.16),
        y: h * 0.065,
      }
      const mouth = { x: baby.x, y: baby.y + 25 }
      const bottle = s.bottle
      const resetBottle = (direction: 1 | -1) => {
        bottle.x = direction < 0 ? s.paddleX : w * 0.5
        bottle.y = direction < 0 ? paddleY - 68 : h * 0.42
        bottle.vx = rand(-140, 140)
        bottle.vy = direction * rand(295, 345)
        bottle.spin = 0
        s.pauseUntil = now + 280
      }

      s.paddleX += (s.targetX - s.paddleX) * (1 - Math.pow(0.001, dt))
      if (now > s.pauseUntil) {
        bottle.x += bottle.vx * dt
        bottle.y += bottle.vy * dt
        bottle.spin += dt * (bottle.vx > 0 ? 5 : -5)

        if (bottle.x < 28) {
          bottle.x = 28
          bottle.vx = Math.abs(bottle.vx)
        } else if (bottle.x > w - 28) {
          bottle.x = w - 28
          bottle.vx = -Math.abs(bottle.vx)
        }

        if (bottle.vy > 0 && bottle.y > paddleY - 25 && bottle.y < paddleY + 14 && Math.abs(bottle.x - s.paddleX) < paddleW / 2 + 18) {
          const offset = (bottle.x - s.paddleX) / (paddleW / 2)
          bottle.y = paddleY - 27
          bottle.vy = -Math.min(430, Math.abs(bottle.vy) * 1.035 + 16)
          bottle.vx = clamp(bottle.vx + offset * 185, -300, 300)
          s.hits += 1
          setToast(s.hits % 3 === 0 ? 'ضربة حلوة! وجّهها لفم البيبي' : 'ردّ الرضاعة!')
        }

        if (bottle.vy < 0 && bottle.y < mouth.y + 18) {
          if (Math.abs(bottle.x - mouth.x) < 38) {
          s.feeds += 1
          setWife((value) => clamp(value + 8, 0, 100))
          setToast(s.feeds >= 5 ? 'البيبي شبع وانفتح الطريق 🎉' : `رضعة ممتازة ${s.feeds}/5`)
          if (s.feeds >= 5 && !s.done) {
            s.done = true
              onWin(Math.max(0, Math.round(1200 + s.hits * 35 - s.misses * 70 - elapsed * 4)))
            return
          }
            resetBottle(1)
          } else if (bottle.y < 38) {
            bottle.y = 38
            bottle.vy = Math.abs(bottle.vy) * 0.94
            bottle.vx += clamp((bottle.x - mouth.x) * 0.45, -70, 70)
            setToast('قربها صوب فم البيبي مو فوق راسه 😅')
          }
        }

        if (bottle.y > h + 30) {
          s.misses += 1
          s.hearts -= 1
          setWife((value) => clamp(value - 6, 0, 100))
          if (s.hearts <= 0) {
            onFail('FAIL_1')
            return
          }
          setToast('طاحت الرضاعة! ردها بالمضرب')
          resetBottle(-1)
        }
      }

      ctx.clearRect(0, 0, w, h)
      const court = ctx.createLinearGradient(0, 0, 0, h)
      court.addColorStop(0, '#e9f8ff')
      court.addColorStop(0.52, '#f7fbf7')
      court.addColorStop(1, '#fff4d4')
      ctx.fillStyle = court
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(23,95,120,.06)'
      for (let y = 62; y < h; y += 48) ctx.fillRect(0, y, w, 3)
      ctx.strokeStyle = 'rgba(23,95,120,.16)'
      ctx.lineWidth = 4
      ctx.setLineDash([12, 12])
      ctx.beginPath()
      ctx.moveTo(0, h * 0.5)
      ctx.lineTo(w, h * 0.5)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = 'rgba(48,164,108,.12)'
      ctx.beginPath()
      ctx.arc(baby.x, baby.y + 11, Math.min(40, w * 0.1), 0, Math.PI * 2)
      ctx.fill()
      drawEmoji(ctx, '👶', baby.x, baby.y, Math.min(48, w * 0.12))

      ctx.save()
      ctx.shadowColor = 'rgba(23,51,61,.18)'
      ctx.shadowBlur = 12
      ctx.fillStyle = '#175f78'
      ctx.beginPath()
      ctx.roundRect(s.paddleX - paddleW / 2, paddleY, paddleW, 18, 9)
      ctx.fill()
      ctx.fillStyle = '#fff7d8'
      ctx.beginPath()
      ctx.roundRect(s.paddleX - paddleW * 0.34, paddleY + 4, paddleW * 0.68, 7, 5)
      ctx.fill()
      ctx.restore()

      ctx.save()
      ctx.translate(bottle.x, bottle.y)
      ctx.rotate(bottle.spin)
      drawEmoji(ctx, '🍼', 0, 0, 44)
      ctx.restore()

      ctx.strokeStyle = 'rgba(23,95,120,.34)'
      ctx.setLineDash([6, 7])
      ctx.beginPath()
      ctx.moveTo(s.paddleX, paddleY + 8)
      ctx.lineTo(s.fingerX, paddleY + 76)
      ctx.stroke()
      ctx.setLineDash([])
      drawEmoji(ctx, '👇', s.fingerX, paddleY + 94, 22)

      ctx.fillStyle = '#14333d'
      ctx.font = '900 22px Cairo, sans-serif'
      ctx.fillText(`${s.feeds}/5`, w / 2, h - 24)
      ctx.font = '900 14px Cairo, sans-serif'
      ctx.fillText(`رالي ${s.hits}`, w / 2, h - 50)
      setHud({ stage: 1, hearts: s.hearts, wife, mood: bottle.vy < 0 ? 'jump' : undefined })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [onFail, onWin, setWife, wife])

  const move = (clientX: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const box = canvas.getBoundingClientRect()
    state.current.fingerX = clamp(clientX - box.left, 42, box.width - 42)
    state.current.targetX = state.current.fingerX
  }

  return (
    <StageShell hud={hud} title="رضّاعة بونغ 🍼" toast={toast}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          move(event.clientX)
        }}
        onPointerMove={(event) => move(event.clientX)}
        onMouseDown={(event) => move(event.clientX)}
        onMouseMove={(event) => {
          if (event.buttons) move(event.clientX)
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0]
          if (touch) move(touch.clientX)
        }}
        onTouchMove={(event) => {
          event.preventDefault()
          const touch = event.touches[0]
          if (touch) move(touch.clientX)
        }}
      />
    </StageShell>
  )
}

type PlatformBlock = { x: number; yOff: number; w: number; h: number; kind: 'ground' | 'brick' | 'pipe' }
type PlatformCollectible = { id: number; x: number; yOff: number; taken: boolean }
type PlatformFoe = {
  id: number
  x: number
  yOff: number
  w: number
  h: number
  vx: number
  minX: number
  maxX: number
  kind: 'wife' | 'baby'
  alive: boolean
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function createPlatformLevel() {
  return {
    worldWidth: 6400,
    platforms: [
      { x: 0, yOff: 0, w: 420, h: 36, kind: 'ground' },
      { x: 500, yOff: 0, w: 360, h: 36, kind: 'ground' },
      { x: 940, yOff: 0, w: 400, h: 36, kind: 'ground' },
      { x: 1430, yOff: 0, w: 390, h: 36, kind: 'ground' },
      { x: 1910, yOff: 0, w: 440, h: 36, kind: 'ground' },
      { x: 2440, yOff: 0, w: 390, h: 36, kind: 'ground' },
      { x: 2920, yOff: 0, w: 430, h: 36, kind: 'ground' },
      { x: 3440, yOff: 0, w: 390, h: 36, kind: 'ground' },
      { x: 3920, yOff: 0, w: 440, h: 36, kind: 'ground' },
      { x: 4450, yOff: 0, w: 430, h: 36, kind: 'ground' },
      { x: 4970, yOff: 0, w: 420, h: 36, kind: 'ground' },
      { x: 5480, yOff: 0, w: 880, h: 36, kind: 'ground' },
      { x: 245, yOff: 90, w: 150, h: 24, kind: 'brick' },
      { x: 610, yOff: 138, w: 165, h: 24, kind: 'brick' },
      { x: 1025, yOff: 92, w: 170, h: 24, kind: 'brick' },
      { x: 1215, yOff: 176, w: 150, h: 24, kind: 'brick' },
      { x: 1510, yOff: 104, w: 160, h: 24, kind: 'brick' },
      { x: 1965, yOff: 118, w: 155, h: 24, kind: 'brick' },
      { x: 2188, yOff: 198, w: 165, h: 24, kind: 'brick' },
      { x: 2545, yOff: 102, w: 165, h: 24, kind: 'brick' },
      { x: 3035, yOff: 126, w: 170, h: 24, kind: 'brick' },
      { x: 3260, yOff: 208, w: 160, h: 24, kind: 'brick' },
      { x: 3620, yOff: 114, w: 160, h: 24, kind: 'brick' },
      { x: 4075, yOff: 148, w: 165, h: 24, kind: 'brick' },
      { x: 4315, yOff: 238, w: 150, h: 24, kind: 'brick' },
      { x: 4690, yOff: 112, w: 170, h: 24, kind: 'brick' },
      { x: 5195, yOff: 132, w: 170, h: 24, kind: 'brick' },
      { x: 5435, yOff: 224, w: 160, h: 24, kind: 'brick' },
      { x: 5845, yOff: 112, w: 165, h: 24, kind: 'brick' },
      { x: 6070, yOff: 206, w: 160, h: 24, kind: 'brick' },
      { x: 1320, yOff: 62, w: 74, h: 62, kind: 'pipe' },
      { x: 2825, yOff: 62, w: 74, h: 62, kind: 'pipe' },
      { x: 4475, yOff: 62, w: 74, h: 62, kind: 'pipe' },
      { x: 5560, yOff: 62, w: 74, h: 62, kind: 'pipe' },
    ] as PlatformBlock[],
    items: [
      { id: 1, x: 650, yOff: 184, taken: false },
      { id: 2, x: 1288, yOff: 224, taken: false },
      { id: 3, x: 2000, yOff: 166, taken: false },
      { id: 4, x: 2268, yOff: 246, taken: false },
      { id: 5, x: 2598, yOff: 150, taken: false },
      { id: 6, x: 3120, yOff: 174, taken: false },
      { id: 7, x: 3340, yOff: 256, taken: false },
      { id: 8, x: 4155, yOff: 196, taken: false },
      { id: 9, x: 4392, yOff: 286, taken: false },
      { id: 10, x: 5278, yOff: 180, taken: false },
      { id: 11, x: 5520, yOff: 272, taken: false },
      { id: 12, x: 6150, yOff: 252, taken: false },
    ] as PlatformCollectible[],
    foes: [
      { id: 1, x: 590, yOff: 36, w: 38, h: 36, vx: 50, minX: 520, maxX: 785, kind: 'wife', alive: true },
      { id: 2, x: 1048, yOff: 34, w: 36, h: 34, vx: -56, minX: 950, maxX: 1245, kind: 'baby', alive: true },
      { id: 3, x: 633, yOff: 172, w: 38, h: 36, vx: 44, minX: 615, maxX: 740, kind: 'wife', alive: true },
      { id: 4, x: 1534, yOff: 140, w: 36, h: 34, vx: -48, minX: 1518, maxX: 1628, kind: 'baby', alive: true },
      { id: 5, x: 2015, yOff: 36, w: 38, h: 36, vx: 58, minX: 1920, maxX: 2260, kind: 'wife', alive: true },
      { id: 6, x: 2228, yOff: 232, w: 36, h: 34, vx: -44, minX: 2200, maxX: 2314, kind: 'baby', alive: true },
      { id: 7, x: 2585, yOff: 136, w: 38, h: 36, vx: 48, minX: 2555, maxX: 2670, kind: 'wife', alive: true },
      { id: 8, x: 3038, yOff: 34, w: 36, h: 34, vx: -62, minX: 2960, maxX: 3290, kind: 'baby', alive: true },
      { id: 9, x: 3310, yOff: 244, w: 38, h: 36, vx: 46, minX: 3280, maxX: 3385, kind: 'wife', alive: true },
      { id: 10, x: 3618, yOff: 148, w: 36, h: 34, vx: -50, minX: 3630, maxX: 3745, kind: 'baby', alive: true },
      { id: 11, x: 4110, yOff: 184, w: 38, h: 36, vx: 52, minX: 4090, maxX: 4200, kind: 'wife', alive: true },
      { id: 12, x: 4360, yOff: 272, w: 36, h: 34, vx: -46, minX: 4330, maxX: 4430, kind: 'baby', alive: true },
      { id: 13, x: 4745, yOff: 36, w: 38, h: 36, vx: 64, minX: 4630, maxX: 4898, kind: 'wife', alive: true },
      { id: 14, x: 5235, yOff: 166, w: 36, h: 34, vx: -50, minX: 5210, maxX: 5330, kind: 'baby', alive: true },
      { id: 15, x: 5475, yOff: 260, w: 38, h: 36, vx: 48, minX: 5450, maxX: 5570, kind: 'wife', alive: true },
      { id: 16, x: 5848, yOff: 146, w: 36, h: 34, vx: -54, minX: 5860, maxX: 5980, kind: 'baby', alive: true },
      { id: 17, x: 6092, yOff: 242, w: 38, h: 36, vx: 52, minX: 6082, maxX: 6190, kind: 'wife', alive: true },
      { id: 18, x: 6240, yOff: 34, w: 36, h: 34, vx: -64, minX: 5700, maxX: 6330, kind: 'baby', alive: true },
    ] as PlatformFoe[],
  }
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
  const photoRef = useRef<HTMLImageElement | null>(null)
  useCanvas(canvasRef)
  const [hud, setHud] = useState<HudState>({ stage: 2, hearts: 3, wife })
  const [toast, setToast] = useState('اضغط للقفز، تفادى الزوجة والطفل وخذ القلوب')
  const state = useRef({
    start: 0,
    last: 0,
    hearts: 3,
    heartsTaken: 0,
    score: 0,
    cameraX: 0,
    jumpQueued: false,
    invulnUntil: 0,
    player: { x: 74, y: 220, w: 40, h: 50, vy: 0, onGround: false, prevY: 220 },
    level: null as null | ReturnType<typeof createPlatformLevel>,
    done: false,
  })

  useEffect(() => {
    const image = new Image()
    image.src = PLAYER_STAGE1_SRC
    photoRef.current = image
  }, [])

  useEffect(() => {
    const jump = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
        event.preventDefault()
        state.current.jumpQueued = true
      }
    }
    window.addEventListener('keydown', jump)
    return () => window.removeEventListener('keydown', jump)
  }, [])

  useEffect(() => {
    let frame = 0
    const loop = (now: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) {
        frame = requestAnimationFrame(loop)
        return
      }
      const box = canvas.getBoundingClientRect()
      const w = box.width
      const h = box.height
      const s = state.current
      if (!s.level) s.level = createPlatformLevel()
      const level = s.level
      const floorY = h - 78
      if (!s.start) s.start = now
      const dt = Math.min((now - (s.last || now)) / 1000, 0.04)
      s.last = now
      const elapsed = (now - s.start) / 1000

      const player = s.player
      let failed = false
      const platformRect = (block: PlatformBlock) => ({ x: block.x, y: floorY - block.yOff, w: block.w, h: block.h })
      const hurt = (message: string) => {
        if (now < s.invulnUntil || failed) return
        s.hearts -= 1
        setWife((value) => clamp(value - 7, 0, 100))
        setToast(message)
        if (s.hearts <= 0) {
          failed = true
          onFail('FAIL_2')
          return
        }
        s.invulnUntil = now + 1200
        player.x = Math.max(74, player.x - 170)
        player.y = floorY - player.h
        player.vy = 0
        player.onGround = true
      }

      if (s.jumpQueued && player.onGround) {
        player.vy = -560
        player.onGround = false
        setToast('قفزة!')
      }
      s.jumpQueued = false

      player.prevY = player.y
      player.x = clamp(player.x + 142 * dt, 40, level.worldWidth - 90)
      player.vy += 1320 * dt
      player.y += player.vy * dt
      player.onGround = false
      for (const block of level.platforms) {
        const rect = platformRect(block)
        const wasAbove = player.prevY + player.h <= rect.y + 5
        const isFallingThrough = player.y + player.h >= rect.y && player.vy >= 0
        if (wasAbove && isFallingThrough && player.x + player.w > rect.x + 6 && player.x < rect.x + rect.w - 6) {
          player.y = rect.y - player.h
          player.vy = 0
          player.onGround = true
        }
      }
      if (player.y > h + 90) hurt('طحت بالحفرة! اقفز بدري')
      if (failed) return

      const playerRect = { x: player.x, y: player.y, w: player.w, h: player.h }
      for (const item of level.items) {
        if (item.taken) continue
        const itemRect = { x: item.x - 15, y: floorY - item.yOff - 15, w: 30, h: 30 }
        if (rectsOverlap(playerRect, itemRect)) {
          item.taken = true
          s.heartsTaken += 1
          s.score += 120
          s.hearts = Math.min(3, s.hearts + 1)
          setToast('قلب إضافي ❤️')
        }
      }

      for (const foe of level.foes) {
        if (!foe.alive) continue
        foe.x += foe.vx * dt
        if (foe.x < foe.minX || foe.x > foe.maxX) {
          foe.vx *= -1
          foe.x = clamp(foe.x, foe.minX, foe.maxX)
        }
        const foeRect = { x: foe.x, y: floorY - foe.yOff, w: foe.w, h: foe.h }
        if (rectsOverlap(playerRect, foeRect)) {
          if (player.vy > 0 && player.prevY + player.h <= foeRect.y + 12) {
            foe.alive = false
            player.vy = -360
            player.onGround = false
            s.score += 180
            setToast(foe.kind === 'wife' ? 'قفزت فوق الزوجة!' : 'تفاديت الطفل!')
          } else {
            hurt(foe.kind === 'wife' ? 'الزوجة مسكتك 👸' : 'الطفل صادك 👶')
          }
        }
      }
      if (failed) return

      if (player.x >= level.worldWidth - 120 && !s.done) {
        s.done = true
        onWin(Math.max(0, Math.round(1300 + s.score + s.heartsTaken * 100 + s.hearts * 170 - elapsed * 5)))
        return
      }

      s.cameraX = clamp(player.x - w * 0.34, 0, Math.max(0, level.worldWidth - w))
      const cam = s.cameraX

      ctx.clearRect(0, 0, w, h)
      const sky = ctx.createLinearGradient(0, 0, 0, h)
      sky.addColorStop(0, '#bdeeff')
      sky.addColorStop(0.62, '#f7fbf7')
      sky.addColorStop(1, '#fff6d8')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(255,255,255,.9)'
      for (let i = 0; i < 8; i += 1) {
        const cloudX = ((i * 310 - cam * 0.35) % (w + 180)) - 90
        const cloudY = 44 + (i % 3) * 52
        ctx.beginPath()
        ctx.arc(cloudX, cloudY, 22, 0, Math.PI * 2)
        ctx.arc(cloudX + 25, cloudY - 7, 27, 0, Math.PI * 2)
        ctx.arc(cloudX + 56, cloudY, 20, 0, Math.PI * 2)
        ctx.fill()
      }

      level.platforms.forEach((block) => {
        const rect = platformRect(block)
        const x = rect.x - cam
        if (x > w + 80 || x + rect.w < -80) return
        if (block.kind === 'pipe') {
          ctx.fillStyle = '#238b52'
          ctx.fillRect(x, rect.y, rect.w, rect.h)
          ctx.fillStyle = '#82d69f'
          ctx.fillRect(x - 6, rect.y, rect.w + 12, 12)
        } else {
          ctx.fillStyle = block.kind === 'ground' ? '#8c5b28' : '#a9652d'
          ctx.fillRect(x, rect.y, rect.w, rect.h)
          ctx.fillStyle = '#30a46c'
          ctx.fillRect(x, rect.y - 8, rect.w, 8)
          ctx.fillStyle = 'rgba(255,255,255,.18)'
          for (let bx = x + 8; bx < x + rect.w - 10; bx += 28) ctx.fillRect(bx, rect.y + 8, 16, 5)
          ctx.strokeStyle = 'rgba(23,51,61,.18)'
          ctx.lineWidth = 2
          ctx.strokeRect(x, rect.y - 8, rect.w, rect.h + 8)
        }
      })

      const flagX = level.worldWidth - 96 - cam
      ctx.fillStyle = '#175f78'
      ctx.fillRect(flagX, floorY - 178, 7, 178)
      ctx.fillStyle = '#e5484d'
      ctx.beginPath()
      ctx.moveTo(flagX + 7, floorY - 172)
      ctx.lineTo(flagX + 88, floorY - 146)
      ctx.lineTo(flagX + 7, floorY - 120)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#14333d'
      ctx.font = '900 18px Cairo, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`قلوب ${s.heartsTaken}/12`, w / 2, 30)
      ctx.fillText(`المسافة ${Math.round((player.x / level.worldWidth) * 100)}%`, w / 2, 56)

      level.items.forEach((item) => {
        if (item.taken) return
        drawEmoji(ctx, '❤️', item.x - cam, floorY - item.yOff, 30)
      })

      level.foes.forEach((foe) => {
        if (!foe.alive) return
        drawEmoji(ctx, foe.kind === 'wife' ? '👸' : '👶', foe.x + foe.w / 2 - cam, floorY - foe.yOff + foe.h / 2, foe.kind === 'wife' ? 38 : 34)
      })

      ctx.save()
      if (now < s.invulnUntil && Math.floor(now / 120) % 2 === 0) ctx.globalAlpha = 0.42
      const playerScreenX = player.x - cam
      ctx.beginPath()
      ctx.roundRect(playerScreenX - 6, player.y - 4, player.w + 12, player.h + 8, 13)
      ctx.clip()
      if (photoRef.current?.complete && photoRef.current.naturalWidth > 0) {
        const image = photoRef.current
        ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight * 0.86, playerScreenX - 6, player.y - 4, player.w + 12, player.h + 8)
      } else {
        ctx.fillStyle = '#fff7d8'
        ctx.fillRect(playerScreenX - 6, player.y - 4, player.w + 12, player.h + 8)
        drawEmoji(ctx, '🧔', player.x + player.w / 2 - cam, player.y + 22, 34)
      }
      ctx.restore()
      ctx.strokeStyle = '#175f78'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.roundRect(playerScreenX - 6, player.y - 4, player.w + 12, player.h + 8, 13)
      ctx.stroke()

      ctx.fillStyle = 'rgba(23,95,120,.14)'
      ctx.fillRect(0, h - 42, w, 42)
      ctx.fillStyle = '#175f78'
      ctx.font = '900 16px Cairo, sans-serif'
      ctx.fillText('اضغط للقفز', w / 2, h - 17)
      setHud({ stage: 2, hearts: s.hearts, wife, mood: player.onGround ? undefined : 'jump' })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [onFail, onWin, setWife, wife])

  const jump = () => {
    state.current.jumpQueued = true
  }

  return (
    <StageShell hud={hud} title="طريق المنصات 🏁" toast={toast}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          jump()
        }}
        onMouseDown={jump}
        onTouchStart={(event) => {
          event.preventDefault()
          jump()
        }}
      />
    </StageShell>
  )
}

type SnakeCell = { x: number; y: number }
type SnakeTarget = SnakeCell & { imageIndex: number }
type SnakeDirection = 'up' | 'down' | 'left' | 'right'

const snakeVectors: Record<SnakeDirection, SnakeCell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const oppositeDirection: Record<SnakeDirection, SnakeDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
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
  const headPhotoRef = useRef<HTMLImageElement | null>(null)
  const targetPhotoRefs = useRef<HTMLImageElement[]>([])
  useCanvas(canvasRef)
  const [hud, setHud] = useState<HudState>({ stage: 3, hearts: 3, wife })
  const [toast, setToast] = useState('اسحب أو استخدم الأزرار، كل الوجوه وكبّر الثعبان')
  const state = useRef({
    last: 0,
    lastStep: 0,
    hearts: 3,
    score: 0,
    eaten: 0,
    direction: 'right' as SnakeDirection,
    nextDirection: 'right' as SnakeDirection,
    snake: [
      { x: 7, y: 10 },
      { x: 6, y: 10 },
      { x: 5, y: 10 },
    ] as SnakeCell[],
    target: { x: 8, y: 7, imageIndex: 0 } as SnakeTarget,
    ready: false,
    touchStart: null as null | SnakeCell,
    wallGraceUntil: 0,
    done: false,
  })
  const cols = 12
  const rows = 14
  const winTarget = 25

  useEffect(() => {
    const image = new Image()
    image.src = SNAKE_HEAD_SRC
    headPhotoRef.current = image
    targetPhotoRefs.current = SNAKE_TARGET_SRCS.map((src) => {
      const targetImage = new Image()
      targetImage.src = src
      return targetImage
    })
  }, [])

  const setDirection = useCallback((direction: SnakeDirection) => {
    const s = state.current
    if (oppositeDirection[direction] !== s.direction) s.nextDirection = direction
  }, [])

  const spawnTarget = useCallback(() => {
    const s = state.current
    const occupied = new Set(s.snake.map((part) => `${part.x},${part.y}`))
    let next: SnakeTarget = { x: 3, y: 3, imageIndex: s.eaten % SNAKE_TARGET_SRCS.length }
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = Math.floor(rand(1, cols - 1))
      const y = Math.floor(rand(1, rows - 1))
      if (!occupied.has(`${x},${y}`)) {
        next = { x, y, imageIndex: s.eaten % SNAKE_TARGET_SRCS.length }
        break
      }
    }
    s.target = next
  }, [])

  const resetSnake = useCallback(() => {
    const s = state.current
    s.snake = [
      { x: 5, y: 7 },
      { x: 4, y: 7 },
      { x: 3, y: 7 },
    ]
    s.direction = 'right'
    s.nextDirection = 'right'
    s.lastStep = 0
    s.wallGraceUntil = 0
    spawnTarget()
  }, [spawnTarget])

  useEffect(() => {
    const keyMove = (event: KeyboardEvent) => {
      const keyMap: Partial<Record<string, SnakeDirection>> = {
        ArrowUp: 'up',
        w: 'up',
        W: 'up',
        ArrowDown: 'down',
        s: 'down',
        S: 'down',
        ArrowLeft: 'left',
        a: 'left',
        A: 'left',
        ArrowRight: 'right',
        d: 'right',
        D: 'right',
      }
      const direction = keyMap[event.key]
      if (direction) {
        event.preventDefault()
        setDirection(direction)
      }
    }
    window.addEventListener('keydown', keyMove)
    return () => window.removeEventListener('keydown', keyMove)
  }, [setDirection])

  useEffect(() => {
    resetSnake()
  }, [resetSnake])

  useEffect(() => {
    let frame = 0
    const loop = (now: number) => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) {
        frame = requestAnimationFrame(loop)
        return
      }
      const box = canvas.getBoundingClientRect()
      const w = box.width
      const h = box.height
      const s = state.current
      s.last = now

      const speed = clamp(155 - s.eaten * 3, 78, 155)
      if (!s.lastStep) s.lastStep = now
      if (now - s.lastStep >= speed && !s.done) {
        s.lastStep = now
        s.direction = s.nextDirection
        const vector = snakeVectors[s.direction]
        const head = s.snake[0]
        const nextHead = { x: head.x + vector.x, y: head.y + vector.y }
        const wallHit = nextHead.x < 0 || nextHead.y < 0 || nextHead.x >= cols || nextHead.y >= rows
        const selfHit = s.snake.some((part, index) => index > 0 && part.x === nextHead.x && part.y === nextHead.y)
        if (wallHit) {
          if (!s.wallGraceUntil) {
            s.wallGraceUntil = now + 520
            setToast('انتبه للطوفة! عندك لحظة تلف')
          }
          if (now < s.wallGraceUntil) {
            frame = requestAnimationFrame(loop)
            return
          }
        }
        if (wallHit || selfHit) {
          s.hearts -= 1
          s.wallGraceUntil = 0
          setToast(wallHit ? 'اصطدمت بالطوفة!' : 'عضّيت نفسك!')
          if (s.hearts <= 0) {
            onFail('FAIL_3')
            return
          }
          resetSnake()
        } else {
          s.wallGraceUntil = 0
          s.snake.unshift(nextHead)
          if (nextHead.x === s.target.x && nextHead.y === s.target.y) {
            s.eaten += 1
            s.score += 120 + s.eaten * 8
            setToast(s.eaten >= winTarget ? 'الثعبان شبع!' : `رأس جديد ${s.eaten}/${winTarget}`)
            if (s.eaten >= winTarget && !s.done) {
              s.done = true
              onWin(Math.max(0, Math.round(1600 + s.score + s.hearts * 220)))
              return
            }
            spawnTarget()
          } else {
            s.snake.pop()
          }
        }
      }

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#f7fbf7'
      ctx.fillRect(0, 0, w, h)
      const cell = Math.floor(Math.min(w / (cols + 0.9), (h - 28) / (rows + 0.9)))
      const boardW = cell * cols
      const boardH = cell * rows
      const ox = (w - boardW) / 2
      const oy = 14
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.roundRect(ox - 8, oy - 8, boardW + 16, boardH + 16, 18)
      ctx.fill()
      ctx.strokeStyle = 'rgba(23,95,120,.18)'
      ctx.lineWidth = 3
      ctx.stroke()

      drawRoundImage(ctx, targetPhotoRefs.current[s.target.imageIndex], ox + s.target.x * cell + cell / 2, oy + s.target.y * cell + cell / 2, cell * 1.22, '🧔')
      s.snake.forEach((part, index) => {
        const x = ox + part.x * cell
        const y = oy + part.y * cell
        ctx.fillStyle = index === 0 ? '#175f78' : index % 2 === 0 ? '#30a46c' : '#237f93'
        ctx.beginPath()
        ctx.roundRect(x + 2, y + 2, cell - 4, cell - 4, Math.max(5, cell * 0.28))
        ctx.fill()
        if (index === 0) drawRoundImage(ctx, headPhotoRef.current, x + cell / 2, y + cell / 2, cell * 1.16, '🧔')
      })

      ctx.fillStyle = '#14333d'
      ctx.font = '900 18px Cairo, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`الرؤوس ${s.eaten}/${winTarget}`, w / 2, h - 28)
      setHud({ stage: 3, hearts: s.hearts, wife, mood: s.eaten % 5 === 0 && s.eaten > 0 ? 'jump' : undefined })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [onFail, onWin, resetSnake, spawnTarget, wife])

  const handlePointerStart = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const box = canvas.getBoundingClientRect()
    state.current.touchStart = { x: clientX - box.left, y: clientY - box.top }
  }

  const handlePointerMove = (clientX: number, clientY: number) => {
    const start = state.current.touchStart
    const canvas = canvasRef.current
    if (!start || !canvas) return
    const box = canvas.getBoundingClientRect()
    const dx = clientX - box.left - start.x
    const dy = clientY - box.top - start.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return
    setDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
    state.current.touchStart = { x: clientX - box.left, y: clientY - box.top }
  }

  return (
    <StageShell hud={hud} title="ثعبان الرؤوس 🐍" toast={toast} hideAvatar>
      <canvas
        ref={canvasRef}
        className="stage-canvas snake-canvas"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          handlePointerStart(event.clientX, event.clientY)
        }}
        onPointerMove={(event) => handlePointerMove(event.clientX, event.clientY)}
        onTouchStart={(event) => {
          const touch = event.touches[0]
          if (touch) handlePointerStart(touch.clientX, touch.clientY)
        }}
        onTouchMove={(event) => {
          event.preventDefault()
          const touch = event.touches[0]
          if (touch) handlePointerMove(touch.clientX, touch.clientY)
        }}
      />
      <div className="snake-pad" aria-label="Snake controls">
        <button type="button" aria-label="Up" onClick={() => setDirection('up')}>▲</button>
        <div>
          <button type="button" aria-label="Left" onClick={() => setDirection('left')}>◀</button>
          <button type="button" aria-label="Down" onClick={() => setDirection('down')}>▼</button>
          <button type="button" aria-label="Right" onClick={() => setDirection('right')}>▶</button>
        </div>
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
  const score = scoreBreakdown(scores, wife)
  return (
    <main className="game-screen card-screen">
      <section className="panel score-panel">
        <p className="eyebrow">سجّل النقاط 🏆</p>
        <h1>الحسبة النهائية</h1>
        <p className="score-formula">المعادلة: أداء المراحل + رضا الزوجة × ٣ + بونص إنهاء المهمة</p>
        <dl>
          <div><dt>المرحلة ١</dt><dd>{scores.s1}</dd></div>
          <div><dt>المرحلة ٢</dt><dd>{scores.s2}</dd></div>
          <div><dt>المرحلة ٣</dt><dd>{scores.s3}</dd></div>
          <div><dt>أداء المراحل</dt><dd>{score.stageTotal}</dd></div>
          <div><dt>رضا الزوجة × ٣</dt><dd>{score.wifeBonus}</dd></div>
          <div><dt>بونص إنهاء المهمة</dt><dd>{score.completionBonus}</dd></div>
          <div className="total"><dt>المجموع</dt><dd>{score.total}</dd></div>
        </dl>
        <label>
          الاسم
          <input value={name} maxLength={20} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="button" onClick={() => onSubmit(name.trim() || CONFIG.PLAYER_NAME)}>سجّل النقاط 🏆</button>
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
  return (
    <main className="game-screen card-screen">
      <section className="panel leaderboard">
        <p className="eyebrow">ليدربورد</p>
        <h1>أساطير الديوانية</h1>
        <p>{status}</p>
        {rows.length ? (
          <ol>
            {rows.slice(0, 10).map((row, index) => (
              <li className={row.name === playerName && row.score === playerScore ? 'mine' : ''} key={`${row.name}-${row.score}-${index}`}>
                <span>{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}</span>
                <strong>{row.name}</strong>
                <b>{row.score}</b>
              </li>
            ))}
          </ol>
        ) : null}
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
  useNoLongPressSelection()
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
    setRows([])
    setFailKind('FAIL_1')
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
      const { data, error } = await client.from('leaderboard').select('id,name,score').order('score', { ascending: false }).limit(50)
      if (error) throw error
      const best = new Map<string, LeaderRow>()
      for (const row of data ?? []) {
        const current = best.get(row.name)
        if (!current || row.score > current.score) best.set(row.name, row)
      }
      setRows([...best.values()].sort((a, b) => b.score - a.score).map((row, index) => ({ ...row, rank: index + 1 })))
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
        <div className="confetti">🎉🔥🍔😂🎉🔥🍔😂</div>
        <section className="panel">
          <p className="eyebrow">وصلت الديوانية! 🎉</p>
          <h1>نجحت بالمهمة يا {CONFIG.PLAYER_NAME}!</h1>
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
          <h1>ثلاث ألعاب أسرع وأوضح</h1>
          <ul className="howto-list">
            <li>حرّك المضرب وردّ الرضاعة صوب فم البيبي 🍼</li>
            <li>اضغط للقفز، تفادى الزوجة والطفل وخذ القلوب 🏁</li>
            <li>حرّك الثعبان بالسحب أو الأزرار وكل الوجوه 🐍</li>
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
        <p className="eyebrow">نسخة اللعب الجديدة</p>
        <h1>بو رضّاعة: مهمة الديوانية</h1>
        <p>٣ مراحل أسرع، أخف، وأوضح على الموبايل 🔥</p>
        <div className="actions">
          <button type="button" onClick={() => setScreen('stage1')}>ابدأ 🎮</button>
          <button type="button" className="secondary" onClick={() => setScreen('howTo')}>شلون ألعب؟</button>
        </div>
      </section>
      <div className="night-scene" aria-hidden="true">
        <span>👶</span>
        <span>🧽</span>
        <span>🏃</span>
        <span>🔥</span>
      </div>
      <PlayerAvatar wife={wife} />
    </main>
  )
}

export default App
