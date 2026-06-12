import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type GameStatus = 'ready' | 'playing' | 'paused' | 'ended'

type Vec = {
  x: number
  y: number
}

type Player = Vec & {
  radius: number
  shieldUntil: number
  magnetUntil: number
  trail: Vec[]
}

type PickupKind = 'core' | 'shield' | 'magnet' | 'time'

type Pickup = Vec & {
  id: number
  kind: PickupKind
  radius: number
  spin: number
  value: number
}

type Hazard = Vec & {
  id: number
  radius: number
  vx: number
  vy: number
  phase: number
}

type Particle = Vec & {
  id: number
  vx: number
  vy: number
  life: number
  ttl: number
  color: string
  radius: number
}

type GameSnapshot = {
  score: number
  best: number
  combo: number
  timeLeft: number
  level: number
  status: GameStatus
  message: string
}

type GameState = {
  status: GameStatus
  score: number
  best: number
  combo: number
  level: number
  timeLeft: number
  nextPickupId: number
  nextHazardId: number
  nextParticleId: number
  lastTime: number
  target: Vec
  player: Player
  pickups: Pickup[]
  hazards: Hazard[]
  particles: Particle[]
  keys: Set<string>
  width: number
  height: number
  dpr: number
  message: string
}

const ROUND_SECONDS = 75
const BEST_KEY = 'neon-harvest-rush-best'
const colors = {
  ink: '#172026',
  panel: '#f8f1df',
  grid: '#d8c7a5',
  core: '#f6c646',
  shield: '#2aa7a1',
  magnet: '#d9577a',
  time: '#5b74d6',
  hazard: '#e23b32',
  player: '#f7f2e7',
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function distance(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function createPlayer(width: number, height: number): Player {
  return {
    x: width * 0.5,
    y: height * 0.58,
    radius: 16,
    shieldUntil: 0,
    magnetUntil: 0,
    trail: [],
  }
}

function makePickup(width: number, height: number, id: number, elapsed = 0): Pickup {
  const roll = Math.random()
  const kind: PickupKind =
    roll > 0.92 ? 'time' : roll > 0.8 ? 'magnet' : roll > 0.66 ? 'shield' : 'core'
  return {
    id,
    kind,
    x: rand(36, width - 36),
    y: rand(72, height - 38),
    radius: kind === 'core' ? 10 : 13,
    spin: elapsed + rand(0, Math.PI * 2),
    value: kind === 'core' ? 10 : 0,
  }
}

function makeHazard(width: number, height: number, id: number, level: number): Hazard {
  const side = Math.floor(rand(0, 4))
  const speed = rand(72, 118) + level * 8
  const angle =
    side === 0
      ? rand(0.2, Math.PI - 0.2)
      : side === 1
        ? rand(Math.PI + 0.2, Math.PI * 2 - 0.2)
        : side === 2
          ? rand(-1.2, 1.2)
          : rand(Math.PI - 1.2, Math.PI + 1.2)

  return {
    id,
    x: side === 0 ? rand(20, width - 20) : side === 1 ? rand(20, width - 20) : side === 2 ? -28 : width + 28,
    y: side === 0 ? -28 : side === 1 ? height + 28 : rand(80, height - 20),
    radius: rand(13, 20),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    phase: rand(0, Math.PI * 2),
  }
}

function burst(state: GameState, x: number, y: number, color: string, amount: number) {
  for (let i = 0; i < amount; i += 1) {
    const angle = rand(0, Math.PI * 2)
    const speed = rand(40, 190)
    state.particles.push({
      id: state.nextParticleId,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      ttl: rand(0.35, 0.85),
      color,
      radius: rand(2, 5),
    })
    state.nextParticleId += 1
  }
}

function initialGame(best: number): GameState {
  const width = 960
  const height = 620
  return {
    status: 'ready',
    score: 0,
    best,
    combo: 1,
    level: 1,
    timeLeft: ROUND_SECONDS,
    nextPickupId: 8,
    nextHazardId: 5,
    nextParticleId: 1,
    lastTime: 0,
    target: { x: width * 0.5, y: height * 0.58 },
    player: createPlayer(width, height),
    pickups: Array.from({ length: 8 }, (_, index) => makePickup(width, height, index + 1)),
    hazards: Array.from({ length: 5 }, (_, index) => makeHazard(width, height, index + 1, 1)),
    particles: [],
    keys: new Set(),
    width,
    height,
    dpr: 1,
    message: 'Collect energy. Keep the combo alive. Avoid red pulses.',
  }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, spin: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(spin)
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < 10; i += 1) {
    const pointRadius = i % 2 === 0 ? radius : radius * 0.48
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2
    const px = Math.cos(angle) * pointRadius
    const py = Math.sin(angle) * pointRadius
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function render(ctx: CanvasRenderingContext2D, state: GameState, elapsed: number) {
  const { width, height, player } = state
  ctx.clearRect(0, 0, width, height)

  const sky = ctx.createLinearGradient(0, 0, width, height)
  sky.addColorStop(0, '#113a44')
  sky.addColorStop(0.48, '#172026')
  sky.addColorStop(1, '#3d2531')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)

  ctx.globalAlpha = 0.32
  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  for (let x = 0; x < width; x += 42) {
    ctx.beginPath()
    ctx.moveTo(x + ((elapsed * 14) % 42), 64)
    ctx.lineTo(x - 180 + ((elapsed * 14) % 42), height)
    ctx.stroke()
  }
  for (let y = 74; y < height; y += 42) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y + Math.sin(elapsed + y) * 10)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  state.pickups.forEach((pickup) => {
    const pulse = Math.sin(elapsed * 4 + pickup.spin) * 2
    const color =
      pickup.kind === 'shield'
        ? colors.shield
        : pickup.kind === 'magnet'
          ? colors.magnet
          : pickup.kind === 'time'
            ? colors.time
            : colors.core
    ctx.shadowColor = color
    ctx.shadowBlur = 14
    if (pickup.kind === 'core') {
      drawStar(ctx, pickup.x, pickup.y, pickup.radius + pulse, color, elapsed * 2 + pickup.spin)
    } else {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(pickup.x, pickup.y, pickup.radius + pulse, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff7e6'
      ctx.font = '800 14px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(pickup.kind === 'shield' ? 'S' : pickup.kind === 'magnet' ? 'M' : '+', pickup.x, pickup.y + 1)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }
    ctx.shadowBlur = 0
  })

  state.hazards.forEach((hazard) => {
    const pulse = Math.sin(elapsed * 5 + hazard.phase) * 4
    ctx.strokeStyle = colors.hazard
    ctx.lineWidth = 4
    ctx.shadowColor = colors.hazard
    ctx.shadowBlur = 16
    ctx.beginPath()
    ctx.arc(hazard.x, hazard.y, hazard.radius + pulse, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(hazard.x - hazard.radius, hazard.y)
    ctx.lineTo(hazard.x + hazard.radius, hazard.y)
    ctx.moveTo(hazard.x, hazard.y - hazard.radius)
    ctx.lineTo(hazard.x, hazard.y + hazard.radius)
    ctx.stroke()
    ctx.shadowBlur = 0
  })

  player.trail.forEach((point, index) => {
    ctx.globalAlpha = index / Math.max(player.trail.length, 1)
    ctx.fillStyle = '#f6c646'
    ctx.beginPath()
    ctx.arc(point.x, point.y, player.radius * (index / player.trail.length) * 0.82, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.globalAlpha = 1

  ctx.save()
  ctx.translate(player.x, player.y)
  const hasShield = state.status === 'playing' && player.shieldUntil > elapsed
  const hasMagnet = state.status === 'playing' && player.magnetUntil > elapsed
  if (hasMagnet) {
    ctx.strokeStyle = 'rgba(217, 87, 122, 0.34)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, 92 + Math.sin(elapsed * 8) * 5, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (hasShield) {
    ctx.strokeStyle = 'rgba(42, 167, 161, 0.75)'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(0, 0, player.radius + 12, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.shadowColor = '#f6c646'
  ctx.shadowBlur = 18
  ctx.fillStyle = colors.player
  ctx.beginPath()
  ctx.moveTo(0, -22)
  ctx.lineTo(17, 17)
  ctx.lineTo(0, 10)
  ctx.lineTo(-17, 17)
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#f6c646'
  ctx.beginPath()
  ctx.arc(0, -2, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  state.particles.forEach((particle) => {
    const alpha = 1 - particle.life / particle.ttl
    ctx.globalAlpha = alpha
    ctx.fillStyle = particle.color
    ctx.beginPath()
    ctx.arc(particle.x, particle.y, particle.radius * alpha, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.globalAlpha = 1

  if (state.status !== 'playing') {
    ctx.fillStyle = 'rgba(23, 32, 38, 0.7)'
    ctx.fillRect(0, 56, width, height - 56)
  }
}

function update(state: GameState, dt: number, elapsed: number) {
  if (state.status !== 'playing') return

  state.timeLeft -= dt
  state.level = clamp(1 + Math.floor((ROUND_SECONDS - state.timeLeft) / 15), 1, 6)
  if (state.timeLeft <= 0) {
    state.status = 'ended'
    state.timeLeft = 0
    state.message = state.score >= state.best ? 'New best run. Press restart to chase it again.' : 'Run complete. Restart for a cleaner route.'
    state.best = Math.max(state.best, state.score)
    localStorage.setItem(BEST_KEY, String(state.best))
    return
  }

  const direction = { x: 0, y: 0 }
  if (state.keys.has('arrowleft') || state.keys.has('a')) direction.x -= 1
  if (state.keys.has('arrowright') || state.keys.has('d')) direction.x += 1
  if (state.keys.has('arrowup') || state.keys.has('w')) direction.y -= 1
  if (state.keys.has('arrowdown') || state.keys.has('s')) direction.y += 1
  const movingWithKeys = direction.x !== 0 || direction.y !== 0

  if (movingWithKeys) {
    const length = Math.hypot(direction.x, direction.y)
    const speed = 278
    state.player.x += (direction.x / length) * speed * dt
    state.player.y += (direction.y / length) * speed * dt
    state.target.x = state.player.x
    state.target.y = state.player.y
  } else {
    const follow = 1 - Math.pow(0.0015, dt)
    state.player.x += (state.target.x - state.player.x) * follow
    state.player.y += (state.target.y - state.player.y) * follow
  }

  state.player.x = clamp(state.player.x, 24, state.width - 24)
  state.player.y = clamp(state.player.y, 78, state.height - 24)
  state.player.trail.push({ x: state.player.x, y: state.player.y })
  if (state.player.trail.length > 18) state.player.trail.shift()

  state.pickups.forEach((pickup) => {
    if (state.player.magnetUntil > elapsed && pickup.kind === 'core' && distance(pickup, state.player) < 122) {
      const pull = 1 - Math.pow(0.02, dt)
      pickup.x += (state.player.x - pickup.x) * pull
      pickup.y += (state.player.y - pickup.y) * pull
    }
  })

  state.hazards.forEach((hazard) => {
    hazard.x += hazard.vx * dt
    hazard.y += hazard.vy * dt
    if (hazard.x < -70 || hazard.x > state.width + 70 || hazard.y < -80 || hazard.y > state.height + 80) {
      const fresh = makeHazard(state.width, state.height, hazard.id, state.level)
      Object.assign(hazard, fresh)
    }
  })

  state.particles = state.particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx * dt,
      y: particle.y + particle.vy * dt,
      vy: particle.vy + 90 * dt,
      life: particle.life + dt,
    }))
    .filter((particle) => particle.life < particle.ttl)

  state.pickups = state.pickups.filter((pickup) => {
    if (distance(pickup, state.player) > pickup.radius + state.player.radius) return true

    if (pickup.kind === 'core') {
      const earned = pickup.value * state.combo
      state.score += earned
      state.combo = clamp(state.combo + 1, 1, 9)
      state.message = `+${earned} energy`
      burst(state, pickup.x, pickup.y, colors.core, 12)
    } else if (pickup.kind === 'shield') {
      state.player.shieldUntil = elapsed + 7
      state.score += 15
      state.message = 'Shield online'
      burst(state, pickup.x, pickup.y, colors.shield, 16)
    } else if (pickup.kind === 'magnet') {
      state.player.magnetUntil = elapsed + 8
      state.score += 15
      state.message = 'Magnet field active'
      burst(state, pickup.x, pickup.y, colors.magnet, 16)
    } else {
      state.timeLeft = Math.min(ROUND_SECONDS, state.timeLeft + 6)
      state.score += 20
      state.message = '+6 seconds'
      burst(state, pickup.x, pickup.y, colors.time, 18)
    }

    return false
  })

  while (state.pickups.length < 8 + Math.floor(state.level / 2)) {
    state.nextPickupId += 1
    state.pickups.push(makePickup(state.width, state.height, state.nextPickupId, elapsed))
  }

  while (state.hazards.length < 4 + state.level) {
    state.nextHazardId += 1
    state.hazards.push(makeHazard(state.width, state.height, state.nextHazardId, state.level))
  }

  state.hazards.forEach((hazard) => {
    if (distance(hazard, state.player) > hazard.radius + state.player.radius) return
    if (state.player.shieldUntil > elapsed) {
      state.player.shieldUntil = 0
      state.score += 25
      state.message = 'Shield broke the pulse'
      burst(state, hazard.x, hazard.y, colors.shield, 20)
      Object.assign(hazard, makeHazard(state.width, state.height, hazard.id, state.level))
      return
    }
    state.combo = 1
    state.score = Math.max(0, state.score - 35)
    state.timeLeft = Math.max(0, state.timeLeft - 4)
    state.message = 'Pulse hit. Combo reset.'
    burst(state, state.player.x, state.player.y, colors.hazard, 22)
    Object.assign(hazard, makeHazard(state.width, state.height, hazard.id, state.level))
  })
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [initialBest] = useState(() => Number(localStorage.getItem(BEST_KEY) ?? 0))
  const initialState = useMemo(() => initialGame(initialBest), [initialBest])
  const stateRef = useRef<GameState>(initialState)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => ({
    score: 0,
    best: initialBest,
    combo: 1,
    timeLeft: ROUND_SECONDS,
    level: 1,
    status: 'ready',
    message: 'Collect energy. Keep the combo alive. Avoid red pulses.',
  }))

  const startGame = () => {
    const best = stateRef.current.best
    stateRef.current = initialGame(best)
    stateRef.current.status = 'playing'
    stateRef.current.message = 'Go.'
  }

  const togglePause = () => {
    const state = stateRef.current
    if (state.status === 'playing') {
      state.status = 'paused'
      state.message = 'Paused'
    } else if (state.status === 'paused') {
      state.status = 'playing'
      state.message = 'Back in the rush'
      state.lastTime = 0
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      stateRef.current.width = rect.width
      stateRef.current.height = rect.height
      stateRef.current.dpr = dpr
      stateRef.current.player.x = clamp(stateRef.current.player.x, 24, rect.width - 24)
      stateRef.current.player.y = clamp(stateRef.current.player.y, 78, rect.height - 24)
    }

    let resizeFrame = 0
    const scheduleResize = () => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(resize)
    }

    resize()
    const scheduledObserver = new ResizeObserver(scheduleResize)
    scheduledObserver.observe(canvas)

    let frame = 0
    let snapshotTimer = 0
    const tick = (time: number) => {
      const state = stateRef.current
      if (!state.lastTime) state.lastTime = time
      const dt = Math.min((time - state.lastTime) / 1000, 0.033)
      state.lastTime = time
      const elapsed = time / 1000
      update(state, dt, elapsed)
      render(ctx, state, elapsed)
      snapshotTimer += dt
      if (snapshotTimer > 0.12 || state.status !== snapshot.status) {
        snapshotTimer = 0
        setSnapshot({
          score: state.score,
          best: state.best,
          combo: state.combo,
          timeLeft: state.timeLeft,
          level: state.level,
          status: state.status,
          message: state.message,
        })
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(resizeFrame)
      scheduledObserver.disconnect()
    }
  }, [snapshot.status])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd', ' '].includes(key)) {
        event.preventDefault()
      }
      if (key === ' ') {
        togglePause()
        return
      }
      stateRef.current.keys.add(key)
    }
    const keyUp = (event: KeyboardEvent) => {
      stateRef.current.keys.delete(event.key.toLowerCase())
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [])

  const updateTarget = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const state = stateRef.current
    state.target.x = clamp(clientX - rect.left, 24, state.width - 24)
    state.target.y = clamp(clientY - rect.top, 78, state.height - 24)
  }

  return (
    <main className="game-shell">
      <section className="game-stage" aria-label="Neon Harvest Rush game">
        <div className="hud" aria-live="polite">
          <div>
            <span>Score</span>
            <strong>{snapshot.score}</strong>
          </div>
          <div>
            <span>Best</span>
            <strong>{snapshot.best}</strong>
          </div>
          <div>
            <span>Combo</span>
            <strong>x{snapshot.combo}</strong>
          </div>
          <div>
            <span>Time</span>
            <strong>{Math.ceil(snapshot.timeLeft)}</strong>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          className="playfield"
          role="img"
          aria-label="Move the ship to collect bright energy and avoid red pulses."
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            updateTarget(event.clientX, event.clientY)
            if (stateRef.current.status === 'ready' || stateRef.current.status === 'ended') startGame()
          }}
          onPointerMove={(event) => updateTarget(event.clientX, event.clientY)}
        />

        <div className={`overlay ${snapshot.status === 'playing' ? 'is-hidden' : ''}`}>
          <p className="eyebrow">Neon Harvest Rush</p>
          <h1>{snapshot.status === 'ended' ? 'Run complete' : snapshot.status === 'paused' ? 'Paused' : 'Collect. Dodge. Chain.'}</h1>
          <p>{snapshot.message}</p>
          <div className="actions">
            <button type="button" onClick={startGame}>
              {snapshot.status === 'ended' ? 'Restart' : 'Start'}
            </button>
            {snapshot.status === 'paused' ? (
              <button type="button" className="secondary" onClick={togglePause}>
                Resume
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="side-panel" aria-label="Game controls and status">
        <div>
          <p className="eyebrow">Level {snapshot.level}</p>
          <h2>{snapshot.message}</h2>
        </div>
        <div className="meter" aria-label="Round time">
          <span style={{ width: `${(snapshot.timeLeft / ROUND_SECONDS) * 100}%` }} />
        </div>
        <div className="controls">
          <button type="button" onClick={snapshot.status === 'playing' ? togglePause : startGame}>
            {snapshot.status === 'playing' ? 'Pause' : snapshot.status === 'paused' ? 'Resume' : 'Play'}
          </button>
          <button type="button" className="secondary" onClick={startGame}>
            Restart
          </button>
        </div>
        <ul>
          <li>Drag or tap to steer on touch screens.</li>
          <li>Use WASD or arrow keys on keyboard.</li>
          <li>Yellow stars build combo. Red pulses break it.</li>
          <li>Shield blocks one hit. Magnet pulls nearby stars.</li>
        </ul>
      </aside>
    </main>
  )
}

export default App
