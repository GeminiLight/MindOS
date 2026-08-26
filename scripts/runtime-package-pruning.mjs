const DOCUMENTATION_BASENAMES = '(readme|changelog|history|contributing|security)';
const DOCUMENTATION_EXTENSIONS = '(md|markdown|txt|rst)';
const DOCUMENTATION_FILE_PATTERN = new RegExp(
  `^${DOCUMENTATION_BASENAMES}(\\.${DOCUMENTATION_EXTENSIONS})?$`,
  'i',
);

export function isRuntimeDocumentationFileName(name) {
  return DOCUMENTATION_FILE_PATTERN.test(name);
}
