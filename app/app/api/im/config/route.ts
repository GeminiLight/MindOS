import { NextRequest, NextResponse } from 'next/server';
import { readIMConfig, writeIMConfig, validatePlatformConfig } from '@/lib/im/config';
import type { IMPlatform } from '@/lib/im/types';

/** GET — return raw config (with secrets masked) */
export async function GET() {
  try {
    const config = readIMConfig();
    // Mask secret values for display
    const masked: Record<string, Record<string, string>> = {};
    for (const [platform, creds] of Object.entries(config.providers)) {
      if (!creds || typeof creds !== 'object') continue;
      const m: Record<string, string> = {};
      for (const [key, val] of Object.entries(creds as Record<string, string>)) {
        if (typeof val === 'string' && val.length > 4) {
          m[key] = val.slice(0, 4) + '••••' + val.slice(-2);
        } else {
          m[key] = typeof val === 'string' ? '••••' : '';
        }
      }
      masked[platform] = m;
    }
    return NextResponse.json({ providers: masked });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read config' }, { status: 500 });
  }
}

/** PUT — save config for a specific platform */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform, credentials, conversation } = body as {
      platform: string;
      credentials?: Record<string, string>;
      conversation?: {
        enabled?: boolean;
        transport?: 'webhook' | 'long_connection';
        encrypt_key?: string;
        verification_token?: string;
        public_base_url?: string;
        allow_group_mentions?: boolean;
      };
    };

    if (!platform || ((!credentials || typeof credentials !== 'object') && (!conversation || typeof conversation !== 'object'))) {
      return NextResponse.json({ error: 'Missing platform credentials or conversation settings' }, { status: 400 });
    }

    const config = readIMConfig();
    const existing = (config.providers as Record<string, any>)[platform] ?? {};

    if (credentials && typeof credentials === 'object') {
      const mergedCredentials = { ...existing, ...credentials };
      const validation = validatePlatformConfig(platform as IMPlatform, mergedCredentials);
      if (!validation.valid) {
        return NextResponse.json({
          error: `Invalid config: missing ${validation.missing?.join(', ')}`,
          missing: validation.missing,
        }, { status: 422 });
      }
      (config.providers as Record<string, unknown>)[platform] = mergedCredentials;
    }

    if (platform === 'feishu' && conversation && typeof conversation === 'object') {
      if (!existing.app_id || !existing.app_secret) {
        return NextResponse.json({ error: 'Save Feishu App ID and App Secret before enabling conversations' }, { status: 422 });
      }
      const merged = ((config.providers as Record<string, any>)[platform] ?? {}) as Record<string, any>;
      merged.conversation = {
        ...(merged.conversation ?? {}),
        enabled: Boolean(conversation.enabled),
        transport: conversation.transport ?? merged.conversation?.transport ?? 'webhook',
        encrypt_key: conversation.encrypt_key ?? merged.conversation?.encrypt_key,
        verification_token: conversation.verification_token ?? merged.conversation?.verification_token,
        public_base_url: conversation.public_base_url ?? merged.conversation?.public_base_url,
        allow_group_mentions: conversation.allow_group_mentions ?? merged.conversation?.allow_group_mentions ?? true,
      };
      (config.providers as Record<string, unknown>)[platform] = merged;
    }

    writeIMConfig(config);

    return NextResponse.json({ ok: true, platform });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save' }, { status: 500 });
  }
}

/** DELETE — remove a platform's config */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get('platform');
    if (!platform) {
      return NextResponse.json({ error: 'Missing platform parameter' }, { status: 400 });
    }

    const config = readIMConfig();
    delete (config.providers as Record<string, unknown>)[platform];
    writeIMConfig(config);

    return NextResponse.json({ ok: true, platform });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete' }, { status: 500 });
  }
}
