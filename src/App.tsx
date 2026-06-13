import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { CONFIG } from './config'
import './App.css'

type Screen = 'title' | 'howTo' | 'stage1' | 'stage2' | 'stage3' | 'win' | 'score' | 'leaderboard' | 'fail'
type StageKey = 's1' | 's2' | 's3'
type FailKind = 'FAIL_1' | 'FAIL_2' | 'FAIL_3'
type Vec = { x: number; y: number }
type HudState = { stage: number; hearts: number; wife: number; mood?: 'jump' | 'shake' | 'sweat' }
type LeaderRow = { id?: string; name: string; score: number; rank?: number }

const PHOTO_SRC = `${import.meta.env.BASE_URL}bo-raddaa.jpg`
const stageLabel = ['المرحلة ١ من ٣', 'المرحلة ٢ من ٣', 'المرحلة ٣ من ٣']
const failText: Record<FailKind, string> = {
  FAIL_1: 'البيبي قال: لا تحاول مرة ثانية بهالطريقة 😭',
  FAIL_2: 'المطبخ صار زلزال صحون 😱',
  FAIL_3: 'قفطوك قبل الديوانية… ارجع حاول بهدوء 🥲',
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const totalScore = (scores: Record<StageKey, number>, wife: number) =>
  clamp(Math.round(scores.s1 + scores.s2 + scores.s3 + wife * 3), 0, 5000)

function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number) {
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, x, y)
}

function drawFace(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, x: number, y: number, radius: number) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.clip()
  if (image?.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, 250, 150, 560, 560, x - radius, y - radius, radius * 2, radius * 2)
  } else {
    ctx.fillStyle = '#fff0c8'
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    drawEmoji(ctx, '🧔', x, y, radius * 1.2)
  }
  ctx.restore()
  ctx.strokeStyle = '#175f78'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
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
  const photoRef = useRef<HTMLImageElement | null>(null)
  useCanvas(canvasRef)
  const [hud, setHud] = useState<HudState>({ stage: 1, hearts: 3, wife })
  const [toast, setToast] = useState('حرّك الصورة، اليد والرضّاعة فوق إصبعك بشوي')
  const state = useRef({
    start: 0,
    last: 0,
    hearts: 3,
    feeds: 0,
    misses: 0,
    hold: 0,
    target: { x: 88, y: 430 },
    feeder: { x: 88, y: 430 },
    stunUntil: 0,
    swatUntil: 0,
    swatX: 0,
    done: false,
  })

  useEffect(() => {
    const image = new Image()
    image.src = PHOTO_SRC
    photoRef.current = image
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
      if (!s.start) s.start = now
      const dt = Math.min((now - (s.last || now)) / 1000, 0.04)
      s.last = now
      const elapsed = (now - s.start) / 1000

      if (now > s.stunUntil) {
        const smooth = 1 - Math.pow(0.004, dt)
        s.feeder.x += (s.target.x - s.feeder.x) * smooth
        s.feeder.y += (s.target.y - s.feeder.y) * smooth
      }

      const baby = {
        x: w * 0.5 + Math.sin(elapsed * 1.7) * Math.min(30, w * 0.08),
        y: h * 0.31 + Math.sin(elapsed * 2.3) * 15,
      }
      const mouth = { x: baby.x, y: baby.y + 30 }
      const open = elapsed % 3 < 1.35
      const closeEnough = dist(s.feeder, mouth) < 54
      const safeZone = dist(s.feeder, mouth) < 86

      if (open && closeEnough && now > s.stunUntil) {
        s.hold += dt
        if (s.hold > 0.48) {
          s.feeds += 1
          s.hold = 0
          setWife((value) => clamp(value + 8, 0, 100))
          setToast(s.feeds >= 5 ? 'البيبي شبع وانفتح الطريق 🎉' : `رضعة ممتازة ${s.feeds}/5`)
          if (s.feeds >= 5 && !s.done) {
            s.done = true
            onWin(Math.max(0, Math.round(1000 - s.misses * 25 - elapsed * 3)))
            return
          }
        }
      } else if (s.hold > 0 && !open) {
        s.hold = 0
        setToast('نطر فم البيبي يفتح 😮')
      } else if (s.hold > 0 && !safeZone) {
        s.hold = 0
        s.misses += 1
        setWife((value) => clamp(value - 3, 0, 100))
        setToast('قرب شوي بس لا تغطي البيبي 😅')
        if (s.misses % 5 === 0) {
          s.hearts -= 1
          if (s.hearts <= 0) {
            onFail('FAIL_1')
            return
          }
        }
      }

      if (!s.swatUntil && closeEnough && Math.random() < 0.003) {
        s.swatUntil = now + 650
        s.swatX = baby.x + (Math.random() > 0.5 ? -70 : 70)
      }
      if (s.swatUntil && now < s.swatUntil) {
        s.swatX += (baby.x - s.swatX) * 0.18
        if (dist({ x: s.swatX, y: baby.y + 16 }, s.feeder) < 45) {
          s.stunUntil = now + 450
          s.target = { x: w - 70, y: h - 110 }
          s.feeder = { ...s.target }
          s.swatUntil = 0
          s.misses += 1
          setToast('كف البيبي ردّك ورا ✋')
        }
      } else if (s.swatUntil) {
        s.swatUntil = 0
      }

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#f7fbf7'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(23,95,120,.09)'
      for (let x = -30; x < w + 30; x += 34) ctx.fillRect(x + ((elapsed * 8) % 34), 0, 3, h)

      const photo = photoRef.current
      const photoW = clamp(w * 0.2, 78, 108)
      const photoH = photoW * 1.25
      const photoX = clamp(s.feeder.x - photoW * 0.5, 8, w - photoW - 8)
      const photoY = clamp(s.feeder.y + 30, h * 0.42, h - photoH - 16)
      const shoulder = { x: photoX + photoW * 0.52, y: photoY + photoH * 0.4 }
      const hand = { x: s.feeder.x - 18, y: s.feeder.y + 18 }

      ctx.save()
      ctx.globalAlpha = 0.48
      ctx.beginPath()
      ctx.roundRect(photoX, photoY, photoW, photoH, 20)
      ctx.clip()
      if (photo?.complete && photo.naturalWidth > 0) ctx.drawImage(photo, photoX, photoY, photoW, photoH)
      else {
        ctx.fillStyle = '#fff0c8'
        ctx.fillRect(photoX, photoY, photoW, photoH)
        drawEmoji(ctx, '🧔', s.feeder.x, photoY + photoH * 0.45, photoW * 0.45)
      }
      ctx.restore()

      ctx.fillStyle = 'rgba(48,164,108,.16)'
      ctx.beginPath()
      ctx.arc(baby.x, baby.y + 8, Math.min(76, w * 0.18), 0, Math.PI * 2)
      ctx.fill()
      drawEmoji(ctx, '👶', baby.x, baby.y, Math.min(108, w * 0.25))
      drawEmoji(ctx, open ? '😮' : '😐', mouth.x, mouth.y, 30)

      ctx.lineWidth = 5
      ctx.strokeStyle = open ? '#30a46c' : '#e5484d'
      ctx.beginPath()
      ctx.arc(mouth.x, mouth.y, 44, 0, Math.PI * 2)
      ctx.stroke()

      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowColor = 'rgba(120,80,35,.25)'
      ctx.shadowBlur = 8
      ctx.strokeStyle = '#f6f0df'
      ctx.lineWidth = 28
      ctx.beginPath()
      ctx.moveTo(shoulder.x, shoulder.y)
      ctx.quadraticCurveTo((shoulder.x + hand.x) / 2 + 34, (shoulder.y + hand.y) / 2, hand.x, hand.y)
      ctx.stroke()
      ctx.strokeStyle = '#d2c5aa'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.strokeStyle = '#f0c28f'
      ctx.lineWidth = 13
      ctx.beginPath()
      ctx.moveTo(shoulder.x, shoulder.y)
      ctx.quadraticCurveTo((shoulder.x + hand.x) / 2 + 34, (shoulder.y + hand.y) / 2, hand.x, hand.y)
      ctx.stroke()
      ctx.fillStyle = '#f2c58f'
      ctx.beginPath()
      ctx.ellipse(hand.x, hand.y, 17, 13, -0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#bd875b'
      ctx.lineWidth = 2
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath()
        ctx.moveTo(hand.x + i * 7, hand.y + 1)
        ctx.lineTo(hand.x + i * 8 + 5, hand.y + 12)
        ctx.stroke()
      }
      ctx.restore()

      ctx.save()
      ctx.translate(s.feeder.x, s.feeder.y)
      ctx.rotate(-0.28)
      drawEmoji(ctx, '🍼', 0, 0, 42)
      ctx.restore()

      const active = open && safeZone
      ctx.fillStyle = active ? '#fff7d8' : '#ffffff'
      ctx.strokeStyle = active ? '#30a46c' : '#175f78'
      ctx.lineWidth = 3
      ctx.globalAlpha = 0.76
      ctx.beginPath()
      ctx.ellipse(s.feeder.x, s.feeder.y, 18, 13, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.globalAlpha = 1

      ctx.strokeStyle = 'rgba(23,95,120,.34)'
      ctx.setLineDash([6, 7])
      ctx.beginPath()
      ctx.moveTo(s.feeder.x, s.feeder.y)
      ctx.lineTo(s.feeder.x, s.feeder.y + 86)
      ctx.stroke()
      ctx.setLineDash([])
      drawEmoji(ctx, '👇', s.feeder.x, s.feeder.y + 102, 22)

      if (s.hold > 0) {
        ctx.strokeStyle = '#175f78'
        ctx.lineWidth = 7
        ctx.beginPath()
        ctx.arc(mouth.x, mouth.y, 56, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.hold / 0.48))
        ctx.stroke()
      }
      if (s.swatUntil) drawEmoji(ctx, '✋', s.swatX, baby.y + 16, 38)

      ctx.fillStyle = '#14333d'
      ctx.font = '900 22px Cairo, sans-serif'
      ctx.fillText(`${s.feeds}/5`, w / 2, h - 24)
      setHud({ stage: 1, hearts: s.hearts, wife, mood: s.hold > 0.25 ? 'jump' : undefined })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [onFail, onWin, setWife, wife])

  const move = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const box = canvas.getBoundingClientRect()
    state.current.target = {
      x: clamp(clientX - box.left, 42, box.width - 42),
      y: clamp(clientY - box.top - 86, 62, box.height - 48),
    }
  }

  return (
    <StageShell hud={hud} title="قرّب بو رضّاعة للبيبي" toast={toast}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          move(event.clientX, event.clientY)
        }}
        onPointerMove={(event) => move(event.clientX, event.clientY)}
        onMouseDown={(event) => move(event.clientX, event.clientY)}
        onMouseMove={(event) => {
          if (event.buttons) move(event.clientX, event.clientY)
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0]
          if (touch) move(touch.clientX, touch.clientY)
        }}
        onTouchMove={(event) => {
          event.preventDefault()
          const touch = event.touches[0]
          if (touch) move(touch.clientX, touch.clientY)
        }}
      />
    </StageShell>
  )
}

type PlatformBlock = { x: number; yOff: number; w: number; h: number; kind: 'ground' | 'brick' | 'pipe' }
type PlatformCollectible = { id: number; x: number; yOff: number; kind: 'coin' | 'dish' | 'heart'; taken: boolean }
type PlatformFoe = {
  id: number
  x: number
  yOff: number
  w: number
  h: number
  vx: number
  minX: number
  maxX: number
  kind: 'gamepad' | 'glitch'
  alive: boolean
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function createPlatformLevel() {
  return {
    worldWidth: 2400,
    platforms: [
      { x: 0, yOff: 0, w: 370, h: 34, kind: 'ground' },
      { x: 455, yOff: 0, w: 330, h: 34, kind: 'ground' },
      { x: 855, yOff: 0, w: 420, h: 34, kind: 'ground' },
      { x: 1375, yOff: 0, w: 350, h: 34, kind: 'ground' },
      { x: 1800, yOff: 0, w: 600, h: 34, kind: 'ground' },
      { x: 210, yOff: 108, w: 130, h: 22, kind: 'brick' },
      { x: 575, yOff: 150, w: 130, h: 22, kind: 'brick' },
      { x: 970, yOff: 112, w: 170, h: 22, kind: 'brick' },
      { x: 1475, yOff: 154, w: 145, h: 22, kind: 'brick' },
      { x: 1945, yOff: 124, w: 135, h: 22, kind: 'brick' },
      { x: 1245, yOff: 58, w: 70, h: 58, kind: 'pipe' },
    ] as PlatformBlock[],
    items: [
      { id: 1, x: 252, yOff: 160, kind: 'coin', taken: false },
      { id: 2, x: 310, yOff: 160, kind: 'dish', taken: false },
      { id: 3, x: 612, yOff: 205, kind: 'coin', taken: false },
      { id: 4, x: 670, yOff: 205, kind: 'dish', taken: false },
      { id: 5, x: 1015, yOff: 165, kind: 'dish', taken: false },
      { id: 6, x: 1090, yOff: 165, kind: 'coin', taken: false },
      { id: 7, x: 1280, yOff: 110, kind: 'heart', taken: false },
      { id: 8, x: 1515, yOff: 210, kind: 'coin', taken: false },
      { id: 9, x: 1570, yOff: 210, kind: 'dish', taken: false },
      { id: 10, x: 1990, yOff: 180, kind: 'coin', taken: false },
      { id: 11, x: 2050, yOff: 180, kind: 'dish', taken: false },
      { id: 12, x: 2250, yOff: 78, kind: 'coin', taken: false },
    ] as PlatformCollectible[],
    foes: [
      { id: 1, x: 560, yOff: 34, w: 36, h: 34, vx: 45, minX: 500, maxX: 720, kind: 'gamepad', alive: true },
      { id: 2, x: 1040, yOff: 34, w: 36, h: 34, vx: -50, minX: 900, maxX: 1215, kind: 'glitch', alive: true },
      { id: 3, x: 1530, yOff: 34, w: 36, h: 34, vx: 48, minX: 1415, maxX: 1680, kind: 'gamepad', alive: true },
      { id: 4, x: 2050, yOff: 34, w: 36, h: 34, vx: -55, minX: 1850, maxX: 2290, kind: 'glitch', alive: true },
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
  useCanvas(canvasRef)
  const [hud, setHud] = useState<HudState>({ stage: 2, hearts: 3, wife })
  const [toast, setToast] = useState('اضغط للقفز، اجمع الصحون والعملات ووصل العلم')
  const state = useRef({
    start: 0,
    last: 0,
    hearts: 3,
    collected: 0,
    score: 0,
    cameraX: 0,
    jumpQueued: false,
    invulnUntil: 0,
    player: { x: 74, y: 220, w: 36, h: 46, vy: 0, onGround: false, prevY: 220 },
    level: null as null | ReturnType<typeof createPlatformLevel>,
    done: false,
  })

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
      player.x = clamp(player.x + 132 * dt, 40, level.worldWidth - 90)
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
          s.collected += 1
          s.score += item.kind === 'dish' ? 160 : item.kind === 'heart' ? 80 : 100
          if (item.kind === 'heart') {
            s.hearts = Math.min(3, s.hearts + 1)
            setToast('قلب إضافي ❤️')
          } else {
            setWife((value) => clamp(value + 2, 0, 100))
            setToast(item.kind === 'dish' ? 'صحن ذهبي!' : 'عملة!')
          }
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
            setToast('دعست الوحش!')
          } else {
            hurt(foe.kind === 'gamepad' ? 'الكنترول لمس بو رضّاعة 🎮' : 'القلتچ صادك 🕹️')
          }
        }
      }
      if (failed) return

      if (player.x >= level.worldWidth - 120 && !s.done) {
        s.done = true
        onWin(Math.max(0, Math.round(1100 + s.score + s.collected * 90 + s.hearts * 160 - elapsed * 8)))
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
        ctx.fillStyle = block.kind === 'pipe' ? '#30a46c' : block.kind === 'brick' ? '#c66a2b' : '#8c5b28'
        ctx.fillRect(x, rect.y, rect.w, rect.h)
        ctx.fillStyle = block.kind === 'pipe' ? '#82d69f' : '#f5a623'
        for (let bx = x + 4; bx < x + rect.w - 6; bx += 26) ctx.fillRect(bx, rect.y + 5, 16, 5)
        if (block.kind === 'ground') {
          ctx.fillStyle = '#30a46c'
          ctx.fillRect(x, rect.y - 8, rect.w, 8)
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
      ctx.fillText(`كنوز ${s.collected}/12`, w / 2, 30)
      ctx.fillText(`المسافة ${Math.round((player.x / level.worldWidth) * 100)}%`, w / 2, 56)

      level.items.forEach((item) => {
        if (item.taken) return
        drawEmoji(ctx, item.kind === 'dish' ? '🍽️' : item.kind === 'heart' ? '❤️' : '🪙', item.x - cam, floorY - item.yOff, item.kind === 'heart' ? 28 : 30)
      })

      level.foes.forEach((foe) => {
        if (!foe.alive) return
        drawEmoji(ctx, foe.kind === 'gamepad' ? '🎮' : '🕹️', foe.x + foe.w / 2 - cam, floorY - foe.yOff + foe.h / 2, 36)
      })

      ctx.save()
      if (now < s.invulnUntil && Math.floor(now / 120) % 2 === 0) ctx.globalAlpha = 0.42
      ctx.fillStyle = '#fff7d8'
      ctx.strokeStyle = '#175f78'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.roundRect(player.x - cam, player.y, player.w, player.h, 10)
      ctx.fill()
      ctx.stroke()
      drawEmoji(ctx, '🧔', player.x + player.w / 2 - cam, player.y + 22, 34)
      ctx.restore()

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
    <StageShell hud={hud} title="مطبخ المنصات 🏁" toast={toast}>
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

type RunnerThing = { id: number; x: number; y: number; speed: number; kind: 'wife' | 'key' | 'burger'; size: number }

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
  const photoRef = useRef<HTMLImageElement | null>(null)
  useCanvas(canvasRef)
  const [hud, setHud] = useState<HudState>({ stage: 3, hearts: 3, wife })
  const [toast, setToast] = useState('اسحب الوجه، تفادى الزوجة والهمبرجر واجمع المفاتيح')
  const state = useRef({
    start: 0,
    last: 0,
    spawn: 0,
    nextId: 1,
    hearts: 3,
    score: 0,
    freeze: 0,
    faceScale: 1,
    combo: 0,
    player: { x: 88, y: 380 },
    target: { x: 88, y: 380 },
    finger: { x: 88, y: 460 },
    things: [] as RunnerThing[],
    done: false,
  })

  useEffect(() => {
    const image = new Image()
    image.src = PHOTO_SRC
    photoRef.current = image
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
      if (!s.start) s.start = now
      const dt = Math.min((now - (s.last || now)) / 1000, 0.04)
      s.last = now
      const elapsed = (now - s.start) / 1000
      const timeLeft = Math.max(0, 42 - elapsed)
      if (timeLeft <= 0 && !s.done) {
        s.done = true
        onWin(Math.max(0, Math.round(1000 + s.score + wife * 4 + s.hearts * 180)))
        return
      }

      s.player.x += (s.target.x - s.player.x) * (1 - Math.pow(0.002, dt))
      s.player.y += (s.target.y - s.player.y) * (1 - Math.pow(0.002, dt))
      s.faceScale += (1 - s.faceScale) * (1 - Math.pow(0.18, dt))
      s.spawn -= dt
      if (s.spawn <= 0) {
        const roll = Math.random()
        const kind: RunnerThing['kind'] = roll < 0.52 ? 'wife' : roll < 0.72 ? 'burger' : 'key'
        const scary = wife < 40 ? 40 : wife > 65 ? -20 : 0
        s.things.push({
          id: s.nextId++,
          kind,
          x: w + 50,
          y: rand(82, h - 72),
          speed: kind === 'key' ? rand(118, 158) : kind === 'burger' ? rand(132, 180) : rand(150 + scary, 220 + scary),
          size: kind === 'wife' ? 44 : kind === 'burger' ? 38 : 34,
        })
        s.spawn = rand(0.42, 0.72)
      }

      const frozen = now < s.freeze
      s.things.forEach((thing) => {
        thing.x -= thing.speed * dt * (frozen && thing.kind === 'wife' ? 0.25 : 1)
      })
      s.things = s.things.filter((thing) => {
        const faceRadius = 28 * s.faceScale
        if (dist(thing, s.player) < thing.size * 0.7 + faceRadius) {
          if (thing.kind === 'key') {
            s.freeze = now + 3500
            s.score += 250
            s.combo += 1
            s.faceScale = Math.max(0.82, s.faceScale - 0.08)
            setToast('مفتاح! التفتيش بطّأ شوي 🗝️')
          } else if (thing.kind === 'burger') {
            s.faceScale = clamp(s.faceScale + 0.38, 1, 2.1)
            s.score = Math.max(0, s.score - 90)
            setToast('الهمبرجر كبّر الوجه! تفاداه 🍔')
          } else if (thing.kind === 'wife') {
            s.hearts -= 1
            s.combo = 0
            s.faceScale = clamp(s.faceScale + 0.18, 1, 2.1)
            setToast('الزوجة شافتك!')
            if (s.hearts <= 0) onFail('FAIL_3')
          }
          return false
        }
        return thing.x > -70
      })

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#edf8f8'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#ffffff'
      for (let y = 72; y < h; y += 78) {
        ctx.fillRect(0, y, w, 36)
      }
      ctx.strokeStyle = 'rgba(23,95,120,.16)'
      ctx.lineWidth = 3
      for (let y = 90; y < h; y += 78) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }
      ctx.fillStyle = '#14333d'
      ctx.font = '900 18px Cairo, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`وصل الديوانية بعد ${Math.ceil(timeLeft)}`, w / 2, 32)
      ctx.fillStyle = '#175f78'
      ctx.font = '900 13px Cairo, sans-serif'
      ctx.fillText(`مفاتيح ${s.combo}`, w / 2, 56)

      s.things.forEach((thing) => {
        const emoji = thing.kind === 'wife' ? (wife < 35 ? '👹' : '👸') : thing.kind === 'key' ? '🗝️' : '🍔'
        drawEmoji(ctx, emoji, thing.x, thing.y, thing.size)
      })
      if (frozen) {
        ctx.fillStyle = 'rgba(23,95,120,.12)'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#175f78'
        ctx.fillText('التفتيش بطيء!', w / 2, 58)
      }
      ctx.fillStyle = 'rgba(245,166,35,.22)'
      ctx.beginPath()
      ctx.arc(s.player.x, s.player.y, 42 * s.faceScale, 0, Math.PI * 2)
      ctx.fill()
      drawFace(ctx, photoRef.current, s.player.x, s.player.y, 28 * s.faceScale)
      ctx.strokeStyle = 'rgba(23,95,120,.34)'
      ctx.setLineDash([6, 7])
      ctx.beginPath()
      ctx.moveTo(s.player.x, s.player.y)
      ctx.lineTo(s.player.x, s.player.y + 80)
      ctx.stroke()
      ctx.setLineDash([])
      drawEmoji(ctx, '👇', s.player.x, s.player.y + 96, 22)
      setHud({ stage: 3, hearts: s.hearts, wife, mood: s.hearts < 3 ? 'shake' : undefined })
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [onFail, onWin, wife])

  const move = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const box = canvas.getBoundingClientRect()
    const raw = {
      x: clamp(clientX - box.left, 44, box.width - 44),
      y: clamp(clientY - box.top, 78, box.height - 52),
    }
    state.current.finger = raw
    state.current.target = {
      x: raw.x,
      y: clamp(raw.y - 80, 78, box.height - 52),
    }
  }

  return (
    <StageShell hud={hud} title="الهروب للديوانية 🏃" toast={toast}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          move(event.clientX, event.clientY)
        }}
        onPointerMove={(event) => move(event.clientX, event.clientY)}
        onMouseDown={(event) => move(event.clientX, event.clientY)}
        onMouseMove={(event) => {
          if (event.buttons) move(event.clientX, event.clientY)
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0]
          if (touch) move(touch.clientX, touch.clientY)
        }}
        onTouchMove={(event) => {
          event.preventDefault()
          const touch = event.touches[0]
          if (touch) move(touch.clientX, touch.clientY)
        }}
      />
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
          <div><dt>المرحلة ١</dt><dd>{scores.s1}</dd></div>
          <div><dt>المرحلة ٢</dt><dd>{scores.s2}</dd></div>
          <div><dt>المرحلة ٣</dt><dd>{scores.s3}</dd></div>
          <div><dt>رضا الزوجة</dt><dd>{wife * 3}</dd></div>
          <div className="total"><dt>المجموع</dt><dd>{total}</dd></div>
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
            <li>حرّك الصورة بسلاسة وخلي الهدف عند فم البيبي 👶</li>
            <li>اضغط للقفز في مرحلة المنصات، اجمع الكنوز ووصل العلم 🏁</li>
            <li>اسحب الوجه واهرب من الزوجة والهمبرجر للديوانية 🏃</li>
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
