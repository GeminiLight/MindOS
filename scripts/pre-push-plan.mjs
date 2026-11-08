export function unique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function isDocLike(file) {
  if (/\.(md|mdx|txt)$/i.test(file)) return true;
  if (/^README(_zh)?\.md$/i.test(file)) return true;
  if (file === 'AGENTS.md' || file === 'CLAUDE.md') return true;
  return file.startsWith('wiki/') || file.startsWith('SOP/') || file.startsWith('docs/');
}

export function isWebTestFile(file) {
  return /^packages\/web\/__tests__\/.*\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file);
}

function isWebTestSupportFile(file) {
  return file.startsWith('packages/web/__tests__/');
}

export function isWebRelatedInput(file) {
  if (!file.startsWith('packages/web/')) return false;
  if (isWebTestFile(file)) return false;
  if (/\.d\.ts$/.test(file)) return false;
  return /\.(ts|tsx|js|jsx)$/.test(file);
}

function isWebTypecheckInput(file) {
  if (!file.startsWith('packages/web/')) return false;
  if (isWebTestSupportFile(file)) return false;
  if (/\.d\.ts$/.test(file)) return false;
  return /\.(ts|tsx|js|jsx|json)$/.test(file);
}

function needsFullWebTest(file) {
  return [
    'packages/web/package.json',
    'packages/web/vitest.config.ts',
    'packages/web/__tests__/setup.ts',
    'packages/web/next.config.ts',
    'packages/web/tsconfig.json',
  ].includes(file);
}

function isRootContractTestFile(file) {
  return /^tests\/[^/]+\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file);
}

function isRootUnitTestFile(file) {
  return /^tests\/unit\/.*\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file);
}

function isRootVitestTestFile(file) {
  return isRootContractTestFile(file) || isRootUnitTestFile(file);
}

function isE2eFile(file) {
  return file.startsWith('tests/e2e/');
}

function isRootTestFileNeedingQuickFallback(file) {
  if (!file.startsWith('tests/')) return false;
  if (isRootVitestTestFile(file)) return false;
  if (isE2eFile(file)) return false;
  if (file.startsWith('tests/integration/')) return false;
  return true;
}

export function addCommand(commands, key, command, args) {
  if (commands.some((entry) => entry.key === key)) return;
  commands.push({ key, command, args });
}

export function buildPrePushCommands(changedFiles) {
  const commands = [];
  const rootSensitive = changedFiles.some((file) => (
    file === 'package.json'
    || file === 'pnpm-lock.yaml'
    || file === 'pnpm-workspace.yaml'
    || file === 'turbo.json'
    || file === 'vitest.config.ts'
    || file.startsWith('scripts/')
    || isRootTestFileNeedingQuickFallback(file)
  ));
  if (rootSensitive) {
    addCommand(commands, 'root:quick', 'pnpm', ['run', 'test:quick']);
  }

  const rootVitestTestFiles = unique(changedFiles.filter(isRootVitestTestFile));
  if (rootVitestTestFiles.length > 0 && !rootSensitive) {
    addCommand(commands, 'root:test-files', 'pnpm', [
      'exec',
      'vitest',
      'run',
      ...rootVitestTestFiles,
      '--passWithNoTests',
    ]);
  }

  if (changedFiles.some(isE2eFile) && !rootSensitive) {
    addCommand(commands, 'root:e2e-list', 'pnpm', [
      'exec',
      'playwright',
      'test',
      '-c',
      'tests/e2e/playwright.config.ts',
      '--list',
    ]);
  }

  const changedMjs = changedFiles.filter((file) => file.startsWith('scripts/') && file.endsWith('.mjs'));
  for (const file of changedMjs) {
    addCommand(commands, `node-check:${file}`, 'node', ['--check', file]);
  }

  const changedShell = changedFiles.filter((file) => (
    file.endsWith('.sh') || file.startsWith('scripts/hooks/')
  ));
  for (const file of changedShell) {
    addCommand(commands, `bash-check:${file}`, 'bash', ['-n', file]);
  }

  const webFiles = changedFiles.filter((file) => file.startsWith('packages/web/'));
  if (webFiles.length > 0) {
    if (webFiles.some(needsFullWebTest)) {
      addCommand(commands, 'web:test', 'pnpm', ['--filter', '@mindos/web', 'test']);
    } else {
      const webTestFiles = unique(webFiles.filter(isWebTestFile).map((file) => file.replace(/^packages\/web\//, '')));
      const webRelatedInputs = unique(webFiles.filter(isWebRelatedInput).map((file) => file.replace(/^packages\/web\//, '')));
      if (webTestFiles.length > 0) {
        addCommand(commands, 'web:test-files', 'pnpm', [
          '--filter',
          '@mindos/web',
          'exec',
          'vitest',
          'run',
          ...webTestFiles,
          '--passWithNoTests',
        ]);
      }
      if (webRelatedInputs.length > 0) {
        addCommand(commands, 'web:related', 'pnpm', [
          '--filter',
          '@mindos/web',
          'exec',
          'vitest',
          'related',
          ...webRelatedInputs,
          '--run',
          '--passWithNoTests',
        ]);
      }
    }

    if (webFiles.some(isWebTypecheckInput)) {
      addCommand(commands, 'web:typecheck', 'pnpm', ['--filter', '@mindos/web', 'typecheck']);
    }
  }

  const packageChecks = [
    { prefix: 'packages/mindos/', filter: '@geminilight/mindos', test: true, typecheck: 'type-check' },
    { prefix: 'packages/mobile/', filter: '@mindos/mobile', test: true, typecheck: 'type-check' },
    { prefix: 'packages/desktop/', filter: '@mindos/desktop', test: true, typecheck: 'type-check' },
    { prefix: 'packages/browser-extension/', filter: '@mindos/browser-extension', test: false, typecheck: 'type-check' },
  ];

  for (const check of packageChecks) {
    if (!changedFiles.some((file) => file.startsWith(check.prefix))) continue;
    if (check.test) {
      addCommand(commands, `${check.filter}:test`, 'pnpm', ['--filter', check.filter, 'test']);
    }
    addCommand(commands, `${check.filter}:typecheck`, 'pnpm', ['--filter', check.filter, check.typecheck]);
  }

  return commands;
}
