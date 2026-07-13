'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import EditScriptPreviewDetail from '../../details/EditScriptPreviewDetail'
import { type ShotField, type ShotGridCard, shotDetailIconGrid, ShotGrid } from '../shot-grid'
import { WorkspaceCanvasMotionPresence } from '../workspace-node-motion'
import type { WorkspaceCanvasFlowNode } from '../../node-canvas-types'
import { SELECTABLE_TEXT_CLASS, hasText, nodeContentInteractionClass } from './renderer-shared'

export type EditScriptShotCardSource = NonNullable<WorkspaceCanvasFlowNode['data']['editScriptDetails']>['shots'][number]
export type EditPipelineStepCardSource = NonNullable<WorkspaceCanvasFlowNode['data']['editPipelineStepDetails']>['items'][number]
export function compactEntityName(value: string): string {
  const name = value.split('/')[0]?.trim()
  return name && name.length > 0 ? name : value.trim()
}
export function uniqueCompactEntityNames(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const names: string[] = []
  values.forEach((value) => {
    const name = compactEntityName(value)
    if (!name || seen.has(name)) return
    seen.add(name)
    names.push(name)
  })
  return names
}
export function editScriptShotCharacterNames(shot: EditScriptShotCardSource): readonly string[] {
  return uniqueCompactEntityNames(shot.characters)
}
export function compactList(values: readonly string[], separator: string): string {
  return values.join(separator)
}
export function fieldValue(fields: readonly ShotField[], label: string): string | null {
  return fields.find((field) => field.label === label)?.value ?? null
}
export function numericChipValue(values: readonly string[] | undefined): string | null {
  return values?.find((value) => /^\d+$/.test(value.trim()))?.trim() ?? null
}
export function executionPlanShotKey(item: EditPipelineStepCardSource, index: number): string {
  return numericChipValue(item.chips) ?? item.title.match(/\d+/)?.[0] ?? String(index + 1)
}
export function executionPlanCharacterNames(item: EditPipelineStepCardSource): readonly string[] {
  return uniqueCompactEntityNames((item.chips ?? []).filter((chip) => chip.includes('/')))
}
export function executionPlanObjectNames(item: EditPipelineStepCardSource): readonly string[] {
  return uniqueCompactEntityNames(
    (item.chips ?? []).filter((chip) => {
      const trimmed = chip.trim()
      return trimmed.length > 0 && !trimmed.includes('/') && !/^\d+$/.test(trimmed)
    }),
  )
}
export function EditScriptContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const details = data.editScriptDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const listSeparator = labels('listSeparator')
  const allCharacterNames = uniqueCompactEntityNames(details.shots.flatMap((shot) => shot.characters))
  const summaryText =
    allCharacterNames.length > 0
      ? labels('editScriptCompactSummaryWithCharacters', {
          count: details.shotCount,
          characters: compactList(allCharacterNames.slice(0, 4), listSeparator),
        })
      : labels('editScriptCompactSummary', { count: details.shotCount })
  const summaryLine = (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <AppIcon name="clapperboard" className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
      <p className={`${SELECTABLE_TEXT_CLASS} truncate text-sm text-[var(--glass-text-secondary)]`}>{summaryText}</p>
    </div>
  )
  const showShotGrid = expanded

  const cards: ShotGridCard[] = details.shots.map((shot) => {
    const characterNames = editScriptShotCharacterNames(shot)
    const keyObjectNames = uniqueCompactEntityNames(shot.keyObjects)
    return {
      key: shot.shotId,
      badge: shot.shotNumber,
      title: shot.sceneName || labels('shotIndex', { index: shot.shotNumber }),
      subtitle: shot.action,
      meta: characterNames.length > 0 ? compactList(characterNames, listSeparator) : labels('noCharacters'),
      characterCount: characterNames.length,
      detail: (
        <div className="space-y-2.5">
          {shotDetailIconGrid([
            { label: labels('scene'), value: shot.sceneName },
            { label: labels('action'), value: shot.action },
            {
              label: labels('characters'),
              value: compactList(characterNames, '\n'),
            },
            {
              label: labels('keyObjects'),
              value: compactList(keyObjectNames, '\n'),
            },
            {
              label: labels('dialogue'),
              value: compactList(shot.dialogue, '\n'),
            },
            { label: labels('duration'), value: `${shot.durationSec}s` },
            { label: labels('sound'), value: shot.sound },
          ])}
        </div>
      ),
    }
  })

  return (
    <>
      {!showShotGrid ? summaryLine : null}
      <WorkspaceCanvasMotionPresence visible={showShotGrid} exit={false} className={nodeContentInteractionClass(data, 'space-y-3')}>
        {summaryLine}
        <button
          type="button"
          className="nodrag inline-flex items-center gap-2 rounded-[14px] bg-slate-950 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-900"
          onClick={(event) => {
            event.stopPropagation()
            setPreviewOpen(true)
          }}
        >
          <AppIcon name="playCircle" className="h-4 w-4" />
          {labels('viewVideoPreview')}
        </button>
        {previewOpen ? <EditScriptPreviewDetail details={details} onClose={() => setPreviewOpen(false)} /> : null}
        <ShotGrid cards={cards} accent="slate" streamPresentation={data.lifecycle.stream ?? undefined} />
      </WorkspaceCanvasMotionPresence>
    </>
  )
}
export function EditShotExecutionPlanContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.editPipelineStepDetails
  if (!details || details.items.length === 0) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }

  const listSeparator = labels('listSeparator')
  const allCharacterNames = uniqueCompactEntityNames(details.items.flatMap((item) => executionPlanCharacterNames(item)))
  const summaryText =
    allCharacterNames.length > 0
      ? labels('editScriptCompactSummaryWithCharacters', {
          count: details.items.length,
          characters: compactList(allCharacterNames.slice(0, 4), listSeparator),
        })
      : labels('editScriptCompactSummary', { count: details.items.length })
  const summaryLine = (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <AppIcon name="image" className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
      <p className={`${SELECTABLE_TEXT_CLASS} truncate text-sm text-[var(--glass-text-secondary)]`}>{summaryText}</p>
    </div>
  )

  const cards: ShotGridCard[] = details.items.map((item, index) => {
    const fields = item.fields
    const shotScale = fieldValue(fields, labels('shotScale'))
    const lens = fieldValue(fields, labels('lens'))
    const focus = fieldValue(fields, labels('focus'))
    const cameraHeight = fieldValue(fields, labels('cameraHeight'))
    const cameraAngle = fieldValue(fields, labels('cameraAngle'))
    const movement = fieldValue(fields, labels('movement'))
    const composition = fieldValue(fields, labels('composition'))
    const lighting = fieldValue(fields, labels('lighting'))
    const axisAndEyeline = fieldValue(fields, labels('axisAndEyeline'))
    const characterNames = executionPlanCharacterNames(item)
    const objectNames = executionPlanObjectNames(item)
    const titleParts = [shotScale, lens].filter(hasText)
    const metaParts = [movement ?? composition, lighting].filter(hasText)
    return {
      key: executionPlanShotKey(item, index),
      badge: index + 1,
      title: titleParts.length > 0 ? compactList(titleParts, ' · ') : item.title,
      subtitle: item.body ?? undefined,
      meta: metaParts.length > 0 ? compactList(metaParts, ' · ') : undefined,
      characterCount: characterNames.length,
      detailTitle: labels('shotIndex', { index: index + 1 }),
      detailMeta: titleParts.length > 0 ? compactList(titleParts, ' · ') : item.title,
      detail: (
        <div className="space-y-2.5">
          {shotDetailIconGrid(
            [
              { label: labels('shotScale'), value: shotScale },
              { label: labels('lens'), value: lens },
              { label: labels('focus'), value: focus },
              { label: labels('cameraHeight'), value: cameraHeight },
              { label: labels('cameraAngle'), value: cameraAngle },
              { label: labels('movement'), value: movement },
              { label: labels('composition'), value: composition },
              { label: labels('lighting'), value: lighting },
              { label: labels('axisAndEyeline'), value: axisAndEyeline },
              {
                label: labels('characters'),
                value: compactList(characterNames, '\n'),
              },
              {
                label: labels('keyObjects'),
                value: compactList(objectNames, '\n'),
              },
              { label: labels('description'), value: item.body },
            ],
            { fixedColumns: true, allowWideFields: false },
          )}
        </div>
      ),
    }
  })

  return (
    <>
      {!expanded ? summaryLine : null}
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false} className={nodeContentInteractionClass(data, 'space-y-2.5')}>
        <ShotGrid cards={cards} accent="slate" streamPresentation={data.lifecycle.stream ?? undefined} />
      </WorkspaceCanvasMotionPresence>
    </>
  )
}
