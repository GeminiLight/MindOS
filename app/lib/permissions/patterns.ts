/**
 * Dangerous operation patterns
 *
 * Defines patterns for detecting dangerous commands, sensitive files,
 * and dangerous paths that require user confirmation.
 */

/**
 * Dangerous shell command patterns
 * These commands can cause data loss, system damage, or security issues
 */
export const DANGEROUS_COMMAND_PATTERNS = [
  // Recursive deletion
  { pattern: /rm\s+-[^|]*rf|rm\s+-[^|]*fr/, description: 'Recursive file deletion (rm -rf)' },

  // Privilege escalation
  { pattern: /sudo\s+/, description: 'Privilege escalation (sudo)' },

  // Dangerous permissions
  { pattern: /chmod\s+777/, description: 'Dangerous file permissions (chmod 777)' },
  { pattern: /chmod\s+-R\s+777/, description: 'Recursive dangerous permissions' },

  // Disk operations
  { pattern: /dd\s+if=/, description: 'Direct disk write (dd)' },
  { pattern: /mkfs/, description: 'Format filesystem (mkfs)' },

  // Device file writes
  { pattern: />\/dev\//, description: 'Write to device file' },

  // Pipe to shell execution
  { pattern: /curl[^|]*\|\s*(bash|sh)/, description: 'Pipe curl to shell' },
  { pattern: /wget[^|]*\|\s*(bash|sh)/, description: 'Pipe wget to shell' },

  // System modification
  { pattern: /chown\s+-R/, description: 'Recursive ownership change' },
  { pattern: /kill\s+-9\s+1/, description: 'Kill init process' },

  // Dangerous redirects
  { pattern: />\s*\/etc\//, description: 'Write to /etc directory' },
  { pattern: />\s*\/usr\//, description: 'Write to /usr directory' },
  { pattern: />\s*\/bin\//, description: 'Write to /bin directory' },
];

/**
 * Sensitive file patterns
 * These files contain credentials, keys, or sensitive configuration
 */
export const SENSITIVE_FILE_PATTERNS = [
  // Environment files
  { pattern: /\.env$/, description: 'Environment configuration file' },
  { pattern: /\.env\./, description: 'Environment configuration file' },

  // Private keys
  { pattern: /.*\.key$/, description: 'Private key file' },
  { pattern: /.*\.pem$/, description: 'PEM certificate/key file' },
  { pattern: /.*\.p12$/, description: 'PKCS#12 certificate file' },
  { pattern: /.*\.pfx$/, description: 'PFX certificate file' },

  // SSH keys
  { pattern: /id_rsa$/, description: 'SSH private key' },
  { pattern: /id_ed25519$/, description: 'SSH private key (Ed25519)' },
  { pattern: /id_ecdsa$/, description: 'SSH private key (ECDSA)' },
  { pattern: /\.ssh\//, description: 'SSH configuration directory' },

  // Credentials
  { pattern: /credentials\.json$/, description: 'Credentials file' },
  { pattern: /secrets\.json$/, description: 'Secrets file' },
  { pattern: /\.aws\/credentials/, description: 'AWS credentials' },
  { pattern: /\.npmrc$/, description: 'NPM configuration (may contain tokens)' },
  { pattern: /\.pypirc$/, description: 'PyPI configuration (may contain tokens)' },

  // Database
  { pattern: /\.sqlite$/, description: 'SQLite database file' },
  { pattern: /\.db$/, description: 'Database file' },
];

/**
 * Dangerous path patterns
 * These paths are system directories that should not be modified
 */
export const DANGEROUS_PATH_PATTERNS = [
  // Unix system directories
  { pattern: /^\/etc\//, description: 'System configuration directory' },
  { pattern: /^\/usr\//, description: 'System programs directory' },
  { pattern: /^\/bin\//, description: 'System binaries directory' },
  { pattern: /^\/sbin\//, description: 'System administration binaries' },
  { pattern: /^\/boot\//, description: 'Boot loader files' },
  { pattern: /^\/sys\//, description: 'System kernel interface' },
  { pattern: /^\/proc\//, description: 'Process information' },

  // macOS system directories
  { pattern: /^\/System\//, description: 'macOS system directory' },
  { pattern: /^\/Library\//, description: 'macOS system library' },
  { pattern: /^\/Applications\//, description: 'macOS applications directory' },

  // Windows system directories (using forward slashes after normalization)
  { pattern: /^C:\/Windows\//i, description: 'Windows system directory' },
  { pattern: /^C:\/Program Files\//i, description: 'Windows program files' },
  { pattern: /^C:\/Program Files \(x86\)\//i, description: 'Windows program files (x86)' },

  // Root directory (extremely dangerous)
  { pattern: /^\/$/, description: 'Root directory' },
  { pattern: /^C:\/$/i, description: 'Windows root directory' },
];

/**
 * Safe command patterns (whitelist)
 * These commands are known to be safe and should not trigger warnings
 */
export const SAFE_COMMAND_PATTERNS = [
  /^ls\s/,
  /^pwd$/,
  /^echo\s/,
  /^cat\s/,
  /^grep\s/,
  /^find\s/,
  /^git\s+status/,
  /^git\s+log/,
  /^git\s+diff/,
  /^npm\s+install/,
  /^npm\s+test/,
  /^npm\s+run/,
  /^node\s/,
  /^python\s/,
  /^which\s/,
  /^whoami$/,
  /^date$/,
];
