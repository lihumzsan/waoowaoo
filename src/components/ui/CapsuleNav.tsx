'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

/**
 * EpisodeSelector - 剧集选择器
 */
interface Episode {
    id: string
    title: string
    summary?: string
    overview?: EpisodeSelectorOverview
}

interface EpisodeSelectorOverviewMetric {
    label: string
    value: string
}

interface EpisodeSelectorOverviewChip {
    label: string
}

interface EpisodeSelectorOverviewChapter {
    id: string
    title: string
    summary: string
    indexLabel: string
    meta: readonly string[]
    tone: 'muted' | 'ready' | 'processing' | 'success' | 'danger'
}

interface EpisodeSelectorOverview {
    title: string
    summaryLabel: string
    statusTone: 'muted' | 'ready' | 'processing' | 'success' | 'warning' | 'danger'
    metrics: readonly EpisodeSelectorOverviewMetric[]
    chips: readonly EpisodeSelectorOverviewChip[]
    chapters: readonly EpisodeSelectorOverviewChapter[]
    emptyChaptersLabel: string
}

interface EpisodeSelectorProps {
    episodes: Episode[]
    currentId: string
    onSelect: (id: string) => void
    onAdd?: () => void
    onRename?: (id: string, newName: string) => void
    onDelete?: (id: string) => void
    projectName?: string  // 项目名称，显示在左上角
    onProjectRename?: (newName: string) => void | Promise<void>
    currentOverviewScopeId?: string
    allOverviewScopeId?: string
    getChapterOverviewScopeId?: (chapterId: string) => string
    onOverviewScopeSelect?: (scopeId: string) => void
}

interface ProjectNameEditorProps {
    projectName?: string
    onRename?: (newName: string) => void | Promise<void>
    t: (key: 'cancel' | 'editProjectName' | 'project' | 'projectNamePlaceholder' | 'projectRenameFailed' | 'save') => string
}

export function ProjectNameEditor({ projectName, onRename, t }: ProjectNameEditorProps) {
    const displayName = projectName?.trim() || t('project')
    const [isEditing, setIsEditing] = useState(false)
    const [draftName, setDraftName] = useState(displayName)
    const [isSaving, setIsSaving] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    const startEditing = () => {
        setDraftName(displayName)
        setErrorMessage(null)
        setIsEditing(true)
    }

    const cancelEditing = () => {
        setDraftName(displayName)
        setErrorMessage(null)
        setIsEditing(false)
    }

    const submitRename = async () => {
        const nextName = draftName.trim()
        if (!nextName || isSaving) return
        if (!onRename || nextName === displayName) {
            setIsEditing(false)
            return
        }

        setIsSaving(true)
        setErrorMessage(null)
        try {
            await onRename(nextName)
            setIsEditing(false)
        } catch (error: unknown) {
            setErrorMessage(error instanceof Error && error.message ? error.message : t('projectRenameFailed'))
        } finally {
            setIsSaving(false)
        }
    }

    if (isEditing) {
        return (
            <div className="mb-1 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]">
                        <AppIcon name="folder" className="h-3.5 w-3.5" />
                    </div>
                    <input
                        type="text"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                void submitRename()
                            } else if (event.key === 'Escape') {
                                cancelEditing()
                            }
                        }}
                        className="min-w-0 flex-1 rounded-md border border-[var(--glass-stroke-base)] bg-white/40 px-2 py-1 text-sm font-bold text-[var(--glass-text-primary)] outline-none focus:border-[var(--glass-stroke-strong)]"
                        placeholder={t('projectNamePlaceholder')}
                        autoFocus
                    />
                    <button
                        type="button"
                        onClick={() => { void submitRename() }}
                        disabled={isSaving || !draftName.trim()}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--glass-text-secondary)] transition-colors hover:bg-[var(--glass-bg-surface-strong)] hover:text-[var(--glass-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                        title={t('save')}
                    >
                        <AppIcon name="check" className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isSaving}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--glass-text-tertiary)] transition-colors hover:bg-[var(--glass-bg-surface-strong)] hover:text-[var(--glass-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
                        title={t('cancel')}
                    >
                        <AppIcon name="close" className="h-3.5 w-3.5" />
                    </button>
                </div>
                {errorMessage && (
                    <div className="mt-2 text-xs text-[var(--glass-tone-danger-fg)]">
                        {errorMessage}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="mb-1 flex items-center gap-1.5 px-2 py-1.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]">
                <AppIcon name="folder" className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 truncate text-sm font-bold text-[var(--glass-text-primary)]">{displayName}</div>
            {onRename && (
                <button
                    type="button"
                    onClick={startEditing}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--glass-text-tertiary)] transition-colors hover:bg-[var(--glass-bg-surface-strong)] hover:text-[var(--glass-text-secondary)]"
                    title={t('editProjectName')}
                >
                    <AppIcon name="edit" className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    )
}

function overviewToneClass(tone: EpisodeSelectorOverview['statusTone'] | EpisodeSelectorOverviewChapter['tone']): string {
    if (tone === 'success') return 'bg-[var(--glass-tone-success-fg)]'
    if (tone === 'processing') return 'bg-[var(--glass-accent-from)]'
    if (tone === 'warning') return 'bg-[var(--glass-tone-warning-fg)]'
    if (tone === 'danger') return 'bg-[var(--glass-tone-danger-fg)]'
    if (tone === 'ready') return 'bg-[var(--glass-tone-info-fg)]'
    return 'bg-[var(--glass-stroke-strong)]'
}

export function EpisodeOverviewPanel({
    overview,
    currentScopeId,
    allScopeId,
    getChapterScopeId,
    onScopeSelect,
}: {
    readonly overview: EpisodeSelectorOverview
    readonly currentScopeId?: string
    readonly allScopeId?: string
    readonly getChapterScopeId?: (chapterId: string) => string
    readonly onScopeSelect?: (scopeId: string) => void
}) {
    const scopeT = useTranslations('projectWorkflow.workspaceScope')
    const scopeButtonClass = (active: boolean) => [
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold transition',
        active
            ? 'border-[var(--glass-stroke-strong)] bg-neutral-900 text-white'
            : 'border-[var(--glass-stroke-soft)] bg-white/70 text-[var(--glass-text-secondary)] hover:bg-white hover:text-[var(--glass-text-primary)]',
    ].join(' ')
    return (
        <section className="mb-2 overflow-hidden rounded-xl border border-[var(--glass-stroke-soft)] bg-white/55">
            <div className="border-b border-[var(--glass-stroke-soft)] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${overviewToneClass(overview.statusTone)}`} />
                    <div className="min-w-0 flex-1 truncate text-sm font-bold text-[var(--glass-text-primary)]">{overview.title}</div>
                    <span className="shrink-0 rounded-full border border-[var(--glass-stroke-base)] bg-white/60 px-2 py-0.5 text-[10px] font-medium text-[var(--glass-text-secondary)]">
                        {overview.summaryLabel}
                    </span>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-px bg-[var(--glass-stroke-soft)]">
                {overview.metrics.map((metric) => (
                    <div key={metric.label} className="min-w-0 bg-white/70 px-3 py-2">
                        <div className="truncate text-[10px] text-[var(--glass-text-tertiary)]">{metric.label}</div>
                        <div className="mt-0.5 truncate text-sm font-bold text-[var(--glass-text-primary)]">{metric.value}</div>
                    </div>
                ))}
            </div>
            <div className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                    {allScopeId && onScopeSelect ? (
                        <button
                            type="button"
                            className={scopeButtonClass(currentScopeId === allScopeId)}
                            onClick={() => onScopeSelect(allScopeId)}
                        >
                            <AppIcon name="grid" className="h-3 w-3" />
                            {scopeT('all')}
                        </button>
                    ) : null}
                    {overview.chips.map((chip) => (
                        <span key={chip.label} className="rounded-full bg-[var(--glass-bg-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--glass-text-secondary)]">
                            {chip.label}
                        </span>
                    ))}
                </div>
                <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1 app-scrollbar">
                    {overview.chapters.length > 0 ? overview.chapters.map((chapter) => {
                        const scopeId = getChapterScopeId?.(chapter.id)
                        const active = Boolean(scopeId && currentScopeId === scopeId)
                        const className = [
                            'flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition',
                            active
                                ? 'border-[var(--glass-stroke-strong)] bg-white shadow-sm'
                                : 'border-[var(--glass-stroke-soft)] bg-white/70',
                            scopeId && onScopeSelect ? 'hover:border-[var(--glass-stroke-strong)]' : '',
                        ].join(' ')
                        const content = (
                            <>
                            <span className="mt-1 flex items-center gap-1">
                                <span className={`h-1.5 w-1.5 rounded-full ${overviewToneClass(chapter.tone)}`} />
                                <span className="text-[10px] font-semibold text-[var(--glass-text-tertiary)]">{chapter.indexLabel}</span>
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-semibold text-[var(--glass-text-primary)]">{chapter.title}</div>
                                <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--glass-text-secondary)]">{chapter.summary}</div>
                                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--glass-text-tertiary)]">
                                    {chapter.meta.map((item) => <span key={item}>{item}</span>)}
                                </div>
                            </div>
                            </>
                        )
                        return scopeId && onScopeSelect ? (
                            <button
                                key={chapter.id}
                                type="button"
                                className={className}
                                onClick={() => onScopeSelect(scopeId)}
                            >
                                {content}
                            </button>
                        ) : (
                            <div key={chapter.id} className={className}>
                                {content}
                            </div>
                        )
                    }) : (
                        <div className="rounded-lg border border-dashed border-[var(--glass-stroke-base)] px-3 py-4 text-center text-xs text-[var(--glass-text-tertiary)]">
                            {overview.emptyChaptersLabel}
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}

export function EpisodeSelector({
    episodes,
    currentId,
    onSelect,
    onAdd,
    onRename,
    onDelete,
    projectName,
    onProjectRename,
    currentOverviewScopeId,
    allOverviewScopeId,
    getChapterOverviewScopeId,
    onOverviewScopeSelect
}: EpisodeSelectorProps) {
    const t = useTranslations('common')
    const [isOpen, setIsOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState('')
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const currentEp = episodes.find(e => e.id === currentId) || episodes[0]
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    if (!currentEp) return null

    return (
        <div className="fixed top-20 left-6 z-40" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="glass-btn-base glass-btn-secondary flex items-center gap-3 px-4 py-3 transition-all group"
                style={{ borderRadius: '1.5rem' }}
            >
                <div className="glass-surface-soft flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold text-[var(--glass-tone-info-fg)]">
                    {t('episode')}
                </div>
                <div className="flex flex-col items-start text-left mr-2">
                    <span className="text-sm font-bold text-[var(--glass-text-primary)] line-clamp-1 max-w-[160px]">
                        {projectName || t('project')}
                    </span>
                    <span className="flex max-w-[160px] items-center gap-1.5 text-sm text-[var(--glass-text-secondary)]">
                        {currentEp.overview ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${overviewToneClass(currentEp.overview.statusTone)}`} /> : null}
                        <span className="truncate">{currentEp.title}</span>
                    </span>
                    {currentEp.overview ? (
                        <span className="max-w-[160px] truncate text-[11px] text-[var(--glass-text-tertiary)]">
                            {currentEp.overview.summaryLabel}
                        </span>
                    ) : null}
                </div>
                <AppIcon name="chevronDown" className={`w-4 h-4 text-[var(--glass-text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="glass-surface-modal absolute left-0 top-full mt-2 max-h-[calc(100dvh-7rem)] w-[min(36rem,calc(100vw-3rem))] origin-top-left overflow-y-auto p-2 animate-fadeIn app-scrollbar">
                    <ProjectNameEditor
                        projectName={projectName}
                        onRename={onProjectRename}
                        t={t}
                    />
                    {currentEp.overview ? (
                        <EpisodeOverviewPanel
                            overview={currentEp.overview}
                            currentScopeId={currentOverviewScopeId}
                            allScopeId={allOverviewScopeId}
                            getChapterScopeId={getChapterOverviewScopeId}
                            onScopeSelect={onOverviewScopeSelect}
                        />
                    ) : null}
                    <div className="space-y-1">
                        {episodes.map(ep => {
                            const statusColor = ep.overview
                                ? overviewToneClass(ep.overview.statusTone)
                                : 'bg-[var(--glass-stroke-strong)]'

                            // 编辑模式
                            if (editingId === ep.id) {
                                return (
                                    <div key={ep.id} className="flex min-w-0 items-center gap-2 p-3 rounded-xl bg-[var(--glass-tone-info-bg)] border border-[var(--glass-stroke-focus)]">
                                        <div className={`w-2 h-10 shrink-0 rounded-full ${statusColor}`} />
                                        <input
                                            type="text"
                                            value={editingName}
                                            onChange={(e) => setEditingName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && editingName.trim()) {
                                                    onRename?.(ep.id, editingName.trim())
                                                    setEditingId(null)
                                                } else if (e.key === 'Escape') {
                                                    setEditingId(null)
                                                }
                                            }}
                                            className="min-w-0 flex-1 px-2 py-1 text-sm border border-[var(--glass-stroke-focus)] rounded-lg focus:outline-none"
                                            autoFocus
                                        />
                                        <button
                                            onClick={() => {
                                                if (editingName.trim()) {
                                                    onRename?.(ep.id, editingName.trim())
                                                }
                                                setEditingId(null)
                                            }}
                                            className="w-7 h-7 shrink-0 rounded-lg bg-[var(--glass-accent-from)] text-white hover:bg-[var(--glass-accent-to)] flex items-center justify-center"
                                        >
                                            <AppIcon name="check" className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => setEditingId(null)}
                                            className="w-7 h-7 shrink-0 rounded-lg bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-surface-strong)] flex items-center justify-center"
                                        >
                                            <AppIcon name="close" className="w-4 h-4" />
                                        </button>
                                    </div>
                                )
                            }

                            // 删除确认模式
                            if (deletingId === ep.id) {
                                return (
                                    <div key={ep.id} className="flex min-w-0 items-center gap-2 p-3 rounded-xl bg-[var(--glass-tone-danger-bg)] border border-[var(--glass-tone-danger-fg)]/30">
                                        <div className="min-w-0 flex-1 text-sm font-medium text-[var(--glass-tone-danger-fg)] truncate">
                                            {t('deleteEpisode')}：{ep.title}
                                        </div>
                                        <button
                                            onClick={() => {
                                                onDelete?.(ep.id)
                                                setDeletingId(null)
                                                setIsOpen(false)
                                            }}
                                            className="shrink-0 px-2 py-1 rounded-lg bg-[var(--glass-tone-danger-fg)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
                                        >
                                            {t('deleteEpisodeConfirm')}
                                        </button>
                                        <button
                                            onClick={() => setDeletingId(null)}
                                            className="w-7 h-7 shrink-0 rounded-lg bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-surface-strong)] flex items-center justify-center"
                                        >
                                            <AppIcon name="close" className="w-4 h-4" />
                                        </button>
                                    </div>
                                )
                            }

                            return (
                                <div
                                    key={ep.id}
                                    className={`w-full min-w-0 flex items-center gap-3 p-3 rounded-xl transition-all ${ep.id === currentId
                                        ? 'bg-[var(--glass-tone-info-bg)] border border-[var(--glass-stroke-focus)]'
                                        : 'hover:bg-[var(--glass-bg-muted)] border border-transparent'
                                        }`}
                                >
                                    <button
                                        onClick={() => { onSelect(ep.id); setIsOpen(false); }}
                                        className="min-w-0 flex-1 flex items-center gap-3 text-left"
                                    >
                                        <div className={`w-2 h-10 shrink-0 rounded-full ${statusColor}`} />
                                        <div className="min-w-0 flex-1">
                                            <div className="font-bold text-[var(--glass-text-primary)] text-sm truncate">{ep.title}</div>
                                            {ep.summary && (
                                                <div className="text-xs text-[var(--glass-text-tertiary)] truncate">{ep.summary}</div>
                                            )}
                                        </div>
                                        {ep.id === currentId && (
                                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
                                                <AppIcon name="checkDot" className="h-2.5 w-2.5" />
                                            </span>
                                        )}
                                    </button>
                                    {onRename && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setEditingId(ep.id)
                                                setEditingName(ep.title)
                                            }}
                                            className="w-7 h-7 shrink-0 rounded-lg hover:bg-[var(--glass-bg-surface-strong)] flex items-center justify-center text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-secondary)] transition-colors"
                                            title={t('editEpisodeName')}
                                        >
                                            <AppIcon name="edit" className="w-4 h-4" />
                                        </button>
                                    )}
                                    {onDelete && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setDeletingId(ep.id)
                                            }}
                                            className="w-7 h-7 shrink-0 rounded-lg hover:bg-[var(--glass-tone-danger-bg)] flex items-center justify-center text-[var(--glass-text-tertiary)] hover:text-[var(--glass-tone-danger-fg)] transition-colors"
                                            title={t('deleteEpisode')}
                                        >
                                            <AppIcon name="trash" className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    {onAdd && (
                        <>
                            <div className="h-px bg-[var(--glass-bg-muted)] my-2 mx-2" />
                            <button
                                onClick={() => { onAdd(); setIsOpen(false); }}
                                className="w-full flex items-center justify-center gap-2 p-2 rounded-xl text-[var(--glass-text-tertiary)] hover:text-[var(--glass-tone-info-fg)] hover:bg-[var(--glass-tone-info-bg)] font-medium text-sm transition-colors"
                            >
                                <span className="text-lg">+</span> {t('newEpisode')}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
