'use client'

import dynamic from 'next/dynamic'

const ConfigStage = dynamic(() => import('./ConfigStage'), {
  loading: () => <StageLoading />,
})
const ScriptStage = dynamic(() => import('./ScriptStage'), {
  loading: () => <StageLoading />,
})
const StoryboardStage = dynamic(() => import('./StoryboardStage'), {
  loading: () => <StageLoading />,
})
const VideoStageRoute = dynamic(() => import('./VideoStageRoute'), {
  loading: () => <StageLoading />,
})
const VoiceStageRoute = dynamic(() => import('./VoiceStageRoute'), {
  loading: () => <StageLoading />,
})

interface WorkspaceStageContentProps {
  currentStage: string
}

function StageLoading() {
  return (
    <div className="py-16 text-center text-sm text-[var(--glass-text-tertiary)]">
      Loading...
    </div>
  )
}

export default function WorkspaceStageContent({
  currentStage,
}: WorkspaceStageContentProps) {
  return (
    <div key={currentStage} className="animate-page-enter">
      {currentStage === 'config' && <ConfigStage />}

      {(currentStage === 'script' || currentStage === 'assets') && <ScriptStage />}

      {currentStage === 'storyboard' && <StoryboardStage />}

      {currentStage === 'videos' && <VideoStageRoute />}

      {currentStage === 'voice' && <VoiceStageRoute />}
    </div>
  )
}
