/**
 * Orchestrates MindOS root resolution for Desktop local mode.
 * Spec: wiki/specs/spec-desktop-bundled-mindos.md, spec-desktop-core-hot-update.md
 */
import { existsSync } from 'fs';
import path from 'path';
import { getMindosInstallPath } from './node-detect';
import { analyzeMindOsLayout } from './mindos-runtime-layout';
import { pickMindOsRuntime, type MindOsRuntimePickResult, type MindOsRuntimePolicy } from './mindos-runtime-pick';
import { getDefaultBundledMindOsDirectory } from './mindos-runtime-path';
import { getDesktopConfigDir } from './desktop-home';

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
  const policy = parseRuntimePolicy(config.mindosRuntimePolicy ?? process.env.MINDOS_RUNTIME_POLICY);
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
          `MindOS runtime at ${explicitPath} is incomplete (need packages/web/.next and dist/protocols/mcp-server/). Check mindosRuntimeRoot / MINDOS_RUNTIME_ROOT.`,
        messageZh: `运行目录不完整（需要 packages/web/.next 与 dist/protocols/mcp-server/）：${explicitPath}`,
      };
    }
    overrideRoot = explicitPath;
    overrideVersion = ex.version;
  }

  const bundledDir = getDefaultBundledMindOsDirectory();
  const bundledExists = !!bundledDir && existsSync(bundledDir);
  const bundledAnalysis = bundledExists && bundledDir ? analyzeMindOsLayout(bundledDir) : { version: null, runnable: false };

  // Cached runtime: downloaded by Core Hot Update to ~/.mindos/runtime/
  const cachedDir = path.join(getDesktopConfigDir(), 'runtime');
  const cachedExists = existsSync(cachedDir);
  const cachedAnalysis = cachedExists ? analyzeMindOsLayout(cachedDir) : { version: null, runnable: false };

  const userCandidatePath = await getMindosInstallPath(nodePath);
  const userAnalysis = userCandidatePath ? analyzeMindOsLayout(userCandidatePath) : { version: null, runnable: false };

  console.info(
    `[RuntimeResolve] candidates: bundled=${bundledAnalysis.version ?? '—'}(${bundledAnalysis.runnable ? 'ok' : 'bad'}) cached=${cachedAnalysis.version ?? '—'}(${cachedAnalysis.runnable ? 'ok' : 'bad'}) user=${userAnalysis.version ?? '—'}(${userAnalysis.runnable ? 'ok' : 'bad'}) policy=${policy}`,
  );

  const pick = pickMindOsRuntime({
    policy,
    overrideRoot,
    overrideVersion,
    cachedRoot: cachedAnalysis.runnable ? cachedDir : null,
    cachedVersion: cachedAnalysis.version,
    cachedRunnable: cachedAnalysis.runnable,
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
      // Lead with what a user can do; the env var only matters in a source checkout.
      messageEn: 'The built-in MindOS is missing or damaged. Reinstall the MindOS desktop app. (Developing from source? Set MINDOS_DEV_BUNDLED_ROOT.)',
      messageZh: '内置的 MindOS 缺失或已损坏，请重新安装 MindOS 桌面应用。（从源码开发时，可以设置 MINDOS_DEV_BUNDLED_ROOT。）',
    };
  }

  if (policy === 'user-only' && !pick.projectRoot) {
    return {
      ok: false,
      messageEn:
        'MindOS is set to use only a global install, but no runnable @geminilight/mindos was found. Install and build it, or check minMindOsVersion / strictCompat.',
      messageZh:
        '已设置为只使用全局安装的 MindOS，但没有找到可以运行的 @geminilight/mindos。请先安装并构建，或检查 minMindOsVersion / strictCompat 设置。',
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
