/**
 * A2A Agent Card generator for MindOS.
 * Builds the card dynamically from current settings and MCP tools.
 */

import type { AgentCard, AgentSkill } from './types';

/** MindOS knowledge-base skills exposed via A2A */
const KB_SKILLS: AgentSkill[] = [
  {
    id: 'kb-search',
    name: 'Search Knowledge Base',
    description: 'Full-text search across all notes, files, and spaces in the knowledge base.',
    tags: ['search', 'knowledge', 'notes'],
    examples: ['Search for notes about machine learning', 'Find files mentioning project deadlines'],
    inputModes: ['text/plain'],
    outputModes: ['text/plain', 'application/json'],
  },
  {
    id: 'kb-read',
    name: 'Read Note',
    description: 'Read the full content of a specific file in the knowledge base.',
    tags: ['read', 'file', 'content'],
    examples: ['Read the file at Projects/roadmap.md'],
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
  },
  {
    id: 'kb-write',
    name: 'Write Note',
    description: 'Create or update a note in the knowledge base. Supports .md and .csv files.',
    tags: ['write', 'create', 'update'],
    examples: ['Create a new meeting note at Work/meetings/2026-03-30.md'],
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
  },
  {
    id: 'kb-list',
    name: 'List Files',
    description: 'List files and directory structure of the knowledge base.',
    tags: ['list', 'tree', 'structure'],
    examples: ['Show the file tree', 'List all spaces'],
    inputModes: ['text/plain'],
    outputModes: ['application/json'],
  },
  {
    id: 'kb-organize',
    name: 'Organize Files',
    description: 'AI-powered file organization into appropriate spaces and directories.',
    tags: ['organize', 'ai', 'structure'],
    examples: ['Organize imported files into relevant spaces'],
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
  },
];

/**
 * Build the A2A Agent Card for this MindOS instance.
 * @param baseUrl  The publicly reachable base URL (e.g. http://localhost:3456)
 */
export function buildAgentCard(baseUrl: string): AgentCard {
  let version = process.env.npm_package_version || '0.0.0';

  // Try reading version from package.json as fallback
  if (version === '0.0.0') {
    try {
      const fs = require('fs');
      const path = require('path');
      const projRoot = process.env.MINDOS_PROJECT_ROOT || path.resolve(process.cwd(), '..');
      const pkg = JSON.parse(fs.readFileSync(path.join(projRoot, 'package.json'), 'utf-8'));
      if (pkg.version) version = pkg.version;
    } catch { /* use default */ }
  }

  return {
    name: 'MindOS',
    description: 'Personal knowledge management system with AI-powered Spaces, Instructions, and Skills. Store, organize, and retrieve knowledge through natural language.',
    version,
    provider: {
      organization: 'MindOS',
      url: baseUrl,
    },
    supportedInterfaces: [
      {
        url: `${baseUrl}/api/a2a`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      streaming: false,  // Phase 1: no streaming
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: KB_SKILLS,
    securitySchemes: {
      bearer: {
        httpAuthSecurityScheme: {
          scheme: 'Bearer',
        },
      },
    },
    securityRequirements: [{ bearer: [] }],
  };
}
