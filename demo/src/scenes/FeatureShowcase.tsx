import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

interface Props {
  startFrame: number;
  endFrame: number;
}

export const FeatureShowcase: React.FC<Props> = ({ startFrame, endFrame }) => {
  const frame = useCurrentFrame();
  const relativeFrame = frame - startFrame;

  if (frame < startFrame || frame > endFrame) return null;

  // 三个特性依次出现
  const feature1Opacity = interpolate(relativeFrame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  const feature2Opacity = interpolate(relativeFrame, [60, 90], [0, 1], { extrapolateRight: 'clamp' });
  const feature3Opacity = interpolate(relativeFrame, [120, 150], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a' }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        padding: '80px',
      }}>
        <h2 style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '56px',
          color: '#ffffff',
          marginBottom: '80px',
          textShadow: '0 4px 12px rgba(0,0,0,0.5)',
          WebkitFontSmoothing: 'antialiased',
        }}>
          为什么选择 MindOS
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '60px',
          width: '100%',
          maxWidth: '1400px',
        }}>
          {/* Feature 1: 统一上下文 */}
          <div style={{ opacity: feature1Opacity }}>
            <div style={{
              fontSize: '64px',
              marginBottom: '20px',
              textAlign: 'center',
            }}>
              🔗
            </div>
            <h3 style={{
              fontFamily: 'IBM Plex Sans, sans-serif',
              fontSize: '28px',
              color: '#c8873a',
              marginBottom: '15px',
              textAlign: 'center',
              textShadow: '0 2px 8px rgba(200, 135, 58, 0.4)',
              WebkitFontSmoothing: 'antialiased',
            }}>
              告别重复输入
            </h3>
            <p style={{
              fontSize: '18px',
              color: '#aaa',
              lineHeight: '1.8',
              textAlign: 'center',
              textShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}>
              一次写入，所有 AI 共享
              <br />
              Claude、ChatGPT、Cursor 通用
            </p>
          </div>

          {/* Feature 2: 自动归档 */}
          <div style={{ opacity: feature2Opacity }}>
            <div style={{
              fontSize: '64px',
              marginBottom: '20px',
              textAlign: 'center',
            }}>
              💾
            </div>
            <h3 style={{
              fontFamily: 'IBM Plex Sans, sans-serif',
              fontSize: '28px',
              color: '#c8873a',
              marginBottom: '15px',
              textAlign: 'center',
              textShadow: '0 2px 8px rgba(200, 135, 58, 0.4)',
              WebkitFontSmoothing: 'antialiased',
            }}>
              知识永不丢失
            </h3>
            <p style={{
              fontSize: '18px',
              color: '#aaa',
              lineHeight: '1.8',
              textAlign: 'center',
              textShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}>
              AI 对话自动沉淀
              <br />
              本地存储，完全掌控
            </p>
          </div>

          {/* Feature 3: 快速检索 */}
          <div style={{ opacity: feature3Opacity }}>
            <div style={{
              fontSize: '64px',
              marginBottom: '20px',
              textAlign: 'center',
            }}>
              ⚡
            </div>
            <h3 style={{
              fontFamily: 'IBM Plex Sans, sans-serif',
              fontSize: '28px',
              color: '#c8873a',
              marginBottom: '15px',
              textAlign: 'center',
              textShadow: '0 2px 8px rgba(200, 135, 58, 0.4)',
              WebkitFontSmoothing: 'antialiased',
            }}>
              秒级找到答案
            </h3>
            <p style={{
              fontSize: '18px',
              color: '#aaa',
              lineHeight: '1.8',
              textAlign: 'center',
              textShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}>
              ⌘K 全局搜索
              <br />
              瞬间定位任何笔记和对话
            </p>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
