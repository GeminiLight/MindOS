export type ConnectionProvider = 'feishu';
export type ConnectionAdapter = 'lark-cli';
export type ConnectionStatus = 'ready' | 'degraded' | 'unavailable';
export type ConnectionIdentityKind = 'bot' | 'user';
export type ConnectionIdentityStatus = 'ready' | 'missing' | 'expired' | 'error' | 'unknown';

export interface ExternalCredentialReference {
  kind: 'lark-cli-profile';
  executablePath: string;
  profile: string;
}

export interface ConnectionIdentity {
  status: ConnectionIdentityStatus;
  available: boolean;
  verified: boolean;
  externalId?: string;
  displayName?: string;
  message?: string;
  hint?: string;
}

export interface ConnectionCapability {
  id: 'message.send' | 'event.consume' | 'user.act-as-user';
  identity: ConnectionIdentityKind;
  status: 'available' | 'blocked';
  reason?: string;
  missingScopes?: string[];
}

export interface ConnectionIssue {
  code: 'cli_failed' | 'invalid_output' | 'missing_scopes' | 'bot_auth_missing' | 'user_auth_missing';
  message: string;
  hint?: string;
  missingScopes?: string[];
}

export interface ConnectionCandidate {
  schemaVersion: 1;
  id: string;
  provider: ConnectionProvider;
  adapter: ConnectionAdapter;
  status: ConnectionStatus;
  credentialRef: ExternalCredentialReference;
  application: {
    appId: string;
    appName?: string;
    brand: 'feishu' | 'lark';
  };
  owner: {
    identity: 'bot';
    source: 'lark-cli-profile';
    externalId?: string;
    displayName?: string;
  };
  identities: Record<ConnectionIdentityKind, ConnectionIdentity>;
  capabilities: ConnectionCapability[];
  discoveredAt: string;
  issues: ConnectionIssue[];
}

export interface ConnectionBinding extends Omit<ConnectionCandidate, 'discoveredAt'> {
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string;
}

export interface ConnectionRegistry {
  schemaVersion: 1;
  bindings: ConnectionBinding[];
}

export interface LarkCliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export type LarkCliRunner = (executablePath: string, args: string[]) => Promise<LarkCliRunResult>;
