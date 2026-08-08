'use client'

import React, { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { TextMessagePartProps } from '@assistant-ui/react'
import type { Components } from 'react-markdown'
import { readSourceDomain, WebSourceFavicon } from './WebSourceFavicon'
import { useWorkspaceAssistantTextPlayback } from './WorkspaceAssistantTextPlayback'
import {
  projectWorkspacePathFromHref,
  useWorkspaceAssistantWorkspaceLink,
} from './workspace-assistant-workspace-link'

type StreamedHastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: StreamedHastNode[]
}

// 逐字动画会把文本节点拆成 <span>。结构性容器的子元素类型由 HTML 规范限定
// (<table> 只能容纳 <thead>/<tbody>/<tr>,<ul>/<ol> 只能容纳 <li>),
// 标签之间的换行空白若被包成 <span> 会产生非法嵌套并触发 hydration 失败。
// 这里只排除容器本身,单元格与列表项内部的文字仍然逐字播放。
const STREAMED_TEXT_EXCLUDED_TAGS = new Set([
  'code', 'pre', 'script', 'style',
  'table', 'thead', 'tbody', 'tfoot', 'tr',
  'ul', 'ol', 'dl',
])
function animateStreamedTextChildren(node: StreamedHastNode): void {
  if (!node.children || STREAMED_TEXT_EXCLUDED_TAGS.has(node.tagName ?? '')) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value) {
      return Array.from(child.value).map<StreamedHastNode>((character) => ({
        type: 'element',
        tagName: 'span',
        properties: { className: ['assistant-stream-in'] },
        children: [{ type: 'text', value: character }],
      }))
    }
    animateStreamedTextChildren(child)
    return [child]
  })
}

/**
 * Each character fades in once as it arrives, then it is ordinary text. The
 * animation belongs to the character's appearance, not to its distance from
 * the end — a ramp measured from the tail keeps re-dimming settled text as the
 * window slides, which reads as the whole paragraph floating.
 */
function rehypeAnimateWorkspaceAssistantStreamedText() {
  return (tree: StreamedHastNode) => animateStreamedTextChildren(tree)
}

function isExternalWebHref(href: string): boolean {
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function WorkspaceMarkdownLink(props: { readonly href?: string; readonly children?: React.ReactNode }) {
  const workspaceLink = useWorkspaceAssistantWorkspaceLink()
  const href = props.href?.trim() ?? ''
  if (isExternalWebHref(href)) {
    // Cited sources read as a run of blue underlines when a paragraph carries
    // several of them. A compact chip carrying the site's own icon keeps the
    // sentence readable and makes the source recognisable before it is clicked.
    const domain = readSourceDomain(href)
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={href}
        className="mx-0.5 inline-flex max-w-[16rem] items-baseline gap-1 rounded-md bg-black/[0.045] px-1.5 py-px align-baseline text-[0.9em] leading-[1.5] text-[var(--glass-text-secondary)] no-underline transition-colors hover:bg-black/[0.08] hover:text-[var(--glass-text-primary)]"
      >
        <WebSourceFavicon domain={domain} className="h-3 w-3 self-center" />
        <span className="truncate">{props.children}</span>
      </a>
    )
  }
  const workspacePath = projectWorkspacePathFromHref(href)
  if (workspaceLink && workspacePath) {
    return (
      <button
        type="button"
        className="break-words text-left text-[var(--glass-accent-from)] underline underline-offset-2 [overflow-wrap:anywhere]"
        onClick={() => workspaceLink.openWorkspacePath(workspacePath)}
      >
        {props.children}
      </button>
    )
  }
  return <span className="break-words text-[var(--glass-text-tertiary)]">{props.children}</span>
}

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="mb-1 last:mb-0">{children}</li>
  ),
  code: ({ children, className }) => {
    const isInline = !className
    if (isInline) {
      return (
        <code className="whitespace-normal rounded bg-[var(--glass-bg-surface)] px-1.5 py-0.5 text-xs font-mono text-[var(--glass-text-primary)] [overflow-wrap:anywhere]">
          {children}
        </code>
      )
    }
    return (
      <code className={className}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="mb-2 max-w-full overflow-x-auto rounded-xl bg-[var(--glass-bg-surface)] p-3 text-xs font-mono text-[var(--glass-text-primary)] last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 pl-3 text-[var(--glass-text-secondary)] last:mb-0">
      {children}
    </blockquote>
  ),
  a: WorkspaceMarkdownLink,
  h1: ({ children }) => (
    <h1 className="mb-2 text-base font-semibold text-[var(--glass-text-primary)]">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 text-sm font-semibold text-[var(--glass-text-primary)]">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 text-sm font-medium text-[var(--glass-text-primary)]">{children}</h3>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--glass-text-primary)]">{children}</strong>
  ),
  hr: () => (
    <hr className="my-3 border-[var(--glass-stroke-base)]" />
  ),
  table: ({ children }) => (
    <div className="mb-2 max-w-full overflow-x-auto last:mb-0">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-1 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--glass-stroke-base)] px-2 py-1">{children}</td>
  ),
}

function MarkdownTextPartImpl({
  text,
  status,
}: Pick<TextMessagePartProps, 'text' | 'status'>) {
  const playback = useWorkspaceAssistantTextPlayback({
    text,
    running: status.type === 'running',
  })
  if (!playback.text) return null

  return (
    <div className="workspace-assistant-markdown min-w-0 max-w-full [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={playback.animating
          ? [rehypeAnimateWorkspaceAssistantStreamedText]
          : []}
        components={markdownComponents}
      >
        {playback.text}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownTextPart = memo(MarkdownTextPartImpl)
