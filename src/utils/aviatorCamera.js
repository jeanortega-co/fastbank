export const computeCamera = (elapsedMs, multiplier, width, height) => {
  const safeMarginLeft = width * 0.08
  const safeMarginTop = height * 0.08
  const safeMarginRight = width * 0.15
  const safeMarginBottom = height * 0.15

  const worldWidth = Math.max(5000, elapsedMs * 1.15)
  const worldHeight = Math.max(2, multiplier * 1.25)

  const scale = Math.min(width / worldWidth, height / worldHeight)
  const safeLeft = width * 0.08
  const safeTop = height * 0.08
  const safeRight = width - width * 0.15
  const safeBottom = height - height * 0.15

  const worldX = Math.max(0, elapsedMs * 0.12)
  const worldY = Math.max(0, multiplier * 28)

  const planeX = width * 0.2 + worldX * scale
  const planeY = height * 0.82 - worldY * scale

  const clampedX = Math.min(Math.max(planeX, safeLeft), safeRight)
  const clampedY = Math.min(Math.max(planeY, safeTop), safeBottom)

  return {
    scale,
    offsetX: 0,
    offsetY: 0,
    safeBounds: {
      left: safeLeft,
      top: safeTop,
      right: safeRight,
      bottom: safeBottom,
    },
    plane: {
      x: clampedX,
      y: clampedY,
    },
    visibleWorld: {
      width: worldWidth,
      height: worldHeight,
    },
  }
}
