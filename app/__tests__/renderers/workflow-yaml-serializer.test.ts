import { describe, it, expect } from 'vitest';
import { serializeWorkflowYaml, generateStepId } from '@/components/renderers/workflow-yaml/serializer';
import { parseWorkflowYaml } from '@/components/renderers/workflow-yaml/parser';
import type { WorkflowYaml } from '@/components/renderers/workflow-yaml/types';

describe('Workflow Serializer', () => {
  it('round-trips a basic workflow (normal path)', () => {
    const workflow: WorkflowYaml = {
      title: 'Test Workflow',
      description: 'A test',
      steps: [
        { id: 'step-1', name: 'First', prompt: 'Do something' },
      ],
    };
    const yaml = serializeWorkflowYaml(workflow);
    const parsed = parseWorkflowYaml(yaml);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.workflow?.title).toBe('Test Workflow');
    expect(parsed.workflow?.steps[0].name).toBe('First');
  });

  it('strips empty optional fields (boundary)', () => {
    const workflow: WorkflowYaml = {
      title: 'Minimal',
      steps: [{ id: 's1', name: 'Step', prompt: 'Go' }],
    };
    const yaml = serializeWorkflowYaml(workflow);
    expect(yaml).not.toContain('description');
    expect(yaml).not.toContain('skills');
    expect(yaml).not.toContain('agent');
  });

  it('preserves agent and skill fields (normal path)', () => {
    const workflow: WorkflowYaml = {
      title: 'Full',
      skills: ['code-review'],
      steps: [{
        id: 's1', name: 'Review', prompt: 'Review code',
        agent: 'cursor', skill: 'code-review-quality', timeout: 120,
      }],
    };
    const yaml = serializeWorkflowYaml(workflow);
    const parsed = parseWorkflowYaml(yaml);
    expect(parsed.workflow?.skills).toContain('code-review');
    expect(parsed.workflow?.steps[0].agent).toBe('cursor');
    expect(parsed.workflow?.steps[0].skill).toBe('code-review-quality');
    expect(parsed.workflow?.steps[0].timeout).toBe(120);
  });
});

describe('generateStepId', () => {
  it('converts name to kebab-case', () => {
    expect(generateStepId('Run Tests', [])).toBe('run-tests');
  });

  it('avoids duplicates', () => {
    expect(generateStepId('step', ['step'])).toBe('step-2');
    expect(generateStepId('step', ['step', 'step-2'])).toBe('step-3');
  });

  it('handles empty name', () => {
    expect(generateStepId('', [])).toBe('step');
  });
});
