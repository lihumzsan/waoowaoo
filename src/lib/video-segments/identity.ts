import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'

export function canonicalVideoSegmentId(editScriptId: string, segmentId: string): string {
  const hex = hashCanonicalJson({ kind: 'project_video_segment', editScriptId, segmentId }).slice(0, 32)
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
