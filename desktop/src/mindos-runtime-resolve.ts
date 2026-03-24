/**
 * Orchestrates MindOS root resolution for Desktop local mode.
 * Spec: wiki/specs/spec-desktop-bundled-mindos.md
 */
import { existsSync } from 'fs';
import { getMindosInstallPath } from './node-detect';
import { analyzeMindOsLayout } from './mindos-runtime-layout';
import { pickMindOsRuntime, type MindOsRuntimePickResult, type MindOsRuntimePolicy } from './mindos-runtime-pick';
import { getDefaultBundledMindOsDirectory } from './mindos-runtime-path';

function parseRuntimePolicy(raw: unknown): MindOsRuntimePolicy {
  if (raw === 'bundled-only' || raw === 'user-only' || raw === 'prefer-newer') return raw;
  return 'prefer-newer';
}

export interface ResolveMindOsOk {
  ok: true;
  projectRoot: string | null;
  pick: MindOsRuntimePickResult;
  /** When true and projectRoot is null, run legacy installMindosWithPrivateNode path */
  needsInstallFallback: boolean;
  /** Result of first global install probe (avoid duplicate npm fs work) */
  userCandidatePath: string | null;
}

export interface ResolveMindOsErr {
  ok: false;
  messageEn: string;
  messageZh: string;
}

export async function resolveLocalMindOsProjectRoot(
  config: Record<string, unknown>,
  nodePath: string,
): Promise<ResolveMindOsOk | ResolveMindOsErr> {
  const policy = parseRuntimePolicy(config.mindosRuntimePolicy);
  const strictCompat = config.mindosRuntimeStrictCompat === true;
  const minUser =
    typeof config.minMindOsVersion === 'string' && config.minMindOsVersion.trim()
      ? config.minMindOsVersion.trim()
      : null;
  const maxTested =
    typeof config.maxTestedMindOsVersion === 'string' && config.maxTestedMindOsVersion.trim()
      ? config.maxTestedMindOsVersion.trim()
      : null;

  const envEx = process.env.MINDOS_RUNTIME_ROOT?.trim();
  const cfgEx =
    typeof config.mindosRuntimeRoot === 'string' && config.mindosRuntimeRoot.trim()
      ? config.mindosRuntimeRoot.trim()
      : '';
  const explicitPath = envEx || cfgEx;

  let overrideRoot: string | null = null;
  let overrideVersion: string | null = null;

  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      return {
        ok: false,
        messageEn: `MindOS runtime path does not exist: ${explicitPath}`,
        messageZh: `MindOS 运行目录不存在：${explicitPath}`,
      };
    }
    const ex = analyzeMindOsLayout(explicitPath);
    if (!ex.runnable) {
      return {
        ok: false,
        messageEn:
          `MindOS runtime at ${explicitPath} is incomplete (need app/.next and mcp/). Check mindosRuntimeRoot / MINDOS_RUNTIME_ROOT.`,
        messageZh: `运行目录不完整（需要 app/.next 与 mcp/）：${explicitPath}`,
      };
    }
    overrideRoot = explicitPath;
    overrideVersion = ex.version;
  }

  const bundledDir = getDefaultBundledMindOsDirectory();
  const bundledExists = !!bundledDir && existsSync(bundledDir);
  const bundledAnalysis = bundledExists && bundledDir ? analyzeMindOsLayout(bundledDir) : { version: null, runnable: false };

  const userCandidatePath = await getMindosInstallPath(nodePath);
  const userAnalysis = userCandidatePath ? analyzeMindOsLayout(userCandidatePath) : { version: null, runnable: false };

  const pick = pickMindOsRuntime({
    policy,
    overrideRoot,
    overrideVersion,
    bundledRoot: bundledExists && bundledDir ? bundledDir : null,
    bundledVersion: bundledAnalysis.version,
    bundledRunnable: bundledAnalysis.runnable,
    userRoot: userCandidatePath,
    userVersion: userAnalysis.version,
    userRunnable: userAnalysis.runnable,
    minUserVersion: minUser,
    maxTestedUserVersion: maxTested,
    strictCompat,
  });

  if (policy === 'bundled-only' && !pick.projectRoot) {
    return {
      ok: false,
      messageEn: 'Bundled MindOS runtime is missing or incomplete. Reinstall the Desktop app or set MINDOS_DEV_BUNDLED_ROOT for development.',
      messageZh: '内置 MindOS 不完整或缺失。请重装桌面端，或在开发时设置 MINDOS_DEV_BUNDLED_ROOT。',
    };
  }

  if (policy === 'user-only' && !pick.projectRoot) {
    return {
      ok: false,
      messageEn:
        'user-only policy: no runnable global @geminilight/mindos (install and build, or fix minMindOsVersion / strictCompat).',
      messageZh:
        '已设为仅使用全局安装：当前没有可运行的 @geminilight/mindos（请安装并完成构建，或检查 minMindOsVersion / strictCompat）。',
    };
  }

  const needsInstallFallback = policy === 'prefer-newer' && !pick.projectRoot;

  return {
    ok: true,
    projectRoot: pick.projectRoot,
    pick,
    needsInstallFallback,
    userCandidatePath,
  };
}
