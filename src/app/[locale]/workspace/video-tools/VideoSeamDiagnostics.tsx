import { useTranslations } from 'next-intl'
import type { VideoSeamAudioPolicy } from '@/lib/video-tools/seam-bridge-plan'
import type { VideoSeamDiagnostics as VideoSeamDiagnosticsData } from './video-tools-state'

type Props = { diagnostics: VideoSeamDiagnosticsData }

const AUDIO_POLICY_KEYS: Record<VideoSeamAudioPolicy, string> = {
  both: 'diagnostics.audioBoth',
  video1_only: 'diagnostics.audioVideo1Only',
  video2_only: 'diagnostics.audioVideo2Only',
  silent: 'diagnostics.audioSilent',
}

export default function VideoSeamDiagnostics({ diagnostics }: Props) {
  const t = useTranslations('videoTools')
  const { output, bridge } = diagnostics
  const sourceAnchors = bridge.sourceAnchors
  const canvas = bridge.generationCanvas

  return (
    <section className="mt-4 rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
      <h4 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('diagnostics.title')}</h4>
      <dl className="mt-3 grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.output')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">
            {output.width}x{output.height} · {output.fps} fps
          </dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.outputFrames')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">{output.frameCount}</dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.outputAudio')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">
            {t(output.hasAudio ? 'diagnostics.audioPresent' : 'diagnostics.audioAbsent')}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.requestedDuration')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">
            {bridge.requestedDurationSeconds} s
          </dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.generatedFrames')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">{bridge.generatedFrameCount}</dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.handleFrames')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">{bridge.handleFrames}</dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.centralFrames')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">{bridge.centralFrameCount}</dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.centralSilence')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">
            {bridge.centralSilenceSeconds.toFixed(3)} s
          </dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.motionAnchors')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">
            <span className="block">
              {t('diagnostics.sourceAnchors')}: {sourceAnchors.input1Pre}, {sourceAnchors.input1Endpoint}, {sourceAnchors.input2Endpoint}, {sourceAnchors.input2Post}
            </span>
            <span className="mt-0.5 block">
              {t('diagnostics.generatedAnchors')}: {bridge.generatedAnchors.join(', ')}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.generationCanvas')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">
            {canvas.width}x{canvas.height} · {canvas.contentWidth}x{canvas.contentHeight}
            <span className="mt-0.5 block text-[var(--glass-text-secondary)]">
              {t('diagnostics.canvasPadding')}: {canvas.padLeft}, {canvas.padTop}, {canvas.padRight}, {canvas.padBottom}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.targetBitrate')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">{bridge.targetBitrateMbps} Mbps</dd>
        </div>
        <div>
          <dt className="text-[var(--glass-text-tertiary)]">{t('diagnostics.audioPolicy')}</dt>
          <dd className="mt-1 font-medium text-[var(--glass-text-primary)]">
            {t(AUDIO_POLICY_KEYS[bridge.audioPolicy])}
            <span className="mt-0.5 block text-[var(--glass-text-secondary)]">
              {t('diagnostics.video2Tempo')}: {bridge.video2AudioTempoFactor.toFixed(6)}
            </span>
          </dd>
        </div>
      </dl>
    </section>
  )
}
