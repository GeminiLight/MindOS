import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);

export default {
  // 视频配置
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 900, // 30 秒
};
