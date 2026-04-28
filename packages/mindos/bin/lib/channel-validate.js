/**
 * Channel Validation - Field and Format Validation
 */

import {
  CHANNEL_CREDENTIAL_SETS,
  CHANNEL_FIELD_EXAMPLES,
  CHANNEL_FIELD_PATTERNS,
  CHANNEL_PLATFORM_HELP,
  CHANNEL_REQUIRED_FIELDS,
} from './channel-constants.js';

export function validateFieldFormat(platform, field, value) {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${field} cannot be empty` };
  }

  const patterns = CHANNEL_FIELD_PATTERNS[platform];
  if (patterns && patterns[field] && !patterns[field].test(value)) {
    const example = CHANNEL_FIELD_EXAMPLES[platform]?.[field];
    return {
      valid: false,
      error: example
        ? `Invalid ${field} format for ${platform}. Expected like: ${example}`
        : `Invalid ${field} format for ${platform}`,
    };
  }

  return { valid: true };
}

export function getRequiredFields(platform) {
  return CHANNEL_REQUIRED_FIELDS[platform] || [];
}

export function getCredentialSets(platform) {
  return CHANNEL_CREDENTIAL_SETS[platform] || [];
}

export function getFieldHelp(platform, field) {
  return CHANNEL_PLATFORM_HELP[platform]?.[field] || '';
}
