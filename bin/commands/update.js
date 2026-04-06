/**
 * mindos update — npm install latest, sync skills, rebuild, restart daemon or foreground instance.
 *
 * Heavy dependencies are loaded on demand to keep CLI cold start fast.
 */

import { execSync, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ROOT, BUILD_STAMP, CONFIG_PATH, LOG_PATH } from '../lib/constants.js';
import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { execInherited } from '../lib/shell.js';
import { EXIT } from '../lib/command.js';
import { stopMindos } from '../lib/stop.js';
import { getLocalIP } from '../lib/startup.js';
import { isPortInUse } from '../lib/port.js';
import { cleanEnvForRestart } from '../lib/clean-env.js';
import { stripBom } from '../lib/jsonc.js';

/**
 * Dynamically resolve the new ROOT after `npm install -g`.
 * This is needed because constants are evaluated at module load time.
 */
function getUpdatedRoot() {
  try {
    const whichCmd = process.platform === 'win32' ? 'where mindos' : 'which mindos';
    const mindosBin = execSync(whichCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    if (mindosBin) {
      let cliPath;
      try { cliPath = realpathSync(mindosBin); } catch { cliPath = mindosBin; }
      if (cliPath) {
        return resolve(dirname(cliPath), '..');
      }
    }
  } catch {}
  return ROOT;
}

/**
 * Build the app in the given root if the build stamp doesn't match the package version.
 * Used by `mindos update` to pre-build before restarting the daemon.
 * @param {string} newRoot
 */
function buildIfNeeded(newRoot) {
  // Check for prebuilt standalone first (npm package ships with it)
  const standaloneServer = resolve(newRoot, '_standalone', 'server.js');
  const standaloneStamp = resolve(newRoot, '_standalone', '.mindos-build-version');
  if (existsSync(standaloneServer)) {
    try {
      const builtVersion = readFileSync(standaloneStamp, 'utf-8').trim();
      const pkgVersion = JSON.parse(readFileSync(resolve(newRoot, 'package.json'), 'utf-8')).version;
      if (builtVersion === pkgVersion) return; // prebuilt standalone matches, no build needed
    } catch { /* fall through to legacy build */ }
  }

  const newBuildStamp = resolve(newRoot, 'app', '.next', '.mindos-build-version');
  const newNextBin = resolve(newRoot, 'app', 'node_modules', '.bin', 'next');

  let needBuild = true;
  try {
    const builtVersion = readFileSync(newBuildStamp, 'utf-8').trim();
    const pkgVersion = JSON.parse(readFileSync(resolve(newRoot, 'package.json'), 'utf-8')).version;
    needBuild = builtVersion !== pkgVersion;
  } catch {
    needBuild = true;
  }

  if (!needBuild) return;

  console.log(yellow('\n  Building MindOS (version change detected)...\n'));
  const appPkg = resolve(newRoot, 'app', 'package.json');
  if (existsSync(appPkg)) {
    execInherited('npm install', resolve(newRoot, 'app'));
  }
  const nextDir = resolve(newRoot, 'app', '.next');
  if (existsSync(nextDir)) {
    rmSync(nextDir, { recursive: true, force: true });
  }
  execInherited('node scripts/gen-renderer-index.js', newRoot);
  execInherited(`${newNextBin} build`, resolve(newRoot, 'app'));
  const version = JSON.parse(readFileSync(resolve(newRoot, 'package.json'), 'utf-8')).version;
  writeFileSync(newBuildStamp, version, 'utf-8');
}

export const meta = {
  name: 'update',
  group: 'Config',
  summary: 'Update to latest version',
  usage: 'mindos update',
};

export const run = async () => {
  const { writeUpdateStatus, writeUpdateFailed } = await import('../lib/update-status.js');
  const currentVersion = (() => {
    try { return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')).version; } catch { return '?'; }
  })();
  console.log(`\n${bold('⬆  Updating MindOS...')}  ${dim(`(current: ${currentVersion})`)}\n`);

  // Stage 1: Download
  writeUpdateStatus('downloading', { fromVersion: currentVersion });
  try {
    execSync('npm install -g @geminilight/mindos@latest', { stdio: 'inherit' });
  } catch {
    writeUpdateFailed('downloading', 'npm install failed', { fromVersion: currentVersion });
    console.error(red('Update failed. Try: npm install -g @geminilight/mindos@latest'));
    process.exit(EXIT.ERROR);
  }
  if (existsSync(BUILD_STAMP)) rmSync(BUILD_STAMP);

  // Resolve the new installation path (after npm install -g, ROOT is stale)
  const updatedRoot = getUpdatedRoot();
  const newVersion = (() => {
    try { return JSON.parse(readFileSync(resolve(updatedRoot, 'package.json'), 'utf-8')).version; } catch { return '?'; }
  })();
  const vOpts = { fromVersion: currentVersion, toVersion: newVersion };

  // Stage 2: Skills
  writeUpdateStatus('skills', vOpts);
  try {
    const { checkSkillVersions, updateSkill } = await import('../lib/skill-check.js');
    const mismatches = checkSkillVersions(updatedRoot);
    for (const m of mismatches) {
      updateSkill(m.bundledPath, m.installPath);
      console.log(`  ${green('✓')} ${dim(`Skill ${m.name}: v${m.installed} → v${m.bundled}`)}`);
    }
  } catch { /* best-effort */ }

  if (newVersion !== currentVersion) {
    console.log(`\n${green(`✔ Updated ${currentVersion} → ${newVersion}`)}`);
  } else {
    console.log(`\n${green('✔ Already on the latest version')} ${dim(`(${currentVersion})`)}\n`);
    return;
  }

  const gateway = await import('../lib/gateway.js');
  const updatePlatform = await gateway.getPlatform();
  let daemonRunning = false;
  if (updatePlatform === 'systemd') {
    try { execSync('systemctl --user is-active mindos', { stdio: 'pipe' }); daemonRunning = true; } catch {}
  } else if (updatePlatform === 'launchd') {
    try {
      const uid = execSync('id -u').toString().trim();
      execSync(`launchctl print gui/${uid}/com.mindos.app`, { stdio: 'pipe' });
      daemonRunning = true;
    } catch {}
  }

  if (daemonRunning) {
    console.log(cyan('\n  Daemon is running — stopping to apply the new version...'));
    await gateway.runGatewayCommand('stop');

    // Stage 3: Rebuild
    writeUpdateStatus('rebuilding', vOpts);
    let daemonBuildFailed = '';
    try {
      buildIfNeeded(updatedRoot);
    } catch (err) {
      daemonBuildFailed = err instanceof Error ? err.message : String(err);
      console.error(yellow(`\n  Pre-build failed: ${daemonBuildFailed}`));
      console.error(yellow('  Daemon will attempt to rebuild on startup...\n'));
    }

    // Stage 4: Restart — always attempt, even if pre-build failed
    // (daemon has auto-restart; `mindos start` retries the build)
    writeUpdateStatus('restarting', vOpts);
    await gateway.runGatewayCommand('install');
    const updateConfig = (() => {
      try { return JSON.parse(stripBom(readFileSync(CONFIG_PATH, 'utf-8'))); } catch { return {}; }
    })();
    const webPort = updateConfig.port ?? 3456;
    const mcpPort = updateConfig.mcpPort ?? 8781;
    console.log(dim('  (Waiting for Web UI to come back up — first run after update includes a rebuild...)'));
    const ready = await gateway.waitForHttp(Number(webPort), { retries: 450, intervalMs: 2000, label: 'Web UI', logFile: LOG_PATH, expectedVersion: newVersion });
    if (ready) {
      const localIP = getLocalIP();
      console.log(`\n${'─'.repeat(53)}`);
      console.log(`${green('✔')} ${bold(`MindOS updated: ${currentVersion} → ${newVersion}`)}\n`);
      console.log(`  ${green('●')} Web UI   ${cyan(`http://localhost:${webPort}`)}`);
      if (localIP) console.log(`             ${cyan(`http://${localIP}:${webPort}`)}`);
      console.log(`  ${green('●')} MCP      ${cyan(`http://localhost:${mcpPort}/mcp`)}`);
      console.log(`\n  ${dim('View changelog:')}  ${cyan('https://github.com/GeminiLight/MindOS/releases')}`);
      console.log(`${'─'.repeat(53)}\n`);
      writeUpdateStatus('done', vOpts);
    } else {
      const failMsg = daemonBuildFailed
        ? `Build failed (${daemonBuildFailed}), server did not come back up`
        : 'Server did not come back up in time';
      writeUpdateFailed('restarting', failMsg, vOpts);
      console.error(red(`✘ ${failMsg}. Check logs: mindos logs\n`));
      process.exit(EXIT.ERROR);
    }
  } else {
    // Non-daemon mode: check if a MindOS instance is currently running
    // (e.g. user started via `mindos start`, or GUI triggered this update).
    // If so, stop it and restart from the NEW installation path.
    const updateConfig = (() => {
      try { return JSON.parse(stripBom(readFileSync(CONFIG_PATH, 'utf-8'))); } catch { return {}; }
    })();
    const webPort = Number(updateConfig.port ?? 3456);
    const mcpPort = Number(updateConfig.mcpPort ?? 8781);

    const wasRunning = await isPortInUse(webPort) || await isPortInUse(mcpPort);

    if (wasRunning) {
      console.log(cyan('\n  MindOS is running — restarting to apply the new version...'));
      stopMindos();
      // Wait for ports to free (up to 20s) with stabilization check.
      // After first "free" reading, wait 1s and check again to avoid
      // false negatives from TCP TIME_WAIT flickering.
      const deadline = Date.now() + 20_000;
      let portsFree = false;
      while (Date.now() < deadline) {
        const busy = await isPortInUse(webPort) || await isPortInUse(mcpPort);
        if (!busy) {
          // Stabilization: wait 1s, then double-check
          await new Promise((r) => setTimeout(r, 1000));
          const stillFree = !(await isPortInUse(webPort)) && !(await isPortInUse(mcpPort));
          if (stillFree) { portsFree = true; break; }
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!portsFree) {
        console.log(yellow('  ⚠ Ports not fully released, force-killing remaining processes...'));
        // Last resort: import killByPort and SIGKILL anything on these ports
        const stopLib = await import('../lib/stop.js');
        stopLib.killByPort(webPort);
        stopLib.killByPort(mcpPort);
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Stage 3: Rebuild
      writeUpdateStatus('rebuilding', vOpts);
      let buildFailed = '';
      try {
        buildIfNeeded(updatedRoot);
      } catch (err) {
        buildFailed = err instanceof Error ? err.message : String(err);
        console.error(yellow(`\n  Pre-build failed: ${buildFailed}`));
        console.error(yellow('  Starting server anyway (it will retry the build)...\n'));
      }

      // Stage 4: Restart — always attempt, even if pre-build failed
      // (`mindos start` has its own build-on-startup logic)
      writeUpdateStatus('restarting', vOpts);
      const newCliPath = resolve(updatedRoot, 'bin', 'cli.js');
      const childEnv = cleanEnvForRestart();
      const child = nodeSpawn(
        process.execPath, [newCliPath, 'start'],
        { detached: true, stdio: 'ignore', env: childEnv },
      );
      child.unref();

      console.log(dim('  (Waiting for Web UI to come back up...)'));
      const ready = await gateway.waitForHttp(webPort, { retries: 180, intervalMs: 2000, label: 'Web UI', logFile: LOG_PATH, expectedVersion: newVersion });
      if (ready) {
        const localIP = getLocalIP();
        console.log(`\n${'─'.repeat(53)}`);
        console.log(`${green('✔')} ${bold(`MindOS updated: ${currentVersion} → ${newVersion}`)}\n`);
        console.log(`  ${green('●')} Web UI   ${cyan(`http://localhost:${webPort}`)}`);
        if (localIP) console.log(`             ${cyan(`http://${localIP}:${webPort}`)}`);
        console.log(`  ${green('●')} MCP      ${cyan(`http://localhost:${mcpPort}/mcp`)}`);
        console.log(`\n  ${dim('View changelog:')}  ${cyan('https://github.com/GeminiLight/MindOS/releases')}`);
        console.log(`${'─'.repeat(53)}\n`);
        writeUpdateStatus('done', vOpts);
      } else {
        const failMsg = buildFailed
          ? `Build failed (${buildFailed}), server did not come back up`
          : 'Server did not come back up in time';
        writeUpdateFailed('restarting', failMsg, vOpts);
        console.error(red(`✘ ${failMsg}. Check logs: mindos logs\n`));
        process.exit(EXIT.ERROR);
      }
    } else {
      // No running instance — just build and tell user to start manually
      try {
        buildIfNeeded(updatedRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(yellow(`\n  Pre-build failed: ${msg}`));
        console.error(dim('  The build will be retried when you run `mindos start`.'));
      }
      console.log(`\n${green('✔')} ${bold(`Updated: ${currentVersion} → ${newVersion}`)}`);
      console.log(dim('  Run `mindos start` to start the updated version.'));
      console.log(`  ${dim('View changelog:')}  ${cyan('https://github.com/GeminiLight/MindOS/releases')}\n`);
    }
  }
};
