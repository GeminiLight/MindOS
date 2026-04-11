function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Generate <available_skills> XML for third-party skills.
 * Instructs the LLM to use `load_skill` (not the framework's `read` tool).
 * Omits <location> since load_skill resolves by name.
 */
export function generateSkillsXml(skills: Array<{ name: string; description: string }>): string {
  const lines = [
    '## Available Skills',
    '',
    'The following is the COMPLETE and EXHAUSTIVE list of skills available in this environment.',
    'When a user mentions or requests a skill by name, or when a task matches a skill\'s description,',
    'use the `load_skill` tool to load its full content before responding.',
    '',
    '**IMPORTANT**: ONLY the skills listed below exist. Do NOT mention, suggest, or claim to have',
    'any skills that are not in this list. If a user asks what skills you have, list ONLY these.',
    'Fabricating skill names that are not listed here is strictly prohibited.',
    '',
    'Invocation patterns:',
    '- User says "read/use/load <skill-name>" → call load_skill("<skill-name>")',
    '- User selects a skill via slash command → see "Active Skill Request" section above',
    '- Task naturally matches a skill description → proactively call load_skill',
    '',
    '<available_skills>',
  ];
  for (const skill of skills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}
