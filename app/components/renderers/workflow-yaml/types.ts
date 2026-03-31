// Types for YAML Workflow

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  agent?: string;
  skill?: string;
  tools?: string[];
  prompt: string;
  timeout?: number;
}

export interface WorkflowYaml {
  title: string;
  description?: string;
  skills?: string[];
  tools?: string[];
  steps: WorkflowStep[];
}

export interface WorkflowStepRuntime extends WorkflowStep {
  index: number;
  status: StepStatus;
  output: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
}

export interface ParseResult {
  workflow: WorkflowYaml | null;
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
