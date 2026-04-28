/**
 * Core package exports
 */

export type {
  Container,
  ServiceIdentifier,
  ServiceFactory,
  ServiceLifecycle,
  ServiceRegistration,
} from './types.js'

export { DIContainer, createContainer } from './container.js'
export { createToken, TOKENS } from './tokens.js'
