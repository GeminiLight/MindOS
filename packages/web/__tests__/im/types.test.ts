import { describe, it, expect } from 'vitest';
import { isValidRecipientId } from '@/lib/im/types';

describe('IM Types - Recipient ID Validation', () => {
  describe('telegram', () => {
    it('accepts positive numeric chat IDs', () => {
      expect(isValidRecipientId('telegram', '123456789')).toBe(true);
    });
    it('accepts negative group IDs', () => {
      expect(isValidRecipientId('telegram', '-1001234567890')).toBe(true);
    });
    it('rejects non-numeric IDs', () => {
      expect(isValidRecipientId('telegram', 'abc')).toBe(false);
      expect(isValidRecipientId('telegram', '')).toBe(false);
    });
  });

  describe('discord', () => {
    it('accepts Snowflake IDs (17-20 digits)', () => {
      expect(isValidRecipientId('discord', '12345678901234567')).toBe(true);
      expect(isValidRecipientId('discord', '12345678901234567890')).toBe(true);
    });
    it('rejects short IDs', () => {
      expect(isValidRecipientId('discord', '123')).toBe(false);
    });
    it('rejects non-numeric IDs', () => {
      expect(isValidRecipientId('discord', 'abc123')).toBe(false);
    });
  });

  describe('feishu', () => {
    it('accepts chat_id (oc_ prefix)', () => {
      expect(isValidRecipientId('feishu', 'oc_abc123')).toBe(true);
    });
    it('accepts open_id (ou_ prefix)', () => {
      expect(isValidRecipientId('feishu', 'ou_abc123')).toBe(true);
    });
    it('accepts union_id (on_ prefix)', () => {
      expect(isValidRecipientId('feishu', 'on_abc123')).toBe(true);
    });
    it('accepts email format', () => {
      expect(isValidRecipientId('feishu', 'user@example.com')).toBe(true);
    });
    it('rejects invalid format', () => {
      expect(isValidRecipientId('feishu', '')).toBe(false);
    });
  });

  describe('slack', () => {
    it('accepts Slack channel IDs', () => {
      expect(isValidRecipientId('slack', 'C01234567')).toBe(true);
      expect(isValidRecipientId('slack', 'U01234567')).toBe(true);
    });
    it('rejects lowercase IDs', () => {
      expect(isValidRecipientId('slack', 'c01234567')).toBe(false);
    });
  });

  describe('wecom', () => {
    it('accepts any non-empty string', () => {
      expect(isValidRecipientId('wecom', 'anything')).toBe(true);
    });
    it('rejects empty string', () => {
      expect(isValidRecipientId('wecom', '')).toBe(false);
    });
  });

  describe('dingtalk', () => {
    it('accepts any non-empty string', () => {
      expect(isValidRecipientId('dingtalk', 'group123')).toBe(true);
    });
    it('rejects empty string', () => {
      expect(isValidRecipientId('dingtalk', '')).toBe(false);
    });
  });

  describe('wechat', () => {
    it('accepts any non-empty string', () => {
      expect(isValidRecipientId('wechat', 'wxid_abc123')).toBe(true);
    });
    it('rejects empty string', () => {
      expect(isValidRecipientId('wechat', '')).toBe(false);
    });
  });

  describe('qq', () => {
    it('accepts QQ openid', () => {
      expect(isValidRecipientId('qq', 'ABCDEF123456')).toBe(true);
    });
    it('accepts group:prefix for group chat', () => {
      expect(isValidRecipientId('qq', 'group:ABCDEF123456')).toBe(true);
    });
    it('rejects empty string', () => {
      expect(isValidRecipientId('qq', '')).toBe(false);
    });
  });
});
