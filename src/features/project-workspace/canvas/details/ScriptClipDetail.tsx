'use client'

import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useProjectAssets } from '@/lib/query/hooks'
import type { ProjectClip } from '@/types/project'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import {
  ActionButton,
  DetailSection,
  Field,
  TextArea,
  TextInput,
  splitList,
  uniqueStrings,
} from './detail-shared'

interface ScriptClipDetailProps {
  readonly clip: ProjectClip
  readonly node: WorkspaceCanvasFlowNode
  readonly projectId: string
  readonly allClips: readonly ProjectClip[]
  readonly onSave: (clipId: string, data: Record<string, unknown>) => Promise<void>
  readonly onGenerateStoryboard?: () => Promise<void>
  readonly onOpenAssetLibrary: (characterId?: string | null) => void
}

function serializeList(values: readonly string[]): string {
  return uniqueStrings(values).join(', ')
}

function parseJsonPreview(value: string): string | null {
  if (!value.trim()) return null
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2)
  } catch {
    return value
  }
}

export default function ScriptClipDetail(props: ScriptClipDetailProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace.detail')
  const { data: assets } = useProjectAssets(props.projectId)
  const [summary, setSummary] = useState(props.clip.summary)
  const [content, setContent] = useState(props.clip.content)
  const [screenplay, setScreenplay] = useState(props.clip.screenplay ?? '')
  const [locations, setLocations] = useState(splitList(props.clip.location ?? ''))
  const [characters, setCharacters] = useState(splitList(props.clip.characters ?? ''))
  const [propsList, setPropsList] = useState(splitList(props.clip.props ?? ''))
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [selectedPropId, setSelectedPropId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSummary(props.clip.summary)
    setContent(props.clip.content)
    setScreenplay(props.clip.screenplay ?? '')
    setLocations(splitList(props.clip.location ?? ''))
    setCharacters(splitList(props.clip.characters ?? ''))
    setPropsList(splitList(props.clip.props ?? ''))
  }, [props.clip])

  useEffect(() => {
    setSelectedCharacterId(assets?.characters[0]?.id ?? '')
    setSelectedLocationId(assets?.locations[0]?.id ?? '')
    setSelectedPropId(assets?.props[0]?.id ?? '')
  }, [assets])

  const allAssetReferences = useMemo(() => ({
    characters: uniqueStrings(props.allClips.flatMap((clip) => splitList(clip.characters ?? ''))),
    locations: uniqueStrings(props.allClips.flatMap((clip) => splitList(clip.location ?? ''))),
    props: uniqueStrings(props.allClips.flatMap((clip) => splitList(clip.props ?? ''))),
  }), [props.allClips])

  const save = async () => {
    setSaving(true)
    try {
      await props.onSave(props.clip.id, {
        summary,
        content,
        screenplay,
        location: serializeList(locations),
        characters: serializeList(characters),
        props: serializeList(propsList),
      })
    } finally {
      setSaving(false)
    }
  }

  const addSelectedCharacter = () => {
    const character = assets?.characters.find((item) => item.id === selectedCharacterId)
    if (!character) return
    setCharacters((current) => uniqueStrings([...current, character.name]))
  }

  const addSelectedLocation = () => {
    const location = assets?.locations.find((item) => item.id === selectedLocationId)
    if (!location) return
    setLocations((current) => uniqueStrings([...current, location.name]))
  }

  const addSelectedProp = () => {
    const prop = assets?.props.find((item) => item.id === selectedPropId)
    if (!prop) return
    setPropsList((current) => uniqueStrings([...current, prop.name]))
  }

  const renderChips = (items: readonly string[], onRemove: (value: string) => void) => (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-1 text-xs">
          {item}
          <button type="button" onClick={() => onRemove(item)}>
            <AppIcon name="closeMd" className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )

  return (
    <div className="space-y-4">
      <DetailSection title={t('sections.clipEdit')}>
        <Field label={t('fields.summary')}><TextInput value={summary} onChange={setSummary} /></Field>
        <Field label={t('fields.originalClip')}><TextArea value={content} onChange={setContent} rows={5} /></Field>
        <Field label={t('fields.screenplay')}><TextArea value={screenplay} onChange={setScreenplay} rows={10} /></Field>
        {parseJsonPreview(screenplay) ? (
          <pre className="max-h-72 overflow-auto rounded-md border border-black/5 bg-white p-3 text-xs leading-5 text-[var(--glass-text-secondary)]">
            {parseJsonPreview(screenplay)}
          </pre>
        ) : null}
      </DetailSection>

      <DetailSection title={t('sections.assets')}>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3">
            <Field label={t('fields.characters')}>
              {renderChips(characters, (value) => setCharacters((current) => current.filter((item) => item !== value)))}
            </Field>
            <div className="flex gap-2">
              <select value={selectedCharacterId} onChange={(event) => setSelectedCharacterId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--glass-stroke-base)] bg-white px-3 py-2 text-sm">
                <option value="">{t('empty.selectCharacter')}</option>
                {assets?.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
              </select>
              <ActionButton onClick={addSelectedCharacter} disabled={!selectedCharacterId}>{t('actions.add')}</ActionButton>
            </div>
          </div>
          <div className="space-y-3">
            <Field label={t('fields.locations')}>
              {renderChips(locations, (value) => setLocations((current) => current.filter((item) => item !== value)))}
            </Field>
            <div className="flex gap-2">
              <select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--glass-stroke-base)] bg-white px-3 py-2 text-sm">
                <option value="">{t('empty.selectLocation')}</option>
                {assets?.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
              <ActionButton onClick={addSelectedLocation} disabled={!selectedLocationId}>{t('actions.add')}</ActionButton>
            </div>
          </div>
          <div className="space-y-3">
            <Field label={t('fields.props')}>
              {renderChips(propsList, (value) => setPropsList((current) => current.filter((item) => item !== value)))}
            </Field>
            <div className="flex gap-2">
              <select value={selectedPropId} onChange={(event) => setSelectedPropId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[var(--glass-stroke-base)] bg-white px-3 py-2 text-sm">
                <option value="">{t('empty.selectProp')}</option>
                {assets?.props.map((prop) => <option key={prop.id} value={prop.id}>{prop.name}</option>)}
              </select>
              <ActionButton onClick={addSelectedProp} disabled={!selectedPropId}>{t('actions.add')}</ActionButton>
            </div>
          </div>
        </div>
      </DetailSection>

      <DetailSection title={t('sections.assetCoverage')}>
        <div className="grid gap-3 md:grid-cols-3">
          <p className="rounded-md bg-white p-3 text-sm">{t('stats.characters', { count: allAssetReferences.characters.length })}</p>
          <p className="rounded-md bg-white p-3 text-sm">{t('stats.locations', { count: allAssetReferences.locations.length })}</p>
          <p className="rounded-md bg-white p-3 text-sm">{t('stats.props', { count: allAssetReferences.props.length })}</p>
        </div>
      </DetailSection>

      <div className="flex flex-wrap justify-end gap-2">
        <ActionButton onClick={() => props.onOpenAssetLibrary(characters[0] ?? null)}>{t('actions.openAssetLibrary')}</ActionButton>
        <ActionButton onClick={save} disabled={saving} variant="primary">{saving ? t('actions.saving') : t('actions.saveClip')}</ActionButton>
        {props.onGenerateStoryboard ? (
          <ActionButton onClick={props.onGenerateStoryboard}>{t('actions.generateStoryboard')}</ActionButton>
        ) : null}
      </div>
    </div>
  )
}
