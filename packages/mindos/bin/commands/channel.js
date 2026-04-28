/**
 * mindos channel — Manage IM platform configurations
 * 
 * OpenClaw-inspired design:
 * - verb-noun pattern (add, remove, list, verify)
 * - Progressive disclosure (help → subcommand → details)
 * - Platform abstraction layer
 * - Secure credential handling
 */

import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import {
  channelList,
  channelAdd,
  channelRemove,
  channelVerify,
  formatPlatformStatus,
  getPlatformEmoji,
} from '../lib/channel-mgmt.js';
import {
  promptHidden,
  promptConfirm,
  promptChoice,
  closePrompts,
} from '../lib/channel-prompts.js';
import {
  validateFieldFormat,
  getRequiredFields,
  getCredentialSets,
  getFieldHelp,
} from '../lib/channel-validate.js';
import { CHANNEL_PLATFORMS } from '../lib/channel-constants.js';

export const meta = {
  name: 'channel',
  group: 'IM Integration',
  summary: 'Manage IM platform configurations',
  usage: 'mindos channel [command]',
  flags: {
    '--skip-verify': 'Skip remote credential verification and only save/validate format',
    '--env': 'Load credentials from environment variables instead of prompting',
  },
  examples: [
    'mindos channel list',
    'mindos channel add telegram',
    'mindos channel add telegram --skip-verify',
    'mindos channel add telegram --env',
    'mindos channel verify discord',
    'mindos channel remove feishu',
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY
// ────────────────────────────────────────────────────────────────────────────

export const run = async (args, flags) => {
  const sub = args[0];

  try {
    switch (sub) {
      case 'list':
        await handleList(flags);
        break;

      case 'add':
        await handleAdd(args[1], flags);
        break;

      case 'remove':
      case 'rm':
        await handleRemove(args[1], flags);
        break;

      case 'verify':
      case 'test':
        await handleVerify(args[1], flags);
        break;

      case undefined:
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;

      default:
        console.error(red(`Unknown subcommand: ${sub}`));
        console.log();
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(red(`✗ Error: ${msg}`));
    process.exit(1);
  } finally {
    closePrompts();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// SUBCOMMAND HANDLERS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Handler: list
 */
async function handleList(flags) {
  console.log();
  console.log(bold('Configured IM Platforms'));
  console.log();

  const result = await channelList();
  
  if (result.platforms.every((p) => p.status === 'not_configured')) {
    console.log(dim('No IM platforms configured.'));
    console.log();
    console.log('Get started:');
    console.log(`  ${cyan('mindos channel add telegram')}`);
    console.log(`  ${cyan('mindos channel add discord')}`);
    console.log(`  ${cyan('mindos channel add feishu')}`);
    console.log();
    return;
  }

  // Display table
  result.platforms.forEach((platform) => {
    const emoji = getPlatformEmoji(platform.platform);
    const status = formatPlatformStatus(platform.status);
    const name = platform.platform.padEnd(12);

    let statusStr = '';
    if (platform.status === 'configured') {
      statusStr = `${green(status)} configured`;
      if (platform.botName) {
        statusStr += ` (${platform.botName})`;
      }
    } else if (platform.status === 'incomplete') {
      statusStr = `${yellow(status)} incomplete`;
      if (platform.missingFields) {
        statusStr += ` (missing ${platform.missingFields.join(', ')})`;
      }
    } else {
      statusStr = `${dim(status)} not configured`;
    }

    console.log(`  ${emoji} ${cyan(name)} ${statusStr}`);
  });

  console.log();
  console.log(dim(`Run 'mindos channel add <platform>' to configure`));
  console.log();
}

/**
 * Handler: add <platform>
 * @param {string} platform - Platform name
 * @param {Object} flags - CLI flags
 */
async function handleAdd(platform, flags) {
  if (!platform) {
    console.error(red('Usage: mindos channel add <platform>'));
    console.log(dim('  Supported: telegram, discord, feishu, slack, wecom, dingtalk, wechat, qq'));
    process.exit(1);
  }

  if (!CHANNEL_PLATFORMS.includes(platform)) {
    console.error(red(`Unknown platform: ${platform}`));
    console.log(dim(`  Supported: ${CHANNEL_PLATFORMS.join(', ')}`));
    process.exit(1);
  }

  console.log();
  console.log(bold(`Configuring ${platform} platform`));
  console.log();

  // Gather credentials
  /** @type {Record<string, string>} */
  const credentials = {};
  const credentialSets = getCredentialSets(platform);
  let activeFieldSet = getRequiredFields(platform);

  if (credentialSets.length > 1) {
    console.log(dim(`This platform supports multiple credential modes:`));
    credentialSets.forEach((fieldSet, index) => {
      console.log(dim(`  ${index + 1}. ${fieldSet.join(' + ')}`));
    });
    console.log();
  }

  if (flags.env === true) {
    const matchingSet = credentialSets.find((fieldSet) => fieldSet.every((field) => process.env[buildCredentialEnvKey(platform, field)]?.trim()));
    if (!matchingSet) {
      const expected = credentialSets.map((fieldSet) => fieldSet.map((field) => buildCredentialEnvKey(platform, field)).join(' + ')).join('  OR  ');
      console.log(red(`✗ Missing environment variables for ${platform}`));
      console.log(dim(`  Provide one complete set: ${expected}`));
      console.log();
      return;
    }

    activeFieldSet = matchingSet;

    for (const field of matchingSet) {
      const envKey = buildCredentialEnvKey(platform, field);
      const value = process.env[envKey];
      const validation = validateFieldFormat(platform, field, value);
      if (!validation.valid) {
        console.log(red(`✗ ${validation.error}`));
        console.log(dim(`  Source: ${envKey}`));
        console.log();
        return;
      }
      credentials[field] = value;
    }
  } else {
    if (credentialSets.length > 1) {
      const selected = await promptChoice(
        `Choose credential mode for ${platform}:`,
        credentialSets.map((fieldSet) => fieldSet.join(' + ')),
      );
      if (!selected) {
        console.log(dim('Aborted.'));
        console.log();
        return;
      }
      activeFieldSet = selected.split(' + ');
      console.log();
    }

    for (const field of activeFieldSet) {
      const help = getFieldHelp(platform, field);
      if (help) {
        console.log(dim(`Tip: ${help}`));
      }

      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        const prompt = field === 'bot_token' || field.includes('secret') ? `Enter ${field} (hidden): ` : `Enter ${field}: `;
        const value = await promptHidden(prompt, { maskInput: field === 'bot_token' || field.includes('secret') });

        const validation = validateFieldFormat(platform, field, value);
        if (!validation.valid) {
          console.log(red(`✗ ${validation.error}`));
          attempts++;
          continue;
        }

        credentials[field] = value;
        break;
      }

      if (attempts >= maxAttempts) {
        console.log(red(`✗ Too many invalid attempts for ${field}`));
        console.log();
        return;
      }
    }
  }

  // Verify and save
  console.log();
  console.log(`${yellow('⏳')} Verifying ${platform} credentials...`);

  const result = await channelAdd(platform, credentials, { skipVerify: flags['skip-verify'] === true });

  console.log();
  if (result.ok) {
    console.log(green(`✔ ${result.message}`));
    if (result.details?.botName) {
      console.log(`  Bot name: ${result.details.botName}`);
    }
    if (result.details?.botId) {
      console.log(`  Bot ID: ${result.details.botId}`);
    }
    console.log();
    console.log(dim(`You can now use ${platform} with MindOS agents.`));
  } else {
    console.log(red(`✗ ${result.message}`));
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }
  console.log();
}

/**
 * Handler: remove <platform>
 * @param {string} platform - Platform name
 * @param {Object} flags - CLI flags
 */
async function handleRemove(platform, flags) {
  if (!platform) {
    console.error(red('Usage: mindos channel remove <platform>'));
    process.exit(1);
  }

  console.log();
  console.log(bold(`Remove ${platform} configuration`));
  console.log(yellow(`⚠️  This action cannot be undone.`));
  console.log();

  const confirmed = await promptConfirm(`Remove ${platform} configuration?`);
  if (!confirmed) {
    console.log(dim('Aborted.'));
    console.log();
    return;
  }

  const result = await channelRemove(platform);

  console.log();
  if (result.ok) {
    console.log(green(`✔ ${result.message}`));
  } else {
    console.log(red(`✗ ${result.message}`));
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }
  console.log();
}

/**
 * Handler: verify <platform>
 * @param {string} platform - Platform name
 * @param {Object} flags - CLI flags
 */
async function handleVerify(platform, flags) {
  if (!platform) {
    console.error(red('Usage: mindos channel verify <platform>'));
    process.exit(1);
  }

  console.log();
  console.log(`${yellow('⏳')} Verifying ${platform} configuration...`);

  const result = await channelVerify(platform, { skipVerify: flags['skip-verify'] === true });

  console.log();
  if (result.valid) {
    console.log(green(`✔ ${result.message}`));
    if (result.details?.botName) {
      console.log(`  Bot name: ${result.details.botName}`);
    }
    if (result.details?.botId) {
      console.log(`  Bot ID: ${result.details.botId}`);
    }
    if (result.details?.status) {
      console.log(`  Status: ${result.details.status}`);
    }
  } else {
    console.log(red(`✗ ${result.message}`));
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }
  console.log();
}

// ────────────────────────────────────────────────────────────────────────────
// HELP TEXT
// ────────────────────────────────────────────────────────────────────────────

function buildCredentialEnvKey(platform, field) {
  return `${platform}_${field}`.toUpperCase();
}

function printHelp() {
  const row = (c, d) => `  ${cyan(c.padEnd(32))}${dim(d)}`;

  console.log(`
${bold('mindos channel')} — Manage IM platform configurations

${bold('USAGE')}
  ${cyan('mindos channel [command]')}

${bold('COMMANDS')}
${row('mindos channel list', 'Show configured platforms')}
${row('mindos channel add <platform>', 'Add/update platform config')}
${row('mindos channel remove <platform>', 'Remove platform config')}
${row('mindos channel verify <platform>', 'Test platform credentials')}

${bold('PLATFORMS SUPPORTED')}
  ${CHANNEL_PLATFORMS.join(', ')}

${bold('EXAMPLES')}
  ${dim('mindos channel list')}
  ${dim('mindos channel add telegram')}
  ${dim('mindos channel add telegram --skip-verify')}
  ${dim('mindos channel add telegram --env')}
  ${dim('mindos channel verify discord')}
  ${dim('mindos channel verify discord --skip-verify')}
  ${dim('mindos channel remove feishu')}

${bold('ENV KEYS')}
  ${dim('TELEGRAM_BOT_TOKEN, FEISHU_APP_ID, FEISHU_APP_SECRET, ...')}

${dim('Run "mindos channel <command> --help" for details on any command.')}
`);
}
