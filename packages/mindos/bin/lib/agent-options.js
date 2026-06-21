import path from 'node:path';

const NATIVE_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function values(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === false ? [] : [value];
}

function parsePositiveInt(value) {
  const raw = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

function splitAgentArgs(args = []) {
  const taskArgs = [];
  const attachedFiles = [];

  for (const arg of args) {
    if (typeof arg === 'string' && arg.startsWith('@') && arg.length > 1) {
      attachedFiles.push(arg.slice(1));
    } else {
      taskArgs.push(arg);
    }
  }

  return { taskArgs, attachedFiles };
}

function normalizeFlagFiles(flags = {}) {
  const files = [];
  for (const value of values(flags.file)) {
    const file = nonEmptyString(value);
    if (file) files.push(file);
  }
  return files;
}

function normalizeThinking(flags = {}) {
  if (flags['no-thinking'] === true) {
    return { agentOptions: { enableThinking: false } };
  }

  const raw = flags.thinking;
  if (raw === undefined || raw === false) return {};

  if (raw === true) {
    return {
      agentOptions: { enableThinking: true },
      runtimeOptions: { reasoningEffort: 'medium' },
    };
  }

  const value = String(raw).trim().toLowerCase();
  if (!value || value === 'true' || value === 'on' || value === 'yes') {
    return {
      agentOptions: { enableThinking: true },
      runtimeOptions: { reasoningEffort: 'medium' },
    };
  }
  if (value === 'false' || value === 'off' || value === 'no' || value === 'none') {
    return { agentOptions: { enableThinking: false } };
  }

  const budget = parsePositiveInt(value);
  if (budget) {
    return {
      agentOptions: {
        enableThinking: true,
        thinkingBudget: Math.min(50000, Math.max(1000, budget)),
      },
      runtimeOptions: { reasoningEffort: 'medium' },
    };
  }

  if (NATIVE_REASONING_EFFORTS.has(value)) {
    return {
      agentOptions: { enableThinking: true },
      runtimeOptions: { reasoningEffort: value },
    };
  }

  return {
    agentOptions: { enableThinking: true },
    runtimeOptions: { reasoningEffort: 'medium' },
  };
}

function normalizeRuntimeOptions(flags = {}) {
  const runtimeOptions = {};
  const modelOverride = nonEmptyString(flags.model);
  const thinking = normalizeThinking(flags);

  if (modelOverride) runtimeOptions.modelOverride = modelOverride;
  if (thinking.runtimeOptions) Object.assign(runtimeOptions, thinking.runtimeOptions);

  return {
    runtimeOptions: Object.keys(runtimeOptions).length > 0 ? runtimeOptions : undefined,
    agentOptions: thinking.agentOptions,
  };
}

function normalizePermissionMode(flags = {}) {
  if (flags.readonly === true) return 'read';
  if (flags.agent === true) return 'ask';
  return undefined;
}

function normalizeWorkDir(flags = {}) {
  const dir = nonEmptyString(flags.cwd) ?? nonEmptyString(flags.workdir) ?? nonEmptyString(flags['work-dir']);
  if (!dir) return undefined;
  return {
    source: 'manual',
    path: path.resolve(dir),
    label: path.basename(path.resolve(dir)) || path.resolve(dir),
  };
}

export function normalizeAgentInvocation(args = [], flags = {}) {
  const { taskArgs, attachedFiles: atFiles } = splitAgentArgs(args);
  const attachedFiles = [...atFiles, ...normalizeFlagFiles(flags)];
  const maxSteps = parsePositiveInt(flags['max-steps']);
  const providerOverride = nonEmptyString(flags.provider);
  const modelOverride = nonEmptyString(flags.model);
  const { runtimeOptions, agentOptions } = normalizeRuntimeOptions(flags);
  const permissionMode = normalizePermissionMode(flags);
  const workDir = normalizeWorkDir(flags);

  return {
    taskArgs,
    attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
    maxSteps,
    providerOverride,
    modelOverride,
    permissionMode,
    runtimeOptions,
    agentOptions,
    workDir,
  };
}

export async function readStdinIfPiped(input = process.stdin, options = {}) {
  if (!input || input.isTTY) return '';

  const initialIdleMs = parsePositiveInt(options.idleMs ?? process.env.MINDOS_CLI_STDIN_IDLE_MS) ?? 100;
  const dataIdleMs = parsePositiveInt(options.dataIdleMs ?? process.env.MINDOS_CLI_STDIN_DATA_IDLE_MS) ?? 1000;

  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    let idleTimer;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      input.off?.('data', onData);
      input.off?.('end', finish);
      input.off?.('error', finish);
      input.pause?.();
      resolve(Buffer.concat(chunks).toString('utf-8').trim());
    };

    const scheduleIdleFinish = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, chunks.length > 0 ? dataIdleMs : initialIdleMs);
    };

    const onData = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      scheduleIdleFinish();
    };

    input.on?.('data', onData);
    input.once?.('end', finish);
    input.once?.('error', finish);
    input.resume?.();

    if (input.readableEnded) {
      finish();
      return;
    }

    scheduleIdleFinish();
  });
}

export function combineTaskAndStdin(taskArgs = [], stdinText = '') {
  const task = taskArgs.join(' ').trim();
  const input = stdinText.trim();
  if (task && input) return `${task}\n\nInput from stdin:\n${input}`;
  return task || input;
}

export async function prepareAgentInvocation(args = [], flags = {}, options = {}) {
  const invocation = normalizeAgentInvocation(args, flags);
  const stdinText = options.stdinText !== undefined
    ? String(options.stdinText).trim()
    : await readStdinIfPiped(options.stdin ?? process.stdin, options);
  const message = combineTaskAndStdin(invocation.taskArgs, stdinText);

  return {
    ...invocation,
    stdinText,
    message,
    hasMessage: message.length > 0,
  };
}
