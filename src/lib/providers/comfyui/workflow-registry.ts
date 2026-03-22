/**
 * ComfyUI 图片：仅支持「工作流 JSON + 可选 meta」。
 * JSON 为 ComfyUI 提交 /prompt 的 API 格式（非界面导出的含 nodes/links 格式）。
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** 预设默认图片工作流（仓库内 workflows/qwen-image-txt2img.json） */
export const COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID = 'qwen-image-txt2img'

export type ComfyUiWorkflowGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>

export type ComfyUiWorkflowInject = {
  prompt: string
  width: number
  height: number
  negativePrompt?: string
}

export type ComfyUiWorkflowMeta = {
  positivePrompt?: { nodeId: string; field?: string }
  negativePrompt?: { nodeId: string; field?: string }
  /** 写入 latent 宽度（如 ImpactInt） */
  latentWidth?: { nodeId: string; field?: string }
  /** 写入 latent 高度 */
  latentHeight?: { nodeId: string; field?: string }
}

function comfyUiWorkflowsRoot(): string {
  return join(process.cwd(), 'src', 'lib', 'providers', 'comfyui', 'workflows')
}

export function assertSafeComfyUiWorkflowFileKey(raw: string): string {
  const t = raw.trim()
  if (!t || t.length > 120) {
    throw new Error(`COMFYUI_WORKFLOW_KEY_INVALID: 工作流标识无效或过长: ${raw.slice(0, 80)}`)
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(t) || t.includes('..')) {
    throw new Error(`COMFYUI_WORKFLOW_KEY_INVALID: 工作流标识仅允许字母数字及 ._-: ${raw.slice(0, 80)}`)
  }
  return t
}

export function loadComfyUiWorkflowJsonFile(workflowKey: string): ComfyUiWorkflowGraph | null {
  const key = assertSafeComfyUiWorkflowFileKey(workflowKey)
  const p = join(comfyUiWorkflowsRoot(), `${key}.json`)
  if (!existsSync(p)) return null
  const raw = readFileSync(p, 'utf-8')
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as ComfyUiWorkflowGraph
}

export function loadComfyUiWorkflowMeta(workflowKey: string): ComfyUiWorkflowMeta | null {
  const key = assertSafeComfyUiWorkflowFileKey(workflowKey)
  const p = join(comfyUiWorkflowsRoot(), `${key}.meta.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ComfyUiWorkflowMeta
  } catch {
    return null
  }
}

function cloneWorkflow(graph: ComfyUiWorkflowGraph): ComfyUiWorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as ComfyUiWorkflowGraph
}

function assignRandomKsamplerSeed(graph: ComfyUiWorkflowGraph): void {
  const seed = Math.floor(Math.random() * 1_000_000_000_000_000)
  for (const node of Object.values(graph)) {
    if (node.class_type === 'KSampler' && node.inputs) {
      node.inputs.seed = seed
    }
  }
}

export function applyMetaPrompt(
  graph: ComfyUiWorkflowGraph,
  meta: ComfyUiWorkflowMeta | null,
  inject: ComfyUiWorkflowInject,
): ComfyUiWorkflowGraph {
  const g = cloneWorkflow(graph)
  if (!meta) return g

  if (meta.positivePrompt) {
    const id = meta.positivePrompt.nodeId
    const field = meta.positivePrompt.field || 'text'
    const node = g[id]
    if (node?.inputs && typeof node.inputs === 'object') {
      node.inputs[field] = inject.prompt
    }
  }
  if (meta.negativePrompt && inject.negativePrompt) {
    const id = meta.negativePrompt.nodeId
    const field = meta.negativePrompt.field || 'text'
    const node = g[id]
    if (node?.inputs && typeof node.inputs === 'object') {
      node.inputs[field] = inject.negativePrompt
    }
  }
  return g
}

function applyMetaDimensions(
  graph: ComfyUiWorkflowGraph,
  meta: ComfyUiWorkflowMeta | null,
  inject: ComfyUiWorkflowInject,
): ComfyUiWorkflowGraph {
  const g = graph
  if (!meta) return g

  const w = Math.max(64, Math.min(4096, Math.round(inject.width)))
  const h = Math.max(64, Math.min(4096, Math.round(inject.height)))

  if (meta.latentWidth) {
    const id = meta.latentWidth.nodeId
    const field = meta.latentWidth.field || 'value'
    const node = g[id]
    if (node?.inputs && typeof node.inputs === 'object') {
      node.inputs[field] = w
    }
  }
  if (meta.latentHeight) {
    const id = meta.latentHeight.nodeId
    const field = meta.latentHeight.field || 'value'
    const node = g[id]
    if (node?.inputs && typeof node.inputs === 'object') {
      node.inputs[field] = h
    }
  }
  return g
}

export function resolveComfyUiImageWorkflow(workflowKey: string, inject: ComfyUiWorkflowInject): ComfyUiWorkflowGraph {
  const key = workflowKey.trim() || COMFYUI_DEFAULT_IMAGE_WORKFLOW_ID

  const file = loadComfyUiWorkflowJsonFile(key)
  if (!file) {
    throw new Error(
      `COMFYUI_WORKFLOW_NOT_FOUND: 未找到图片工作流「${key}」。请在 src/lib/providers/comfyui/workflows/${key}.json 放置 ComfyUI API 格式工作流。`,
    )
  }
  const meta = loadComfyUiWorkflowMeta(key)
  let g = applyMetaPrompt(file, meta, inject)
  g = applyMetaDimensions(g, meta, inject)
  assignRandomKsamplerSeed(g)
  return g
}

export function resolveComfyUiVideoWorkflow(workflowKey: string, inject: { prompt?: string }): ComfyUiWorkflowGraph {
  const key = workflowKey.trim()
  if (!key) {
    throw new Error('COMFYUI_WORKFLOW_KEY_MISSING: 请配置视频工作流标识（与 workflows 下 JSON 文件名一致，不含扩展名）')
  }

  const file = loadComfyUiWorkflowJsonFile(key)
  if (!file) {
    throw new Error(
      `COMFYUI_WORKFLOW_NOT_FOUND: 未找到视频工作流「${key}」。请在 src/lib/providers/comfyui/workflows/${key}.json 放置 ComfyUI API 格式工作流。`,
    )
  }
  const meta = loadComfyUiWorkflowMeta(key)
  const g = applyMetaPrompt(file, meta, {
    prompt: inject.prompt || '',
    width: 512,
    height: 512,
  })
  assignRandomKsamplerSeed(g)
  return g
}
