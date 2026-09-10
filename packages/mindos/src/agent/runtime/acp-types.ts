/**
 * ACP wire types for the runtime layer.
 *
 * `agent/runtime` describes what an ACP agent declared in `initialize` /
 * `session/*` payloads, so it needs the wire shapes, but it must never import
 * the protocol host (`protocols/acp/{subprocess,session,registry,...}`). This
 * barrel is the single door: it re-exports only from the dependency-free
 * `protocols/acp/types.ts`, and `layering.test.ts` keeps every other file in
 * this directory away from `protocols/`.
 */

export type {
  AcpAdapterConnectionType,
  AcpAdapterOutputCapabilities,
  AcpAdapterOutputKind,
  AcpAgentCapabilities,
  AcpAuthMethod,
  AcpMcpCapabilities,
  AcpPromptCapabilities,
  AcpRegistryEntry,
  AcpSessionCapabilities,
  AcpTransportType,
} from '../../protocols/acp/types.js';

export { isAcpCapabilitySupported } from '../../protocols/acp/types.js';
