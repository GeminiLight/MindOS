import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

interface Props {
  startFrame: number;
  endFrame: number;
}

export const CTAScene: React.FC<Props> = ({ startFrame, endFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const relativeFrame = frame - startFrame;

  if (frame < startFrame || frame > endFrame) return null;

  // 弹跳动画
  const scale = spring({
    frame: relativeFrame,
    fps,
    config: {
      damping: 100,
    },
  });

  // 文字淡入
  const textOpacity = interpolate(
    relativeFrame,
    [30, 60],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a' }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
      }}>
        {/* Logo */}
        <div style={{
          transform: `scale(${scale})`,
          marginBottom: '60px',
        }}>
          <h1 style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '120px',
            color: '#c8873a',
            margin: 0,
          }}>
            MindOS
          </h1>
        </div>

        {/* CTA 文字 */}
        <div style={{ opacity: textOpacity }}>
          <p style={{
            fontFamily: 'IBM Plex Sans, sans-serif',
            fontSize: '36px',
            color: '#ffffff',
            marginBottom: '40px',
            textAlign: 'center',
            textShadow: '0 4px 12px rgba(0,0,0,0.5)',
            WebkitFontSmoothing: 'antialiased',
          }}>
            立即开始，免费使用
          </p>

          <div style={{
            display: 'flex',
            gap: '40px',
            justifyContent: 'center',
          }}>
            {/* npm install */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(15, 15, 15, 0.95) 100%)',
              border: '2px solid #c8873a',
              borderRadius: '12px',
              padding: '20px 40px',
              boxShadow: '0 8px 32px rgba(200, 135, 58, 0.4)',
            }}>
              <code style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: '24px',
                color: '#c8873a',
              }}>
                npm install -g @geminilight/mindos
              </code>
            </div>
          </div>

          {/* GitHub */}
          <p style={{
            fontFamily: 'IBM Plex Sans, sans-serif',
            fontSize: '28px',
            color: '#888',
            marginTop: '60px',
            textAlign: 'center',
            textShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}>
            ⭐ Star on GitHub: github.com/GeminiLight/MindOS
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
};
