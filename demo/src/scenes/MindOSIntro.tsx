import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

interface Props {
  startFrame: number;
  endFrame: number;
}

export const MindOSIntro: React.FC<Props> = ({ startFrame, endFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const relativeFrame = frame - startFrame;

  if (frame < startFrame || frame > endFrame) return null;

  // Logo 缩放动画
  const logoScale = spring({
    frame: relativeFrame,
    fps,
    config: {
      damping: 100,
    },
  });

  // Logo 淡出，让位给核心理念
  const logoOpacity = interpolate(
    relativeFrame,
    [0, 60, 180, 210],
    [0, 1, 1, 0],
    { extrapolateRight: 'clamp' }
  );

  // 核心理念标题出现
  const titleOpacity = interpolate(
    relativeFrame,
    [210, 240],
    [0, 1],
    { extrapolateRight: 'clamp' }
  );

  // 三个理念依次出现，每个理念展示更长时间
  const principle1Opacity = interpolate(relativeFrame, [270, 300], [0, 1], { extrapolateRight: 'clamp' });
  const principle2Opacity = interpolate(relativeFrame, [400, 430], [0, 1], { extrapolateRight: 'clamp' });
  const principle3Opacity = interpolate(relativeFrame, [530, 560], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a' }}>
      {/* 第一部分：Logo + 副标题 (0-210 frames) */}
      {logoOpacity > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          opacity: logoOpacity,
        }}>
          <div style={{
            transform: `scale(${logoScale})`,
          }}>
            <h1 style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: '96px',
              color: '#c8873a',
              margin: 0,
              textShadow: '0 4px 16px rgba(200, 135, 58, 0.6)',
            }}>
              MindOS
            </h1>
            <p style={{
              fontFamily: 'Lora, serif',
              fontSize: '32px',
              color: '#aaa',
              textAlign: 'center',
              marginTop: '30px',
              textShadow: '0 2px 8px rgba(0,0,0,0.4)',
              WebkitFontSmoothing: 'antialiased',
            }}>
              连接你与所有 AI 的知识中枢
            </p>
          </div>
        </div>
      )}

      {/* 第二部分：核心理念 (210-600 frames) */}
      {titleOpacity > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          padding: '60px 100px',
        }}>
          {/* 标题 */}
          <h2 style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '48px',
            color: '#c8873a',
            marginBottom: '60px',
            textShadow: '0 4px 12px rgba(200, 135, 58, 0.6)',
            opacity: titleOpacity,
          }}>
            MindOS 核心理念
          </h2>

          {/* 三个核心理念 */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '40px',
            width: '100%',
            maxWidth: '1400px',
          }}>
            {/* 理念 1 */}
            <div style={{
              opacity: principle1Opacity,
              background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.8) 0%, rgba(15, 15, 15, 0.8) 100%)',
              border: '2px solid #c8873a',
              borderRadius: '16px',
              padding: '35px 50px',
              boxShadow: '0 8px 32px rgba(200, 135, 58, 0.3)',
              backdropFilter: 'blur(10px)',
            }}>
              <div style={{
                display: 'flex',
                gap: '35px',
              }}>
                <div style={{
                  fontSize: '56px',
                  minWidth: '70px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  paddingTop: '5px',
                }}>
                  🔗
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{
                    fontFamily: 'IBM Plex Sans, sans-serif',
                    fontSize: '32px',
                    color: '#ffffff',
                    marginBottom: '18px',
                    textShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    WebkitFontSmoothing: 'antialiased',
                  }}>
                    全局同步 — 打破记忆割裂
                  </h3>
                  <p style={{
                    fontFamily: 'Lora, serif',
                    fontSize: '20px',
                    color: '#999',
                    lineHeight: '1.7',
                    marginBottom: '12px',
                  }}>
                    痛点：切换工具导致上下文割裂，知识无法跨 Agent 复用
                  </p>
                  <p style={{
                    fontFamily: 'Lora, serif',
                    fontSize: '22px',
                    color: '#c8873a',
                    lineHeight: '1.7',
                    margin: 0,
                  }}>
                    跃迁：内置 MCP Server，所有 Agent 零配置直连核心知识库
                  </p>
                </div>
              </div>
            </div>

            {/* 理念 2 */}
            <div style={{
              opacity: principle2Opacity,
              background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.8) 0%, rgba(15, 15, 15, 0.8) 100%)',
              border: '2px solid #c8873a',
              borderRadius: '16px',
              padding: '35px 50px',
              boxShadow: '0 8px 32px rgba(200, 135, 58, 0.3)',
              backdropFilter: 'blur(10px)',
            }}>
              <div style={{
                display: 'flex',
                gap: '35px',
              }}>
                <div style={{
                  fontSize: '56px',
                  minWidth: '70px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  paddingTop: '5px',
                }}>
                  🔍
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{
                    fontFamily: 'IBM Plex Sans, sans-serif',
                    fontSize: '32px',
                    color: '#ffffff',
                    marginBottom: '18px',
                    textShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    WebkitFontSmoothing: 'antialiased',
                  }}>
                    透明可控 — 消除记忆黑箱
                  </h3>
                  <p style={{
                    fontFamily: 'Lora, serif',
                    fontSize: '20px',
                    color: '#999',
                    lineHeight: '1.7',
                    marginBottom: '12px',
                  }}>
                    痛点：Agent 记忆锁在黑箱中，推理无法审查，错误极难追溯纠正
                  </p>
                  <p style={{
                    fontFamily: 'Lora, serif',
                    fontSize: '22px',
                    color: '#c8873a',
                    lineHeight: '1.7',
                    margin: 0,
                  }}>
                    跃迁：检索与执行均沉淀为本地纯文本，提供完整的审查干预界面
                  </p>
                </div>
              </div>
            </div>

            {/* 理念 3 */}
            <div style={{
              opacity: principle3Opacity,
              background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.8) 0%, rgba(15, 15, 15, 0.8) 100%)',
              border: '2px solid #c8873a',
              borderRadius: '16px',
              padding: '35px 50px',
              boxShadow: '0 8px 32px rgba(200, 135, 58, 0.3)',
              backdropFilter: 'blur(10px)',
            }}>
              <div style={{
                display: 'flex',
                gap: '35px',
              }}>
                <div style={{
                  fontSize: '56px',
                  minWidth: '70px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  paddingTop: '5px',
                }}>
                  🔄
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{
                    fontFamily: 'IBM Plex Sans, sans-serif',
                    fontSize: '32px',
                    color: '#ffffff',
                    marginBottom: '18px',
                    textShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    WebkitFontSmoothing: 'antialiased',
                  }}>
                    共生演进 — 经验回流为指令
                  </h3>
                  <p style={{
                    fontFamily: 'Lora, serif',
                    fontSize: '20px',
                    color: '#999',
                    lineHeight: '1.7',
                    marginBottom: '12px',
                  }}>
                    痛点：反复表达偏好，新对话又从零开始，思考未成 AI 能力
                  </p>
                  <p style={{
                    fontFamily: 'Lora, serif',
                    fontSize: '22px',
                    color: '#c8873a',
                    lineHeight: '1.7',
                    margin: 0,
                  }}>
                    跃迁：思考自动沉淀为知识库，下次应对更默契，拒绝重复犯错
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
