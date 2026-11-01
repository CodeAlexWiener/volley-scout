import { AbsoluteFill, OffthreadVideo, staticFile, useVideoConfig } from 'remotion'

export type LabeledClipProps = {
  src: string
  startSec: number
  endSec: number
  label: string
}

/** One scout clip: the source match, trimmed, with the action label burned in. */
export function LabeledClip({ src, startSec, endSec, label }: LabeledClipProps) {
  const { fps } = useVideoConfig()
  const trimBefore = Math.max(0, Math.round(startSec * fps))
  const durationInFrames = Math.max(1, Math.round((endSec - startSec) * fps))

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a1510' }}>
      <OffthreadVideo
        src={staticFile(src)}
        trimBefore={trimBefore}
        durationInFrames={durationInFrames}
      />
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          padding: 16,
        }}
      >
        <div
          style={{
            alignSelf: 'flex-start',
            maxWidth: '90%',
            background: 'rgba(8, 18, 14, 0.78)',
            color: '#eef3ee',
            border: '1px solid rgba(226, 196, 138, 0.7)',
            borderRadius: 6,
            padding: '6px 10px',
            fontFamily: 'sans-serif',
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          {label}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
