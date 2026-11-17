<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { computeCamera } from '@/utils/aviatorCamera'

const props = defineProps({
  phase: { type: String, default: 'betting' },
  round: { type: Object, default: null },
  multiplier: { type: Number, default: 1 },
  countdown: { type: Number, default: 10 },
  finalMultiplier: { type: Number, default: 1.01 },
  reducedMotion: { type: Boolean, default: false },
  now: { type: Number, default: () => Date.now() },
})

const canvasRef = ref(null)
const canvasFailed = ref(false)
let animationFrameId = null

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const drawPlane = (ctx, x, y, angle) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)

  const gradient = ctx.createLinearGradient(-28, 0, 36, 0)
  gradient.addColorStop(0, '#ffd7de')
  gradient.addColorStop(0.35, '#ff7aa7')
  gradient.addColorStop(0.7, '#ff4c73')
  gradient.addColorStop(1, '#ff2d55')

  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.moveTo(-18, 0)
  ctx.lineTo(28, 0)
  ctx.lineTo(38, 5)
  ctx.lineTo(14, 8)
  ctx.lineTo(-12, 8)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#ffd7de'
  ctx.beginPath()
  ctx.moveTo(4, -3)
  ctx.lineTo(30, -12)
  ctx.lineTo(12, 7)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#ff8ea6'
  ctx.beginPath()
  ctx.moveTo(-12, 0)
  ctx.lineTo(-24, -8)
  ctx.lineTo(-24, 8)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#ffb4c4'
  ctx.beginPath()
  ctx.moveTo(-30, 0)
  ctx.lineTo(-46, -2)
  ctx.lineTo(-42, 0)
  ctx.lineTo(-46, 2)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#fff1f5'
  ctx.beginPath()
  ctx.moveTo(18, 0)
  ctx.lineTo(22, -4)
  ctx.lineTo(24, 0)
  ctx.lineTo(22, 4)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

const drawTrail = (ctx, points) => {
  if (points.length < 2) return

  const fill = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height)
  fill.addColorStop(0, 'rgba(244, 63, 94, 0.35)')
  fill.addColorStop(1, 'rgba(244, 63, 94, 0.02)')

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y)
  }
  ctx.lineTo(points[points.length - 1].x, ctx.canvas.height * 0.9)
  ctx.lineTo(points[0].x, ctx.canvas.height * 0.9)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y)
  }
  ctx.strokeStyle = 'rgba(251, 113, 133, 0.96)'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
}

const computeTrail = (width, height, targetMultiplier) => {
  const origin = { x: 78, y: height * 0.82 }
  const progressScale = 0.7 + Math.min(1.4, Math.max(0, targetMultiplier - 1) * 0.14)
  const points = []
  const totalSamples = 24

  for (let index = 0; index <= totalSamples; index += 1) {
    const t = index / totalSamples
    const x = origin.x + (t * width * progressScale) * (0.46 + Math.min(0.24, (targetMultiplier - 1) * 0.02))
    const y = origin.y - Math.pow(t, 1.8) * (height * 0.45 + Math.min(60, (targetMultiplier - 1) * 8))
    points.push({ x, y })
  }

  return points
}

const drawExplosion = (ctx, x, y, nowTs) => {
  const elapsed = Math.max(0, nowTs - (props.round?.crashedAt ? Date.parse(props.round.crashedAt) : nowTs))
  const alpha = clamp(1 - elapsed / 2200, 0, 1)
  if (alpha <= 0) return

  ctx.save()
  ctx.fillStyle = `rgba(255,255,255,${0.7 * alpha})`
  ctx.beginPath()
  ctx.arc(x, y, 18 + (1 - alpha) * 34, 0, Math.PI * 2)
  ctx.fill()

  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2 + elapsed / 320
    const radius = 12 + (index % 5) * 8 + (1 - alpha) * 52
    const dx = x + Math.cos(angle) * radius
    const dy = y + Math.sin(angle) * radius
    const size = 2 + (index % 4)

    ctx.beginPath()
    ctx.fillStyle = index % 2 === 0 ? 'rgba(255, 143, 72, 0.9)' : 'rgba(255, 82, 82, 0.9)'
    ctx.arc(dx, dy, size, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

const renderFrame = () => {
  const canvas = canvasRef.value
  if (!canvas) return

  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo crear el contexto 2D del canvas.')

    const rect = canvas.getBoundingClientRect()
    const width = Math.max(320, rect.width)
    const height = Math.max(260, rect.height)
    const ratio = window.devicePixelRatio || 1

    canvas.width = width * ratio
    canvas.height = height * ratio
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const glow = ctx.createRadialGradient(width * 0.7, height * 0.18, 30, width * 0.7, height * 0.18, width * 0.8)
    glow.addColorStop(0, 'rgba(244, 63, 94, 0.18)')
    glow.addColorStop(0.4, 'rgba(59, 130, 246, 0.10)')
    glow.addColorStop(1, 'rgba(9, 9, 11, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height)

    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2 + props.now / 18000
      const startX = width * 0.5 + Math.cos(angle) * 28
      const startY = height * 0.16 + Math.sin(angle) * 28
      const endX = width * 0.5 + Math.cos(angle) * (width * 0.48)
      const endY = height * 0.16 + Math.sin(angle) * (height * 0.38)
      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.lineTo(endX, endY)
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1.2
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.moveTo(52, height * 0.9)
    ctx.lineTo(width - 52, height * 0.9)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)'
    ctx.lineWidth = 1
    ctx.stroke()

    if (props.phase === 'betting') {
      const origin = { x: 92, y: height * 0.82 }
      drawPlane(ctx, origin.x, origin.y, -0.18)
      return
    }

    const targetMultiplier = props.phase === 'crashed' ? Math.max(1.01, Number(props.finalMultiplier) || 1.01) : Math.max(1.01, Number(props.multiplier) || 1.01)
    const elapsed = Math.max(0, Number(props.round?.startedAt ? (props.now - Date.parse(props.round.startedAt)) : 0))
    const camera = computeCamera(elapsed, targetMultiplier, width, height)
    const points = []
    const totalSamples = 28
    for (let index = 0; index <= totalSamples; index += 1) {
      const progress = index / totalSamples
      const worldX = Math.max(0, elapsed * 0.12 * progress)
      const worldY = Math.max(0, targetMultiplier * 30 * progress)
      const x = width * 0.2 + (worldX * camera.scale)
      const y = height * 0.82 - (worldY * camera.scale)
      points.push({ x: clamp(x, camera.safeBounds.left, camera.safeBounds.right), y: clamp(y, camera.safeBounds.top, camera.safeBounds.bottom) })
    }

    if (points.length > 1) {
      drawTrail(ctx, points)
    }

    const last = points[points.length - 1]
    const prev = points[Math.max(0, points.length - 2)]
    const angle = clamp(Math.atan2(last.y - prev.y, last.x - prev.x), -0.6, 0.6)
    drawPlane(ctx, last.x, last.y, angle)

    if (props.phase === 'crashed') {
      drawExplosion(ctx, last.x, last.y, props.now)
    }
  } catch (error) {
    canvasFailed.value = true
  }
}

const scheduleFrame = () => {
  if (props.reducedMotion) {
    renderFrame()
    return
  }
  if (document.visibilityState === 'hidden') return
  if (animationFrameId) cancelAnimationFrame(animationFrameId)
  animationFrameId = requestAnimationFrame(() => {
    renderFrame()
    if (props.phase !== 'betting' && document.visibilityState !== 'hidden') {
      scheduleFrame()
    }
  })
}

onMounted(() => {
  scheduleFrame()
  const onVisibility = () => {
    if (document.visibilityState === 'visible') scheduleFrame()
    else if (animationFrameId) cancelAnimationFrame(animationFrameId)
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.__aviatorCanvasVisibility = onVisibility

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(() => scheduleFrame())
    resizeObserver.observe(canvasRef.value)
    window.__aviatorCanvasResizeObserver = resizeObserver
  }
})

watch(() => [props.phase, props.multiplier, props.finalMultiplier, props.now, props.reducedMotion], () => {
  if (!canvasFailed.value) {
    scheduleFrame()
  }
})

onBeforeUnmount(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId)
  if (window.__aviatorCanvasVisibility) {
    document.removeEventListener('visibilitychange', window.__aviatorCanvasVisibility)
    delete window.__aviatorCanvasVisibility
  }
  if (window.__aviatorCanvasResizeObserver) {
    window.__aviatorCanvasResizeObserver.disconnect()
    delete window.__aviatorCanvasResizeObserver
  }
})
</script>

<template>
  <div class="absolute inset-0">
    <canvas ref="canvasRef" class="h-full w-full" aria-label="Escena del juego Aviator" />
    <div v-if="canvasFailed" class="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-xs uppercase tracking-[0.18em] text-slate-300">
      Aviator scene unavailable
    </div>
  </div>
</template>
