import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

interface Props {
  startFrame: number;
  endFrame: number;
}

export const ProblemScene: React.FC<Props> = ({ startFrame, endFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const relativeFrame = frame - startFrame;

  if (frame < startFrame || frame > endFrame) return null;

  // 标题淡入
  const titleOpacity = interpolate(
    relativeFrame,
    [0, 30],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );

  // 窗口切换动画（放慢节奏）
  const switchSpeed = interpolate(
    relativeFrame,
    [30, 120],
    [0, 4],
    { extrapolateRight: 'clamp' }
  );

  // 当前激活的窗口（平滑切换）
  const activeWindow = Math.floor(switchSpeed) % 3;

  // 复制粘贴动作淡入淡出（更平滑）
  const copyPasteFlash = interpolate(
    Math.sin(relativeFrame * 0.15),
    [-1, 1],
    [0.5, 1],
    { extrapolateRight: 'clamp' }
  );

  // 统计数字动画
  const statsOpacity = interpolate(
    relativeFrame,
    [90, 120],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );

  const count = Math.floor(interpolate(
    relativeFrame,
    [90, 120],
    [0, 50],
    { extrapolateRight: 'clamp' }
  ));

  return (
    <AbsoluteFill style={{
      background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        padding: '80px',
      }}>
        {/* 标题 */}
        <h1 style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '72px',
          color: '#ffffff',
          marginBottom: '20px',
          textAlign: 'center',
          textShadow: '0 4px 12px rgba(0,0,0,0.5)',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          opacity: titleOpacity,
        }}>
          每天在 AI 工具间疲于奔命？
        </h1>

        {/* 统计数字 */}
        <div style={{
          opacity: statsOpacity,
          marginBottom: '60px',
        }}>
          <p style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '48px',
            color: '#c8873a',
            textAlign: 'center',
            textShadow: '0 4px 16px rgba(200, 135, 58, 0.6)',
          }}>
            {count}+ 次切换 / 天
          </p>
        </div>

        {/* 模拟多个 AI 窗口 - 快速切换效果 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '40px',
          width: '100%',
          maxWidth: '1400px',
          position: 'relative',
        }}>
          {['Claude', 'ChatGPT', 'Cursor'].map((name, i) => {
            const isActive = i === activeWindow;
            const scale = isActive ? 1.05 : 0.95;
            const brightness = isActive ? 1.2 : 0.6;

            return (
              <div
                key={name}
                style={{
                  background: isActive
                    ? 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)'
                    : 'linear-gradient(135deg, #1a1a1a 0%, #0f0f0f 100%)',
                  border: isActive ? '3px solid #c8873a' : '2px solid #333',
                  borderRadius: '12px',
                  padding: '30px',
                  transform: `scale(${scale})`,
                  transition: 'all 0.2s ease',
                  boxShadow: isActive
                    ? '0 12px 40px rgba(200, 135, 58, 0.4)'
                    : '0 8px 24px rgba(0,0,0,0.4)',
                  filter: `brightness(${brightness})`,
                }}
              >
                <div style={{
                  fontSize: '24px',
                  color: isActive ? '#c8873a' : '#666',
                  marginBottom: '20px',
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  fontWeight: 'bold',
                }}>
                  {name}
                </div>
                <div style={{
                  fontSize: '16px',
                  color: isActive ? '#aaa' : '#555',
                  lineHeight: '1.6',
                }}>
                  {isActive ? (
                    <>
                      <span style={{
                        color: '#c8873a',
                        opacity: copyPasteFlash,
                        fontWeight: 'bold',
                      }}>
                        ⌘C 复制上下文...
                      </span>
                      <br />
                      <span style={{
                        color: '#c8873a',
                        opacity: copyPasteFlash,
                        fontWeight: 'bold',
                      }}>
                        ⌘V 粘贴到这里...
                      </span>
                    </>
                  ) : (
                    <>
                      等待输入...
                      <br />
                      上下文缺失...
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部文字 */}
        <p style={{
          marginTop: '60px',
          fontSize: '36px',
          color: '#c8873a',
          fontFamily: 'IBM Plex Sans, sans-serif',
          textAlign: 'center',
          textShadow: '0 2px 8px rgba(200, 135, 58, 0.4)',
          WebkitFontSmoothing: 'antialiased',
          opacity: statsOpacity,
        }}>
          重复输入、上下文丢失、效率低下
        </p>
      </div>
    </AbsoluteFill>
  );
};
