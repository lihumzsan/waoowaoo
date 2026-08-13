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
    // Beautiful UI SourceChip: a quiet inline pill carrying the site's icon and
    // domain in 10.5px mono, so several citations stay readable in one line.
    const domain = readSourceDomain(href)
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={href}
        className="ml-0 mr-1 inline-flex h-[18px] max-w-[16rem] translate-y-[-1px] items-center gap-1 rounded-[5px] bg-[var(--bui-inset)] px-[3px] align-middle font-mono text-[10.5px] leading-none text-[var(--bui-ink-2)] no-underline shadow-[var(--bui-shadow-hairline)] transition-colors duration-150 hover:bg-[var(--bui-hover)] hover:text-[var(--bui-ink)]"
      >
        <WebSourceFavicon domain={domain} className="h-3 w-3 shrink-0 rounded-[3px]" />
        <span className="truncate">{domain}</span>
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

function MarkdownStrong(props: { readonly children?: React.ReactNode }) {
  return (
    <strong className="font-semibold text-[var(--glass-text-primary)]">
      {props.children}
    </strong>
  )
}

function MarkdownParagraph(props: { readonly children?: React.ReactNode }) {
  const children = React.Children.toArray(props.children)
  const isStandaloneStrong = children.length === 1
    && React.isValidElement(children[0])
    && children[0].type === MarkdownStrong

  if (isStandaloneStrong) {
    return (
      <p className="mb-3 mt-6 text-lg font-semibold leading-7 text-[var(--glass-text-primary)] first:mt-0 first:text-xl first:leading-8 last:mb-0">
        {props.children}
      </p>
    )
  }

  return <p className="mb-4 leading-7 last:mb-0">{props.children}</p>
}

const markdownComponents: Components = {
  p: MarkdownParagraph,
  ul: ({ children }) => (
    <ul className="mb-4 list-disc pl-6 leading-7 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 list-decimal pl-6 leading-7 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="mb-2 last:mb-0">{children}</li>
  ),
  code: ({ children, className }) => {
    const isInline = !className
    if (isInline) {
      return (
        <code className="whitespace-normal rounded bg-[var(--glass-bg-surface)] px-1.5 py-0.5 font-mono text-[0.9em] leading-[1.5] text-[var(--glass-text-primary)] [overflow-wrap:anywhere]">
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
    <pre className="mb-4 max-w-full overflow-x-auto rounded-xl bg-[var(--glass-bg-surface)] p-4 font-mono text-sm leading-6 text-[var(--glass-text-primary)] last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-l-2 border-[var(--glass-stroke-base)] py-1 pl-4 leading-7 text-[var(--glass-text-secondary)] last:mb-0">
      {children}
    </blockquote>
  ),
  a: WorkspaceMarkdownLink,
  h1: ({ children }) => (
    <h1 className="mb-4 mt-7 text-xl font-semibold leading-8 text-[var(--glass-text-primary)] first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-6 text-lg font-semibold leading-7 text-[var(--glass-text-primary)] first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-3 mt-5 text-[17px] font-semibold leading-7 text-[var(--glass-text-primary)] first:mt-0">{children}</h3>
  ),
  strong: MarkdownStrong,
  hr: () => (
    <hr className="my-6 border-[var(--glass-stroke-base)]" />
  ),
  table: ({ children }) => (
    <div className="mb-4 max-w-full overflow-x-auto last:mb-0">
      <table className="w-full text-sm leading-6">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--glass-stroke-base)] px-3 py-2">{children}</td>
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
    <div className="workspace-assistant-markdown min-w-0 max-w-full text-[17px] leading-7 [overflow-wrap:anywhere] [text-wrap:pretty]">
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
