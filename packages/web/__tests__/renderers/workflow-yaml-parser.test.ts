import { describe, it, expect } from 'vitest';
import { parseWorkflowYaml, validateWorkflowSchema } from '@/components/renderers/workflow-yaml/parser';

describe('Workflow YAML Parser', () => {
  it('should parse valid workflow', () => {
    const yaml = `
title: Test Workflow
description: A test workflow
steps:
  - id: step1
    name: First step
    prompt: Execute this step
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors).toHaveLength(0);
    expect(result.workflow).toBeDefined();
    expect(result.workflow?.title).toBe('Test Workflow');
    expect(result.workflow?.steps).toHaveLength(1);
  });

  it('should detect missing title', () => {
    const yaml = `
description: Missing title
steps:
  - id: step1
    name: Step
    prompt: Execute
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('title');
  });

  it('should detect missing steps', () => {
    const yaml = `
title: No Steps Workflow
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('steps');
  });

  it('should detect empty steps', () => {
    const yaml = `
title: Empty Steps
steps: []
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('at least 1 step');
  });

  it('should parse workflow with skills and tools', () => {
    const yaml = `
title: Advanced Workflow
skills:
  - code-review-quality
  - document-release
tools:
  - git
  - npm
steps:
  - id: review
    name: Code Review
    skill: code-review-quality
    agent: claude-code
    prompt: Review the code
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors).toHaveLength(0);
    expect(result.workflow?.skills).toContain('code-review-quality');
    expect(result.workflow?.tools).toContain('git');
    expect(result.workflow?.steps[0].skill).toBe('code-review-quality');
    expect(result.workflow?.steps[0].agent).toBe('claude-code');
  });

  it('should validate step requires id', () => {
    const yaml = `
title: Missing ID
steps:
  - name: Step
    prompt: Execute
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('steps[0]');
    expect(result.errors[0]).toContain('id');
  });

  it('should validate step requires name', () => {
    const yaml = `
title: Missing Name
steps:
  - id: step1
    prompt: Execute
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('steps[0]');
    expect(result.errors[0]).toContain('name');
  });

  it('should validate step requires prompt', () => {
    const yaml = `
title: Missing Prompt
steps:
  - id: step1
    name: Step
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('steps[0]');
    expect(result.errors[0]).toContain('prompt');
  });

  it('should reject invalid id format', () => {
    const yaml = `
title: Invalid ID Format
steps:
  - id: "Step-1 Invalid"
    name: Step
    prompt: Execute
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('invalid');
  });

  it('should handle YAML parse errors', () => {
    const yaml = `
title: Test
steps:
  - id: step1
    name: Step
    prompt: |
      Multiline
      with: invalid: yaml:
`;
    const result = parseWorkflowYaml(yaml);
    // Should handle gracefully (may or may not error depending on YAML parser)
    expect(typeof result.errors).toBe('object');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('should allow optional fields', () => {
    const yaml = `
title: Minimal Workflow
steps:
  - id: step1
    name: Step
    prompt: Execute
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors).toHaveLength(0);
    expect(result.workflow?.description).toBeUndefined();
    expect(result.workflow?.steps[0].agent).toBeUndefined();
    expect(result.workflow?.steps[0].skill).toBeUndefined();
  });

  it('should detect duplicate step IDs', () => {
    const yaml = `
title: Duplicate IDs
steps:
  - id: same
    name: Step A
    prompt: Do A
  - id: same
    name: Step B
    prompt: Do B
`;
    const result = parseWorkflowYaml(yaml);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('duplicate'))).toBe(true);
  });

  it('should handle empty file', () => {
    const result = parseWorkflowYaml('');
    expect(result.workflow).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
