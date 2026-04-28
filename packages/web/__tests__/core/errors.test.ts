import { describe, it, expect } from 'vitest';
import { MindOSError, ErrorCodes, toErrorMessage, apiError, handleRouteError } from '@/lib/errors';
import type { ApiErrorResponse } from '@/lib/errors';

describe('MindOSError', () => {
  it('constructs with code and message', () => {
    const err = new MindOSError(ErrorCodes.FILE_NOT_FOUND, 'not found');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MindOSError);
    expect(err.name).toBe('MindOSError');
    expect(err.code).toBe('FILE_NOT_FOUND');
    expect(err.message).toBe('not found');
    expect(err.context).toBeUndefined();
    expect(err.userMessage).toBeUndefined();
  });

  it('constructs with context and userMessage', () => {
    const err = new MindOSError(
      ErrorCodes.PATH_OUTSIDE_ROOT,
      'technical details',
      { path: '/etc/passwd' },
      'Access denied',
    );
    expect(err.code).toBe('PATH_OUTSIDE_ROOT');
    expect(err.context).toEqual({ path: '/etc/passwd' });
    expect(err.userMessage).toBe('Access denied');
  });
});

describe('ErrorCodes', () => {
  it('has all expected codes', () => {
    const codes = Object.values(ErrorCodes);
    expect(codes).toContain('FILE_NOT_FOUND');
    expect(codes).toContain('FILE_ALREADY_EXISTS');
    expect(codes).toContain('PATH_OUTSIDE_ROOT');
    expect(codes).toContain('PROTECTED_FILE');
    expect(codes).toContain('INVALID_PATH');
    expect(codes).toContain('INVALID_RANGE');
    expect(codes).toContain('HEADING_NOT_FOUND');
    expect(codes).toContain('INVALID_FILE_TYPE');
    expect(codes).toContain('INVALID_REQUEST');
    expect(codes).toContain('MODEL_INIT_FAILED');
    expect(codes).toContain('INTERNAL_ERROR');
    expect(codes).toContain('PERMISSION_DENIED');
  });

  it('codes are string values matching their keys', () => {
    for (const [key, value] of Object.entries(ErrorCodes)) {
      expect(key).toBe(value);
    }
  });
});

describe('toErrorMessage', () => {
  it('extracts message from Error', () => {
    expect(toErrorMessage(new Error('oops'))).toBe('oops');
  });

  it('extracts message from MindOSError', () => {
    expect(toErrorMessage(new MindOSError(ErrorCodes.FILE_NOT_FOUND, 'gone'))).toBe('gone');
  });

  it('returns string directly', () => {
    expect(toErrorMessage('plain string')).toBe('plain string');
  });

  it('stringifies non-Error/string values', () => {
    expect(toErrorMessage(42)).toBe('42');
    expect(toErrorMessage(null)).toBe('null');
    expect(toErrorMessage(undefined)).toBe('undefined');
  });
});

describe('apiError', () => {
  it('returns NextResponse with structured error body', async () => {
    const res = apiError(ErrorCodes.FILE_NOT_FOUND, 'gone', 404);
    expect(res.status).toBe(404);
    const body = await res.json() as ApiErrorResponse;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('FILE_NOT_FOUND');
    expect(body.error.message).toBe('gone');
  });

  it('derives status from code when not explicitly provided', async () => {
    const res = apiError(ErrorCodes.FILE_NOT_FOUND, 'gone');
    expect(res.status).toBe(404);

    const res2 = apiError(ErrorCodes.INVALID_REQUEST, 'bad');
    expect(res2.status).toBe(400);

    const res3 = apiError(ErrorCodes.PATH_OUTSIDE_ROOT, 'denied');
    expect(res3.status).toBe(403);
  });
});

describe('handleRouteError', () => {
  it('returns structured response for MindOSError', async () => {
    const err = new MindOSError(ErrorCodes.PROTECTED_FILE, 'cannot modify');
    const res = handleRouteError(err);
    expect(res.status).toBe(403);
    const body = await res.json() as ApiErrorResponse;
    expect(body.error.code).toBe('PROTECTED_FILE');
  });

  it('returns 500 INTERNAL_ERROR for unknown errors', async () => {
    const res = handleRouteError(new Error('random'));
    expect(res.status).toBe(500);
    const body = await res.json() as ApiErrorResponse;
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
  });

  it('returns 500 INTERNAL_ERROR for non-Error throws', async () => {
    const res = handleRouteError('string error');
    expect(res.status).toBe(500);
    const body = await res.json() as ApiErrorResponse;
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
