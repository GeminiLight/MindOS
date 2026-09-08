import { expect, it } from 'vitest';
import { settingsEn } from '@/lib/i18n/modules/settings-en';
import { settingsZh } from '@/lib/i18n/modules/settings-zh';

it('describes accepted background uninstall requests without claiming verified completion', () => {
  const en = settingsEn.settings.uninstall;
  const zh = settingsZh.settings.uninstall;
  expect(en.success).toContain('request has been submitted');
  expect(en.successDesktop).toContain('request has been submitted');
  expect(en.success).not.toContain('has been uninstalled');
  expect(en.successDesktop).not.toContain('has been uninstalled');
  expect(zh.success).toContain('请求已提交');
  expect(zh.successDesktop).toContain('请求已提交');
  expect(zh.success).not.toContain('MindOS 已卸载');
  expect(zh.successDesktop).not.toContain('MindOS 已卸载');
});

it('does not promise that configuration cleanup can never affect user files', () => {
  const en = settingsEn.settings.uninstall.kbSafe;
  const zh = settingsZh.settings.uninstall.kbSafe;
  expect(en).not.toContain('always safe');
  expect(en).not.toContain('never deleted');
  expect(en).toContain('~/.mindos/');
  expect(en).toContain('back up');
  expect(zh).not.toContain('绝不会删除');
  expect(zh).toContain('~/.mindos/');
  expect(zh).toContain('备份');
});
