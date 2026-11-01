import { Composition } from 'remotion'
import { LabeledClip, type LabeledClipProps } from './LabeledClip'

export function RemotionRoot() {

const FPS = 30

const defaultProps: LabeledClipProps = {
  src: 'source.mp4',
  startSec: 0,
  endSec: 2,
  label: 'Scout clip',
}

  return (
    <Composition
      id="LabeledClip"
      component={LabeledClip}
      durationInFrames={FPS * 2}
      fps={FPS}
      width={640}
      height={360}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const frames = Math.max(1, Math.round((props.endSec - props.startSec) * FPS))
        return { durationInFrames: frames, props }
      }}
    />
  )
}
