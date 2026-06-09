import type { AgentSkillManifest } from '@/lib/agent-skills/types'

export const audioDirectionSkill: AgentSkillManifest = {
  id: 'audio-direction',
  name: 'Audio Direction',
  summary: 'Guide voice, music, ambience, silence, and lip-sync decisions.',
  description: 'Helps the assistant plan audio choices and call generation operations only after user approval when needed.',
  triggers: ['声音', '配音', '音乐', '氛围声', 'lip sync', 'voice', 'music', 'audio'],
  riskLevel: 'medium',
  requiresApproval: true,
  allowedOperationIds: ['get_project_context', 'get_project_snapshot', 'generate_project_music'],
  documentPath: 'skills/agent/audio-direction/SKILL.md',
}
