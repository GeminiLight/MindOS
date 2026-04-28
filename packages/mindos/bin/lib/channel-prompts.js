/**
 * Channel Prompts - Interactive User Input
 * Handles: hidden inputs, confirmations, retries
 */

import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

let rl = createPromptInterface();

function createPromptInterface() {
  return readline.createInterface({ input, output, terminal: true });
}

export async function promptHidden(question, options = {}) {
  const { maskInput = true } = options;
  if (!maskInput || !input.isTTY || typeof input.setRawMode !== 'function') {
    return new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer));
    });
  }

  return new Promise((resolve, reject) => {
    output.write(question);
    readline.emitKeypressEvents(input, rl);
    input.setRawMode(true);
    input.resume();

    let value = '';

    const cleanup = () => {
      input.removeListener('keypress', onKeypress);
      input.setRawMode(false);
      output.write('\n');
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Aborted by user'));
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(value);
        return;
      }

      if (key.name === 'backspace') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          output.write('\b \b');
        }
        return;
      }

      if (!key.ctrl && !key.meta && str) {
        value += str;
        output.write('*');
      }
    };

    input.on('keypress', onKeypress);
  });
}

export async function promptConfirm(question, defaultValue = false) {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} (Y/n): ` : `${question} (y/N): `;
    rl.question(prompt, (answer) => {
      const normalized = answer.toLowerCase().trim();
      if (defaultValue) {
        resolve(normalized !== 'n');
      } else {
        resolve(normalized === 'y');
      }
    });
  });
}

export async function promptChoice(question, options) {
  return new Promise((resolve) => {
    console.log(question);
    options.forEach((opt, i) => {
      console.log(`  [${i + 1}] ${opt}`);
    });
    rl.question(`Choose (1-${options.length}): `, (answer) => {
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx]);
      } else {
        resolve(null);
      }
    });
  });
}

export function closePrompts() {
  if (rl.closed) {
    rl = createPromptInterface();
    return;
  }
  rl.close();
  rl = createPromptInterface();
}
