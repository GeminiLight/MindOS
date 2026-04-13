import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');
const mockFs = vi.mocked(fs);

describe('IM activity store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockImplementation(() => undefined as unknown as string);
    mockFs.writeFileSync.mockImplementation(() => undefined);
    mockFs.renameSync.mockImplementation(() => undefined);
    mockFs.unlinkSync.mockImplementation(() => undefined);
  });

  it('records a new activity and truncates long message summaries', async () => {
    let fileContent = '';
    mockFs.existsSync.mockImplementation(() => Boolean(fileContent));
    mockFs.readFileSync.mockImplementation(() => fileContent as never);
    mockFs.writeFileSync.mockImplementation((_, content) => {
      fileContent = String(content).trim();
      return undefined;
    });
    mockFs.renameSync.mockImplementation(() => undefined);

    const { recordActivity, getActivities } = await import('@/lib/im/activity');

    recordActivity({
      platform: 'feishu',
      type: 'test',
      status: 'success',
      recipient: 'ou_123',
      message: 'x'.repeat(80),
    });

    const activities = getActivities('feishu');
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe('test');
    expect(activities[0].status).toBe('success');
    expect(activities[0].messageSummary.length).toBeLessThanOrEqual(500);
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('returns newest-first activities and respects limit', async () => {
    let fileContent = '';
    mockFs.existsSync.mockImplementation(() => Boolean(fileContent));
    mockFs.readFileSync.mockImplementation(() => fileContent as never);
    mockFs.writeFileSync.mockImplementation((_, content) => {
      fileContent = String(content).trim();
      return undefined;
    });
    mockFs.renameSync.mockImplementation(() => undefined);

    const { recordActivity, getActivities } = await import('@/lib/im/activity');

    recordActivity({ platform: 'telegram', type: 'manual', status: 'success', recipient: '123', message: 'first' });
    recordActivity({ platform: 'telegram', type: 'manual', status: 'failed', recipient: '123', message: 'second', error: 'oops' });

    const activities = getActivities('telegram', 1);
    expect(activities).toHaveLength(1);
    expect(activities[0].messageSummary).toBe('second');
    expect(activities[0].status).toBe('failed');
  });

  it('resets corrupt store data to empty', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('{bad json}' as never);

    const { getActivities } = await import('@/lib/im/activity');
    expect(getActivities('slack')).toEqual([]);
  });
});
