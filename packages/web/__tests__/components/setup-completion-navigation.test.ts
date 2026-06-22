import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = join(__dirname, '../..');

describe('setup completion navigation', () => {
  it('sends completed first-time setup to the app root instead of relying on welcome=1', () => {
    const setupWizard = readFileSync(join(webRoot, 'components/setup/index.tsx'), 'utf-8');
    const stepReview = readFileSync(join(webRoot, 'components/setup/StepReview.tsx'), 'utf-8');

    expect(setupWizard).toContain('href="/"');
    expect(setupWizard).not.toContain('href="/?welcome=1"');
    expect(stepReview).not.toContain('/?welcome=1');
  });
});
