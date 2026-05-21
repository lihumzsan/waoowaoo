import type { CoordinateReferenceMode } from '@/lib/coordinate-placement-test/types'

export function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('FILE_READ_EMPTY'))
    }
    reader.onerror = () => reject(reader.error || new Error('FILE_READ_FAILED'))
    reader.readAsDataURL(file)
  })
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'))
    image.src = source
  })
}

function drawOverlayGrid(ctx: CanvasRenderingContext2D, input: {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly columns: number
  readonly rows: number
}) {
  const cellWidth = input.width / input.columns
  const cellHeight = input.height / input.rows

  ctx.save()
  ctx.fillStyle = 'rgba(2, 6, 23, 0.14)'
  ctx.fillRect(input.x, input.y, input.width, input.height)
  ctx.lineCap = 'square'

  for (let pass = 0; pass < 3; pass += 1) {
    ctx.strokeStyle = pass === 0 ? 'rgba(255,255,255,0.94)' : pass === 1 ? 'rgba(2,6,23,0.90)' : '#38bdf8'
    ctx.lineWidth = pass === 0 ? 4 : pass === 1 ? 2.25 : 1
    ctx.beginPath()
    for (let xIndex = 0; xIndex <= input.columns; xIndex += 1) {
      const x = input.x + Math.round(xIndex * cellWidth)
      ctx.moveTo(x, input.y)
      ctx.lineTo(x, input.y + input.height)
    }
    for (let yIndex = 0; yIndex <= input.rows; yIndex += 1) {
      const y = input.y + Math.round(yIndex * cellHeight)
      ctx.moveTo(input.x, y)
      ctx.lineTo(input.x + input.width, y)
    }
    ctx.stroke()
  }

  ctx.font = '800 14px Arial, Helvetica, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let xIndex = 0; xIndex < input.columns; xIndex += 1) {
    for (let yIndex = 0; yIndex < input.rows; yIndex += 1) {
      const labelX = input.x + Math.round((xIndex + 0.5) * cellWidth)
      const labelY = input.y + Math.round((yIndex + 0.5) * cellHeight)
      const label = `${xIndex + 1},${yIndex + 1}`
      ctx.lineWidth = 4
      ctx.strokeStyle = '#020617'
      ctx.strokeText(label, labelX, labelY)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, labelX, labelY)
    }
  }
  ctx.restore()
}

function drawOuterAxes(ctx: CanvasRenderingContext2D, input: {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly columns: number
  readonly rows: number
}) {
  const cellWidth = input.width / input.columns
  const cellHeight = input.height / input.rows

  ctx.save()
  ctx.strokeStyle = '#111827'
  ctx.fillStyle = '#111827'
  ctx.lineWidth = 2
  ctx.font = '800 16px Arial, Helvetica, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.beginPath()
  ctx.moveTo(input.x, input.y - 24)
  ctx.lineTo(input.x + input.width, input.y - 24)
  ctx.moveTo(input.x - 24, input.y)
  ctx.lineTo(input.x - 24, input.y + input.height)
  ctx.stroke()

  ctx.fillText('X', input.x + input.width + 18, input.y - 24)
  ctx.fillText('Y', input.x - 24, input.y + input.height + 18)

  for (let xIndex = 0; xIndex < input.columns; xIndex += 1) {
    const x = input.x + Math.round((xIndex + 0.5) * cellWidth)
    ctx.fillText(String(xIndex + 1), x, input.y - 44)
    ctx.beginPath()
    ctx.moveTo(x, input.y - 30)
    ctx.lineTo(x, input.y - 18)
    ctx.stroke()
  }
  ctx.textAlign = 'right'
  for (let yIndex = 0; yIndex < input.rows; yIndex += 1) {
    const y = input.y + Math.round((yIndex + 0.5) * cellHeight)
    ctx.fillText(String(yIndex + 1), input.x - 42, y)
    ctx.beginPath()
    ctx.moveTo(input.x - 30, y)
    ctx.lineTo(input.x - 18, y)
    ctx.stroke()
  }
  ctx.restore()
}

export async function buildCoordinateReference(input: {
  readonly sceneImage: string
  readonly mode: CoordinateReferenceMode
  readonly columns: number
  readonly rows: number
}): Promise<string> {
  const image = await loadImage(input.sceneImage)
  const maxImageWidth = 1280
  const scale = Math.min(1, maxImageWidth / image.naturalWidth)
  const imageWidth = Math.max(1, Math.round(image.naturalWidth * scale))
  const imageHeight = Math.max(1, Math.round(image.naturalHeight * scale))
  const axisMarginLeft = input.mode === 'outer_axes' ? 76 : 0
  const axisMarginTop = input.mode === 'outer_axes' ? 76 : 0
  const canvas = document.createElement('canvas')
  canvas.width = imageWidth + axisMarginLeft
  canvas.height = imageHeight + axisMarginTop
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_CONTEXT_UNAVAILABLE')

  ctx.fillStyle = input.mode === 'outer_axes' ? '#f8fafc' : '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, axisMarginLeft, axisMarginTop, imageWidth, imageHeight)

  if (input.mode === 'overlay') {
    drawOverlayGrid(ctx, {
      x: 0,
      y: 0,
      width: imageWidth,
      height: imageHeight,
      columns: input.columns,
      rows: input.rows,
    })
  } else {
    drawOuterAxes(ctx, {
      x: axisMarginLeft,
      y: axisMarginTop,
      width: imageWidth,
      height: imageHeight,
      columns: input.columns,
      rows: input.rows,
    })
  }

  return canvas.toDataURL('image/png')
}
