import { AbsoluteFill, Audio, staticFile, Composition } from 'remotion';
import { ProblemScene } from './scenes/ProblemScene';
import { MindOSIntro } from './scenes/MindOSIntro';
import { FeatureShowcase } from './scenes/FeatureShowcase';
import { CTAScene } from './scenes/CTAScene';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MindOSDemo"
        component={MindOSDemo}
        durationInFrames={1200}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

const MindOSDemo: React.FC = () => {
  return (
    <div style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      {/* 背景音乐 - 从第 0 帧开始播放 */}
      <Audio
        src={staticFile('background-music.mp3')}
        volume={0.3}  // 音量 30%，不要盖过画面
        startFrom={0}
        endAt={1200}
      />

      {/* Scene 1: 问题场景 (0-150 frames = 0-5s) */}
      <ProblemScene startFrame={0} endFrame={150} />

      {/* Scene 2: MindOS 核心理念 (150-750 frames = 5-25s) */}
      <MindOSIntro startFrame={150} endFrame={750} />

      {/* Scene 3: 功能展示 (750-1050 frames = 25-35s) */}
      <FeatureShowcase startFrame={750} endFrame={1050} />

      {/* Scene 4: CTA (1050-1200 frames = 35-40s) */}
      <CTAScene startFrame={1050} endFrame={1200} />
    </div>
  );
};
