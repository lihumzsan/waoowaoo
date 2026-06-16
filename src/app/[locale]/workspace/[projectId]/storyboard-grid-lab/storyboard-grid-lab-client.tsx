'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Locale } from '@/i18n/routing'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import {
  STORYBOARD_PROMPT_FIELD_DEFINITIONS,
  STORYBOARD_PROMPT_FIELD_PRESETS,
  type StoryboardPromptFieldId,
} from '@/lib/storyboard/prompt-field-selection'

type ComparePanel = {
  readonly id: string
  readonly panelIndex: number
  readonly panelNumber: number | null
  readonly shotType: string | null
  readonly cameraMove: string | null
  readonly description: string | null
  readonly location: string | null
  readonly imagePrompt: string | null
  readonly imageUrl: string | null
}

type CompareBlock = {
  readonly blockIndex: number
  readonly sourceVideoBlockId: string
  readonly kind: 'single' | 'group'
  readonly shotNumbers: readonly number[]
  readonly reason: string
  readonly prompt: string
  readonly panels: readonly ComparePanel[]
}

type CompareSource = {
  readonly editScriptId: string
  readonly episodeId: string
  readonly blocks: readonly CompareBlock[]
}

type SubmittedTask = {
  readonly panelIds: readonly string[]
  readonly taskId: string
  readonly status: string
}

type SubmitResponse = {
  readonly success: boolean
  readonly mode: 'single_parallel' | 'grid_2x2'
  readonly episodeId: string
  readonly sourceVideoBlockId: string
  readonly omittedFields: readonly StoryboardPromptFieldId[]
  readonly tasks: readonly SubmittedTask[]
}

type TaskSnapshot = {
  readonly id: string
  readonly status: string
  readonly progress: number | null
  readonly errorMessage: string | null
  readonly result: unknown
}

type PromptDebug = {
  readonly prompt: string
  readonly contextJson: string
  readonly sourceText: string
  readonly referenceImageCount: number
}

type PanelPromptPreview = PromptDebug & {
  readonly panelId: string
}

type PromptPreview = {
  readonly omittedFields: readonly StoryboardPromptFieldId[]
  readonly single: readonly PanelPromptPreview[]
  readonly grid: PromptDebug
}

type RunState = {
  readonly mode: 'single_parallel' | 'grid_2x2'
  readonly startedAt: number
  readonly omittedFields: readonly StoryboardPromptFieldId[]
  readonly tasks: readonly SubmittedTask[]
}

type RunPair = {
  readonly id: string
  readonly index: number
  readonly omittedFields: readonly StoryboardPromptFieldId[]
  readonly single: RunState
  readonly grid: RunState
}

const COPY: Record<Locale, {
  readonly title: string
  readonly subtitle: string
  readonly episodePlaceholder: string
  readonly load: string
  readonly run: string
  readonly running: string
  readonly original: string
  readonly single: string
  readonly grid: string
  readonly selectBlock: string
  readonly empty: string
  readonly task: string
  readonly gridImage: string
  readonly noImage: string
  readonly fieldSelector: string
  readonly omitFieldHint: string
  readonly clearOmissions: string
  readonly omitAll: string
  readonly presets: string
  readonly presetHint: string
  readonly omittedNone: string
  readonly omittedPrefix: string
  readonly runLabel: string
  readonly promptPreview: string
  readonly actualPrompt: string
  readonly promptJson: string
  readonly sourceText: string
  readonly referenceImageCount: string
  readonly promptLength: string
  readonly jsonLength: string
  readonly sourceTextLength: string
  readonly omittedCount: string
  readonly loadingPrompt: string
}> = {
  zh: {
    title: '分镜四宫格对比实验',
    subtitle: '同一组真实分镜，同时提交单张并行与四宫格并行任务；结果只显示在本页，不写回当前分镜。',
    episodePlaceholder: 'episode id',
    load: '加载',
    run: '同时测试',
    running: '处理中',
    original: '原始分镜',
    single: '单张并行',
    grid: '四宫格并行',
    selectBlock: '选择 block',
    empty: '没有可测试的多镜头 block',
    task: '任务',
    gridImage: '完整四宫格',
    noImage: '暂无图片',
    fieldSelector: '字段移除测试',
    omitFieldHint: '勾选后，本次单张并行和四宫格并行都会从 prompt JSON 中移除该字段；不影响正式分镜数据。',
    clearOmissions: '清空移除',
    omitAll: '全选移除',
    presets: '一键预设',
    presetHint: '点击预设会替换当前勾选字段；之后仍可继续手动增减。',
    omittedNone: '未移除字段',
    omittedPrefix: '移除字段',
    runLabel: '实验',
    promptPreview: '选择后的实际 prompt 预览',
    actualPrompt: '实际 prompt',
    promptJson: '实际 JSON',
    sourceText: '顶层原文',
    referenceImageCount: '实际参考图输入数量',
    promptLength: 'prompt 长度',
    jsonLength: 'JSON 长度',
    sourceTextLength: '顶层原文长度',
    omittedCount: '移除字段数',
    loadingPrompt: '正在生成 prompt 预览',
  },
  en: {
    title: 'Storyboard Grid Comparison Lab',
    subtitle: 'Submit single-panel parallel generation and 2x2 grid generation for the same real storyboard block. Results are displayed here only.',
    episodePlaceholder: 'episode id',
    load: 'Load',
    run: 'Run Both',
    running: 'Running',
    original: 'Original Panels',
    single: 'Single Parallel',
    grid: '2x2 Grid Parallel',
    selectBlock: 'Select Block',
    empty: 'No multi-panel block available',
    task: 'Task',
    gridImage: 'Full Grid',
    noImage: 'No image',
    fieldSelector: 'Field Omission Test',
    omitFieldHint: 'Checked fields are removed from the prompt JSON for both single-panel and grid runs. Project storyboard data is not changed.',
    clearOmissions: 'Clear',
    omitAll: 'Omit All',
    presets: 'Presets',
    presetHint: 'Preset buttons replace the current field selection. You can still adjust fields manually.',
    omittedNone: 'No omitted fields',
    omittedPrefix: 'Omitted fields',
    runLabel: 'Run',
    promptPreview: 'Actual Prompt Preview',
    actualPrompt: 'Actual prompt',
    promptJson: 'Actual JSON',
    sourceText: 'Top-level source text',
    referenceImageCount: 'Actual reference image inputs',
    promptLength: 'Prompt length',
    jsonLength: 'JSON length',
    sourceTextLength: 'Source text length',
    omittedCount: 'Omitted field count',
    loadingPrompt: 'Loading prompt preview',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function readJson<T>(response: Response): Promise<T> {
  const parsed = await response.json() as unknown
  if (!response.ok) {
    const message = isRecord(parsed) ? readString(parsed.message) || readString(parsed.error) : null
    throw new Error(message || `HTTP_${response.status}`)
  }
  return parsed as T
}

function taskResultImages(result: unknown): readonly string[] {
  if (!isRecord(result)) return []
  const imageUrls = Array.isArray(result.imageUrls)
    ? result.imageUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const imageUrl = readString(result.imageUrl)
  return imageUrls.length > 0 ? imageUrls : imageUrl ? [imageUrl] : []
}

function gridImageUrl(result: unknown): string | null {
  return isRecord(result) ? readString(result.gridImageUrl) : null
}

function promptDebug(result: unknown): PromptDebug | null {
  if (!isRecord(result) || !isRecord(result.promptDebug)) return null
  const debug = result.promptDebug
  const prompt = readString(debug.prompt)
  const contextJson = readString(debug.contextJson)
  const sourceText = typeof debug.sourceText === 'string' ? debug.sourceText : ''
  const referenceImageCount = typeof debug.referenceImageCount === 'number' && Number.isFinite(debug.referenceImageCount)
    ? debug.referenceImageCount
    : 0
  if (!prompt || !contextJson) return null
  return {
    prompt,
    contextJson,
    sourceText,
    referenceImageCount,
  }
}

function parseTaskSnapshot(value: unknown): TaskSnapshot {
  const root = isRecord(value) ? value : {}
  const task = isRecord(root.task) ? root.task : {}
  const progress = typeof task.progress === 'number' && Number.isFinite(task.progress) ? task.progress : null
  const error = isRecord(task.error) ? task.error : null
  return {
    id: readString(task.id) || '',
    status: readString(task.status) || 'unknown',
    progress,
    errorMessage: readString(task.errorMessage) || readString(error?.message) || null,
    result: task.result,
  }
}

function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'dismissed'
}

function displayUrl(url: string | null | undefined): string | null {
  return toDisplayImageUrl(url) ?? url ?? null
}

function ImageTile({ url, label, emptyLabel }: {
  readonly url: string | null | undefined
  readonly label: string
  readonly emptyLabel: string
}) {
  const resolved = displayUrl(url)
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex h-9 items-center gap-2 border-b border-slate-100 px-3 text-xs font-semibold text-slate-600">
        <AppIcon name="image" className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className="flex aspect-video items-center justify-center bg-slate-100">
        {resolved ? (
          <MediaImage src={resolved} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-slate-400">{emptyLabel}</span>
        )}
      </div>
    </div>
  )
}

function TaskStatusLine({ task, snapshot, label }: {
  readonly task: SubmittedTask
  readonly snapshot: TaskSnapshot | undefined
  readonly label: string
}) {
  const status = snapshot?.status ?? task.status
  const progress = snapshot?.progress
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <span className="truncate">{label}: {task.taskId}</span>
      <span className="shrink-0 font-semibold text-slate-900">
        {status}{progress !== null && progress !== undefined ? ` ${progress}%` : ''}
      </span>
    </div>
  )
}

function PromptTextDisclosure({ title, value }: {
  readonly title: string
  readonly value: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="rounded-md bg-white"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">{title}</summary>
      {open ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-slate-100 p-3 text-[11px] leading-5 text-slate-700">{value}</pre>
      ) : null}
    </details>
  )
}

function PromptDebugView({ title, debug, copy }: {
  readonly title: string
  readonly debug: PromptDebug
  readonly copy: typeof COPY[Locale]
}) {
  const [open, setOpen] = useState(false)
  const promptLength = debug.prompt.length
  const jsonLength = debug.contextJson.length
  const sourceTextLength = debug.sourceText.length
  return (
    <details
      className="rounded-md border border-slate-200 bg-slate-50"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-700">
        <span>{title}</span>
        <span className="font-normal text-slate-500">
          {copy.promptLength}: {promptLength} · {copy.jsonLength}: {jsonLength}
        </span>
      </summary>
      {open ? (
      <div className="space-y-3 border-t border-slate-200 p-3">
        <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-4">
          <div>{copy.promptLength}: <span className="font-semibold text-slate-950">{promptLength}</span></div>
          <div>{copy.jsonLength}: <span className="font-semibold text-slate-950">{jsonLength}</span></div>
          <div>{copy.referenceImageCount}: <span className="font-semibold text-slate-950">{debug.referenceImageCount}</span></div>
          <div>{copy.sourceTextLength}: <span className="font-semibold text-slate-950">{sourceTextLength}</span></div>
        </div>
        <PromptTextDisclosure title={copy.promptJson} value={debug.contextJson} />
        <PromptTextDisclosure title={copy.actualPrompt} value={debug.prompt} />
      </div>
      ) : null}
    </details>
  )
}

function ResultColumn({ title, run, snapshots, panels, copy }: {
  readonly title: string
  readonly run: RunState | null
  readonly snapshots: ReadonlyMap<string, TaskSnapshot>
  readonly panels: readonly ComparePanel[]
  readonly copy: typeof COPY[Locale]
}) {
  const images = useMemo(() => {
    if (!run) return []
    return run.tasks.flatMap((task) => {
      const snapshot = snapshots.get(task.taskId)
      return taskResultImages(snapshot?.result).map((url, index) => ({
        key: `${task.taskId}:${index}`,
        url,
        label: task.panelIds.length === 1
          ? `#${panels.findIndex((panel) => panel.id === task.panelIds[0]) + 1}`
          : `#${index + 1}`,
      }))
    })
  }, [panels, run, snapshots])
  const fullGridImage = run?.mode === 'grid_2x2' ? gridImageUrl(snapshots.get(run.tasks[0]?.taskId || '')?.result) : null

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
        {run ? <span className="text-xs text-slate-500">{new Date(run.startedAt).toLocaleTimeString()}</span> : null}
      </div>
      {run ? (
        <div className="space-y-2">
          {run.tasks.map((task, index) => {
            const snapshot = snapshots.get(task.taskId)
            const debug = promptDebug(snapshot?.result)
            return (
              <div key={task.taskId} className="space-y-2">
                <TaskStatusLine
                  task={task}
                  snapshot={snapshot}
                  label={`${copy.task} ${index + 1}`}
                />
                {debug ? (
                  <PromptDebugView
                    title={`${copy.actualPrompt} ${index + 1}`}
                    debug={debug}
                    copy={copy}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {fullGridImage ? <ImageTile url={fullGridImage} label={copy.gridImage} emptyLabel={copy.noImage} /> : null}
      <div className="grid grid-cols-2 gap-3">
        {images.length > 0 ? images.map((image) => (
          <ImageTile key={image.key} url={image.url} label={image.label} emptyLabel={copy.noImage} />
        )) : panels.map((panel, index) => (
          <ImageTile key={panel.id} url={null} label={`#${index + 1}`} emptyLabel={copy.noImage} />
        ))}
      </div>
    </section>
  )
}

function fieldLabel(fieldId: StoryboardPromptFieldId): string {
  const field = STORYBOARD_PROMPT_FIELD_DEFINITIONS.find((item) => item.id === fieldId)
  return field ? `${field.en} / ${field.zh}` : fieldId
}

function FieldSelector({ selected, onToggle, onClear, onSelectAll, onApplyPreset, copy }: {
  readonly selected: ReadonlySet<StoryboardPromptFieldId>
  readonly onToggle: (fieldId: StoryboardPromptFieldId) => void
  readonly onClear: () => void
  readonly onSelectAll: () => void
  readonly onApplyPreset: (fieldIds: readonly StoryboardPromptFieldId[]) => void
  readonly copy: typeof COPY[Locale]
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">{copy.fieldSelector}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{copy.omitFieldHint}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            className="h-9 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700"
          >
            {copy.clearOmissions}
          </button>
          <button
            type="button"
            onClick={onSelectAll}
            className="h-9 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700"
          >
            {copy.omitAll}
          </button>
        </div>
      </div>
      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-950">{copy.presets}</span>
          <span className="text-xs text-slate-500">{copy.presetHint}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {STORYBOARD_PROMPT_FIELD_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset.fieldIds)}
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:border-slate-400"
            >
              {preset.zh} / {preset.en}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {STORYBOARD_PROMPT_FIELD_DEFINITIONS.map((field) => (
          <label
            key={field.id}
            className="flex min-h-14 items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
          >
            <input
              type="checkbox"
              checked={selected.has(field.id)}
              onChange={() => onToggle(field.id)}
              className="mt-0.5 h-4 w-4 accent-slate-950"
            />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-slate-950">{field.en}</span>
              <span className="block truncate">{field.zh}</span>
              <span className="block truncate font-mono text-[11px] text-slate-400">{field.id}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}

function PromptPreviewSection({ preview, loading, copy }: {
  readonly preview: PromptPreview | null
  readonly loading: boolean
  readonly copy: typeof COPY[Locale]
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">{copy.promptPreview}</h2>
          {preview ? (
            <p className="mt-1 text-xs text-slate-500">
              {copy.omittedCount}: {preview.omittedFields.length}
            </p>
          ) : null}
        </div>
        {loading ? <span className="text-xs font-semibold text-slate-500">{copy.loadingPrompt}</span> : null}
      </div>
      {preview ? (
        <div className="space-y-3">
          <PromptDebugView title={`${copy.grid} · ${copy.actualPrompt}`} debug={preview.grid} copy={copy} />
          {preview.single.map((item, index) => (
            <PromptDebugView
              key={item.panelId}
              title={`${copy.single} #${index + 1} · ${copy.actualPrompt}`}
              debug={item}
              copy={copy}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md bg-slate-50 px-3 py-3 text-xs text-slate-500">{copy.loadingPrompt}</div>
      )}
    </section>
  )
}

export default function StoryboardGridLabClient({ locale, projectId, initialEpisodeId }: {
  readonly locale: Locale
  readonly projectId: string
  readonly initialEpisodeId: string
}) {
  const copy = COPY[locale] ?? COPY.zh
  const [episodeId, setEpisodeId] = useState(initialEpisodeId)
  const [source, setSource] = useState<CompareSource | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState('')
  const [runPairs, setRunPairs] = useState<readonly RunPair[]>([])
  const [omittedFields, setOmittedFields] = useState<ReadonlySet<StoryboardPromptFieldId>>(new Set())
  const [promptPreview, setPromptPreview] = useState<PromptPreview | null>(null)
  const [promptPreviewLoading, setPromptPreviewLoading] = useState(false)
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, TaskSnapshot>>(new Map())
  const snapshotsRef = useRef<ReadonlyMap<string, TaskSnapshot>>(new Map())
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedBlock = useMemo(() => {
    const blocks = source?.blocks ?? []
    return blocks.find((block) => block.sourceVideoBlockId === selectedBlockId) ?? blocks[0] ?? null
  }, [selectedBlockId, source])

  const loadSource = useCallback(async () => {
    if (!episodeId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ episodeId: episodeId.trim() })
      const nextSource = await readJson<CompareSource>(await fetch(`/api/projects/${projectId}/debug/storyboard-grid-compare/source?${params.toString()}`))
      setSource(nextSource)
      setSelectedBlockId(nextSource.blocks[0]?.sourceVideoBlockId ?? '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'LOAD_FAILED')
    } finally {
      setLoading(false)
    }
  }, [episodeId, projectId])

  useEffect(() => {
    if (initialEpisodeId) {
      void loadSource()
    }
  }, [initialEpisodeId, loadSource])

  const selectedOmittedFields = useMemo(() => Array.from(omittedFields), [omittedFields])

  const toggleOmittedField = useCallback((fieldId: StoryboardPromptFieldId) => {
    setOmittedFields((current) => {
      const next = new Set(current)
      if (next.has(fieldId)) next.delete(fieldId)
      else next.add(fieldId)
      return next
    })
  }, [])

  const submitMode = useCallback(async (
    mode: 'single_parallel' | 'grid_2x2',
    block: CompareBlock,
    fieldsToOmit: readonly StoryboardPromptFieldId[],
  ): Promise<RunState> => {
    const response = await fetch(`/api/projects/${projectId}/debug/storyboard-grid-compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        locale,
        episodeId,
        mode,
        omittedFields: fieldsToOmit,
        sourceVideoBlockId: block.sourceVideoBlockId,
        panelIds: block.panels.map((panel) => panel.id),
      }),
    })
    const result = await readJson<SubmitResponse>(response)
    return {
      mode: result.mode,
      startedAt: Date.now(),
      omittedFields: result.omittedFields,
      tasks: result.tasks,
    }
  }, [episodeId, locale, projectId])

  useEffect(() => {
    if (!selectedBlock || !episodeId.trim()) {
      setPromptPreview(null)
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setPromptPreviewLoading(true)
      void (async () => {
        try {
          const response = await fetch(`/api/projects/${projectId}/debug/storyboard-grid-compare/prompt-preview`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              locale,
              episodeId,
              omittedFields: selectedOmittedFields,
              mode: 'grid_2x2',
              sourceVideoBlockId: selectedBlock.sourceVideoBlockId,
              panelIds: selectedBlock.panels.map((panel) => panel.id),
            }),
          })
          const preview = await readJson<PromptPreview>(response)
          if (!controller.signal.aborted) setPromptPreview(preview)
        } catch (previewError) {
          if (!controller.signal.aborted) {
            setPromptPreview(null)
            setError(previewError instanceof Error ? previewError.message : 'PROMPT_PREVIEW_FAILED')
          }
        } finally {
          if (!controller.signal.aborted) setPromptPreviewLoading(false)
        }
      })()
    }, 300)
    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [episodeId, locale, projectId, selectedBlock, selectedOmittedFields])

  const runBoth = useCallback(async () => {
    if (!selectedBlock || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const fieldsToOmit = selectedOmittedFields
      const [single, grid] = await Promise.all([
        submitMode('single_parallel', selectedBlock, fieldsToOmit),
        submitMode('grid_2x2', selectedBlock, fieldsToOmit),
      ])
      setRunPairs((current) => [
        {
          id: `${single.startedAt}:${single.tasks.map((task) => task.taskId).join(':')}`,
          index: current.length + 1,
          omittedFields: fieldsToOmit,
          single,
          grid,
        },
        ...current,
      ])
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'SUBMIT_FAILED')
    } finally {
      setSubmitting(false)
    }
  }, [selectedBlock, selectedOmittedFields, submitMode, submitting])

  useEffect(() => {
    snapshotsRef.current = snapshots
  }, [snapshots])

  const taskIds = useMemo(() => runPairs.flatMap((pair) => [
    ...pair.single.tasks.map((task) => task.taskId),
    ...pair.grid.tasks.map((task) => task.taskId),
  ]), [runPairs])

  useEffect(() => {
    if (taskIds.length === 0) return

    let canceled = false
    let interval: number | null = null
    const poll = async () => {
      const pendingTaskIds = taskIds.filter((taskId) => {
        const current = snapshotsRef.current.get(taskId)
        return !current || !isTerminal(current.status)
      })
      if (pendingTaskIds.length === 0) {
        if (interval !== null) window.clearInterval(interval)
        return
      }
      const entries = await Promise.all(pendingTaskIds.map(async (taskId): Promise<[string, TaskSnapshot] | null> => {
        try {
          const snapshot = parseTaskSnapshot(await readJson<unknown>(await fetch(`/api/tasks/${taskId}`)))
          return [taskId, snapshot]
        } catch {
          return null
        }
      }))
      if (canceled) return
      setSnapshots((current) => {
        const next = new Map(current)
        for (const entry of entries) {
          if (entry) next.set(entry[0], entry[1])
        }
        return next
      })
    }

    void poll()
    interval = window.setInterval(() => {
      void poll()
    }, 2000)
    return () => {
      canceled = true
      if (interval !== null) window.clearInterval(interval)
    }
  }, [taskIds])

  const blockOptions = source?.blocks ?? []
  const panels = selectedBlock?.panels ?? []
  const canRun = Boolean(selectedBlock && !submitting)

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-6 text-slate-950">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-normal">{copy.title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600">{copy.subtitle}</p>
        </header>

        <section className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <label className="flex min-w-80 flex-1 flex-col gap-1 text-xs font-semibold text-slate-600">
            <span>{copy.episodePlaceholder}</span>
            <input
              value={episodeId}
              onChange={(event) => setEpisodeId(event.target.value)}
              className="h-10 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-950 outline-none focus:border-slate-500"
              placeholder={copy.episodePlaceholder}
            />
          </label>
          <label className="flex min-w-80 flex-1 flex-col gap-1 text-xs font-semibold text-slate-600">
            <span>{copy.selectBlock}</span>
            <select
              value={selectedBlock?.sourceVideoBlockId ?? ''}
              onChange={(event) => setSelectedBlockId(event.target.value)}
              className="h-10 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-950 outline-none focus:border-slate-500"
            >
              {blockOptions.length === 0 ? <option value="">{copy.empty}</option> : null}
              {blockOptions.map((block) => (
                <option key={block.sourceVideoBlockId} value={block.sourceVideoBlockId}>
                  #{block.blockIndex + 1} · {block.shotNumbers.join(', ')} · {block.panels.length}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadSource()}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 disabled:opacity-50"
          >
            <AppIcon name="refresh" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {copy.load}
          </button>
          <button
            type="button"
            onClick={() => void runBoth()}
            disabled={!canRun}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            <AppIcon name="play" className="h-4 w-4" />
            {submitting ? copy.running : copy.run}
          </button>
        </section>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}

        <FieldSelector
          selected={omittedFields}
          onToggle={toggleOmittedField}
          onClear={() => setOmittedFields(new Set())}
          onSelectAll={() => setOmittedFields(new Set(STORYBOARD_PROMPT_FIELD_DEFINITIONS.map((field) => field.id)))}
          onApplyPreset={(fieldIds) => setOmittedFields(new Set(fieldIds))}
          copy={copy}
        />

        <PromptPreviewSection
          preview={promptPreview}
          loading={promptPreviewLoading}
          copy={copy}
        />

        {selectedBlock ? (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">Block #{selectedBlock.blockIndex + 1}</h2>
                <p className="mt-1 text-xs text-slate-500">{selectedBlock.sourceVideoBlockId}</p>
              </div>
              <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                {selectedBlock.shotNumbers.join(', ')}
              </span>
            </div>
            <p className="text-sm leading-6 text-slate-700">{selectedBlock.prompt}</p>
          </section>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section className="min-w-0 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-950">{copy.original}</h2>
            <div className="grid grid-cols-2 gap-3">
              {panels.map((panel, index) => (
                <div key={panel.id} className="space-y-2">
                  <ImageTile url={panel.imageUrl} label={`#${index + 1}`} emptyLabel={copy.noImage} />
                  <p className="line-clamp-3 text-xs leading-5 text-slate-600">{panel.description || panel.imagePrompt}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="min-w-0 space-y-4">
            {runPairs.map((pair) => {
              const omittedLabel = pair.omittedFields.length === 0
                ? copy.omittedNone
                : pair.omittedFields.map((fieldId) => fieldLabel(fieldId)).join(' · ')
              return (
                <div key={pair.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-4 space-y-1">
                    <h2 className="text-sm font-semibold text-slate-950">
                      {copy.runLabel} #{pair.index}
                    </h2>
                    <p className="text-xs leading-5 text-slate-500">
                      {copy.omittedPrefix}: {omittedLabel}
                    </p>
                  </div>
                  <div className="grid gap-5 xl:grid-cols-2">
                    <ResultColumn
                      title={copy.single}
                      run={pair.single}
                      snapshots={snapshots}
                      panels={panels}
                      copy={copy}
                    />
                    <ResultColumn
                      title={copy.grid}
                      run={pair.grid}
                      snapshots={snapshots}
                      panels={panels}
                      copy={copy}
                    />
                  </div>
                </div>
              )
            })}
          </section>
        </div>
      </div>
    </main>
  )
}
