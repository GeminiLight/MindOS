const AGENT_ICON_FILE_BY_KEY: Record<string, string> = {
  mindos: 'mindos.svg',
  'mindos-agent': 'mindos.svg',
  'claude-code': 'claude.svg',
  claude: 'claude.svg',
  cursor: 'cursor.svg',
  windsurf: 'windsurf.svg',
  codex: 'openai.svg',
  openai: 'openai.svg',
  chatgpt: 'openai.svg',
  'github-copilot': 'github-copilot.svg',
  copilot: 'github-copilot.svg',
  'gemini-cli': 'gemini.svg',
  gemini: 'gemini.svg',
  antigravity: 'gemini.svg',
  cline: 'cline.svg',
  'roo-code': 'roo.svg',
  roo: 'roo.svg',
  openclaw: 'openclaw.svg',
  codebuddy: 'codebuddy.svg',
  'codebuddy-code': 'codebuddy.svg',
  'kimi-cli': 'kimi-cli.png',
  'kimi-code': 'kimi-cli.png',
  kimi: 'kimi-cli.png',
  opencode: 'opencode.svg',
  'open-code': 'opencode.svg',
  'kilo-code': 'kilo-code.svg',
  kilocode: 'kilo-code.svg',
  kilo: 'kilo-code.svg',
  warp: 'warp.svg',
  pi: 'pi.svg',
  'pi-agent': 'pi.svg',
  'pi-subagent': 'pi.svg',
  augment: 'augment.svg',
  auggie: 'augment.svg',
  'qwen-code': 'qwen-code.svg',
  qwen: 'qwen-code.svg',
  qoder: 'qoder.svg',
  trae: 'trae.png',
  'trae-cn': 'trae-cn.png',
  lingma: 'lingma.png',
  'tongyi-lingma': 'lingma.png',
  qclaw: 'qclaw.jpg',
  quantumclaw: 'qclaw.jpg',
  workbuddy: 'workbuddy.svg',
  copaw: 'copaw.svg',
  hermes: 'hermes.svg',
};

export function agentIconFile(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!key) return null;
  if (AGENT_ICON_FILE_BY_KEY[key]) return AGENT_ICON_FILE_BY_KEY[key];
  if (key.includes('mindos')) return 'mindos.svg';
  if (key.includes('claude')) return 'claude.svg';
  if (key.includes('cursor')) return 'cursor.svg';
  if (key.includes('windsurf')) return 'windsurf.svg';
  if (key.includes('codex') || key.includes('openai') || key.includes('chatgpt')) return 'openai.svg';
  if (key.includes('copilot')) return 'github-copilot.svg';
  if (key.includes('gemini')) return 'gemini.svg';
  if (key.includes('google')) return 'google.svg';
  if (key.includes('cline')) return 'cline.svg';
  if (key.includes('roo')) return 'roo.svg';
  if (key.includes('openclaw')) return 'openclaw.svg';
  if (key.includes('codebuddy')) return 'codebuddy.svg';
  if (key.includes('kimi')) return 'kimi-cli.png';
  if (key.includes('opencode') || key.includes('open-code')) return 'opencode.svg';
  if (key.includes('kilo')) return 'kilo-code.svg';
  if (key.includes('warp')) return 'warp.svg';
  if (key === 'pi' || key.includes('pi-subagent')) return 'pi.svg';
  if (key.includes('augment') || key.includes('auggie')) return 'augment.svg';
  if (key.includes('qwen')) return 'qwen-code.svg';
  if (key.includes('qoder')) return 'qoder.svg';
  if (key.includes('trae-cn')) return 'trae-cn.png';
  if (key.includes('trae')) return 'trae.png';
  if (key.includes('lingma')) return 'lingma.png';
  if (key.includes('qclaw') || key.includes('quantumclaw')) return 'qclaw.jpg';
  if (key.includes('workbuddy')) return 'workbuddy.svg';
  if (key.includes('copaw')) return 'copaw.svg';
  if (key === 'hermes' || key.includes('hermes-agent')) return 'hermes.svg';
  return null;
}
