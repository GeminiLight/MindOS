import YAML from 'js-yaml';
import type { WorkflowYaml, ParseResult, ValidationResult, WorkflowStep } from './types';

export function parseWorkflowYaml(content: string): ParseResult {
  try {
    const parsed = YAML.load(content, { schema: YAML.JSON_SCHEMA }) as unknown;
    
    if (!parsed) {
      return {
        workflow: null,
        errors: ['File is empty'],
      };
    }

    if (typeof parsed !== 'object') {
      return {
        workflow: null,
        errors: ['Content is not valid YAML'],
      };
    }

    const validation = validateWorkflowSchema(parsed);
    if (!validation.valid) {
      return {
        workflow: null,
        errors: validation.errors,
      };
    }

    return {
      workflow: parsed as WorkflowYaml,
      errors: [],
    };
  } catch (err) {
    return {
      workflow: null,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

export function validateWorkflowSchema(obj: unknown): ValidationResult {
  const errors: string[] = [];

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Must be a valid YAML object'] };
  }

  const w = obj as Record<string, any>;

  // Validate title
  if (!w.title || typeof w.title !== 'string' || !w.title.trim()) {
    errors.push("Missing required field 'title' (string)");
  }

  // Validate description (optional)
  if (w.description !== undefined && typeof w.description !== 'string') {
    errors.push("'description' must be a string");
  }

  // Validate skills (optional)
  if (w.skills !== undefined) {
    if (!Array.isArray(w.skills)) {
      errors.push("'skills' must be an array of strings");
    } else if (!w.skills.every((s: any) => typeof s === 'string')) {
      errors.push("'skills' must contain only strings");
    }
  }

  // Validate tools (optional)
  if (w.tools !== undefined) {
    if (!Array.isArray(w.tools)) {
      errors.push("'tools' must be an array of strings");
    } else if (!w.tools.every((t: any) => typeof t === 'string')) {
      errors.push("'tools' must contain only strings");
    }
  }

  // Validate steps
  if (!w.steps) {
    errors.push("Missing required field 'steps' (array)");
  } else if (!Array.isArray(w.steps)) {
    errors.push("'steps' must be an array");
  } else if (w.steps.length === 0) {
    errors.push("'steps' must have at least 1 step");
  } else {
    const seenIds = new Set<string>();
    w.steps.forEach((step: any, idx: number) => {
      const stepErrors = validateStep(step, idx);
      errors.push(...stepErrors);
      // Check for duplicate IDs
      const id = step?.id;
      if (typeof id === 'string' && id.trim()) {
        if (seenIds.has(id)) {
          errors.push(`steps[${idx}].id: duplicate id '${id}' (each step must have a unique id)`);
        }
        seenIds.add(id);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateStep(step: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `steps[${index}]`;

  if (!step || typeof step !== 'object') {
    errors.push(`${prefix}: must be a valid object`);
    return errors;
  }

  const s = step as Record<string, any>;

  // Validate id
  if (!s.id || typeof s.id !== 'string' || !s.id.trim()) {
    errors.push(`${prefix}: missing required field 'id' (non-empty string)`);
  } else if (!/^[a-z0-9_-]+$/.test(s.id)) {
    errors.push(`${prefix}.id: '${s.id}' is invalid — use only lowercase letters, numbers, hyphens, underscores (e.g., 'run-tests')`);
  }

  // Validate name
  if (!s.name || typeof s.name !== 'string' || !s.name.trim()) {
    errors.push(`${prefix}: missing required field 'name' (non-empty string)`);
  }

  // Validate description (optional)
  if (s.description !== undefined && typeof s.description !== 'string') {
    errors.push(`${prefix}.description: must be a string`);
  }

  // Validate agent (optional)
  if (s.agent !== undefined && (typeof s.agent !== 'string' || !s.agent.trim())) {
    errors.push(`${prefix}.agent: must be a non-empty string`);
  }

  // Validate skill (optional)
  if (s.skill !== undefined && (typeof s.skill !== 'string' || !s.skill.trim())) {
    errors.push(`${prefix}.skill: must be a non-empty string`);
  }

  // Validate tools (optional)
  if (s.tools !== undefined) {
    if (!Array.isArray(s.tools)) {
      errors.push(`${prefix}.tools: must be an array of strings`);
    } else if (!s.tools.every((t: any) => typeof t === 'string')) {
      errors.push(`${prefix}.tools: must contain only strings`);
    }
  }

  // Validate prompt (required)
  if (!s.prompt || typeof s.prompt !== 'string' || !s.prompt.trim()) {
    errors.push(`${prefix}: missing required field 'prompt' (non-empty string)`);
  }

  // Validate timeout (optional)
  if (s.timeout !== undefined) {
    if (typeof s.timeout !== 'number' || s.timeout <= 0) {
      errors.push(`${prefix}.timeout: must be a positive number (seconds)`);
    }
  }

  return errors;
}

export function getStepDescription(step: WorkflowStep): string {
  return step.description || step.prompt.split('\n')[0].slice(0, 100);
}
