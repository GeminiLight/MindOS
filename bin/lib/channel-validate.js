/**
 * Channel Validation - Field and Format Validation
 */

import {
  CHANNEL_FIELD_EXAMPLES,
  CHANNEL_FIELD_PATTERNS,
  CHANNEL_PLATFORM_HELP,
  CHANNEL_REQUIRED_FIELDS,
} from './channel-constants.js';

/**
 * Validate field format
 * @param {string} platform
 * @param {string} field
 * @param {string} value
 * @returns {{valid: boolean, error?: string}}
 */
export function validateFieldFormat(platform, field, value) {
  if (!value || value.trim() === '') {
    return { valid: false, error: `${field} cannot be empty` };
  }

  const patterns = CHANNEL_FIELD_PATTERNS[platform];
  if (patterns && patterns[field]) {
    if (!patterns[field].test(value)) {
      const example = CHANNEL_FIELD_EXAMPLES[platform]?.[field];
      return {
        valid: false,
        error: example
          ? `Invalid ${field} format for ${platform}. Expected like: ${example}`
          : `Invalid ${field} format for ${platform}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get required fields for a platform
 * @param {string} platform
 * @returns {string[]}
 */
export function getRequiredFields(platform) {
  return CHANNEL_REQUIRED_FIELDS[platform] || [];
}

/**
 * Get field help text
 * @param {string} platform
 * @param {string} field
 * @returns {string}
 */
export function getFieldHelp(platform, field) {
  return CHANNEL_PLATFORM_HELP[platform]?.[field] || '';
}
