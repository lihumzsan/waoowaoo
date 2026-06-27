import type { CardTone, ToolCallStatus } from './types'

/**
 * 极简方案共用的中立工具:语义色值与比例换算。
 * 仅提供「数据」,不规定外观——卡片外壳/按钮仍由各设计自行实现,保证视觉差异。
 */

export const SEM: Record<CardTone, string> = {
  neutral: '#9ca3af',
  info: '#2563eb',
  success: '#16a34a',
  warn: '#d97706',
  danger: '#dc2626',
}

export const SEM_SOFT: Record<CardTone, string> = {
  neutral: 'rgba(156,163,175,0.14)',
  info: 'rgba(37,99,235,0.10)',
  success: 'rgba(22,163,74,0.12)',
  warn: 'rgba(217,119,6,0.12)',
  danger: 'rgba(220,38,38,0.10)',
}

export const STATUS_TONE: Record<ToolCallStatus, CardTone> = {
  running: 'info',
  success: 'success',
  failed: 'danger',
  'needs-action': 'warn',
}

/** 把 "9:16" 这类比例换算为像素宽高(用于绘制比例缩略图)。 */
export function ratioBox(ratio: string, base: number): { width: number; height: number } {
  const [w, h] = ratio.split(':').map(Number)
  const safeW = Number.isFinite(w) && w > 0 ? w : 1
  const safeH = Number.isFinite(h) && h > 0 ? h : 1
  const max = Math.max(safeW, safeH)
  return {
    width: Math.max(14, Math.round((base * safeW) / max)),
    height: Math.max(14, Math.round((base * safeH) / max)),
  }
}
