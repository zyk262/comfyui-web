import {createRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Player, PlayerRef} from '@remotion/player';
import {GachaDraw} from './GachaDraw';

const ref = createRef<PlayerRef>();
let mounted = false;
const mount = () => {
  if (mounted) return;
  const host = document.getElementById('remotion-draw');
  if (!host) throw new Error('Missing Remotion draw surface');
  flushSync(() => createRoot(host).render(<Player ref={ref} component={GachaDraw}
    durationInFrames={900} fps={60} compositionWidth={900} compositionHeight={600}
    controls={false} loop={false} moveToBeginningWhenEnded={false}
    clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false}
    style={{width:'100%',height:'100%'}}/>));
  mounted = true;
};
const bridge = {
  play(elapsedMs = 0, reduced = false) {
    mount();
    ref.current?.pause();
    ref.current?.seekTo(reduced ? 899 : Math.min(899,Math.floor(elapsedMs*.06)));
    if (!reduced && elapsedMs < 15000) ref.current?.play();
  },
  hold() {ref.current?.pause(); ref.current?.seekTo(899);},
  reset() {ref.current?.pause(); ref.current?.seekTo(0);},
};
Object.assign(globalThis,{YukiRemotion:bridge});
