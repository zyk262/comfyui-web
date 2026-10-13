import {Composition} from 'remotion';
import {GachaDraw} from './GachaDraw';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="GachaDraw" component={GachaDraw} durationInFrames={900} fps={60} width={900} height={600}/>
    </>
  );
};
