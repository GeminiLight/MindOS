/**
 * Dependency injection types
 */

/**
 * Service identifier (can be string or symbol)
 */
export type ServiceIdentifier<T = any> = string | symbol | { new (...args: any[]): T }

/**
 * Service lifecycle
 */
export type ServiceLifecycle = 'singleton' | 'transient' | 'scoped'

/**
 * Service factory function
 */
export type ServiceFactory<T> = (container: Container) => T | Promise<T>

/**
 * Service registration
 */
export interface ServiceRegistration<T = any> {
  identifier: ServiceIdentifier<T>
  factory: ServiceFactory<T>
  lifecycle: ServiceLifecycle
  instance?: T
}

/**
 * Container interface
 */
export interface Container {
  /**
   * Register a service
   */
  register<T>(
    identifier: ServiceIdentifier<T>,
    factory: ServiceFactory<T>,
    lifecycle?: ServiceLifecycle
  ): void

  /**
   * Register a singleton service
   */
  registerSingleton<T>(identifier: ServiceIdentifier<T>, factory: ServiceFactory<T>): void

  /**
   * Register a transient service
   */
  registerTransient<T>(identifier: ServiceIdentifier<T>, factory: ServiceFactory<T>): void

  /**
   * Register an instance
   */
  registerInstance<T>(identifier: ServiceIdentifier<T>, instance: T): void

  /**
   * Resolve a service
   */
  resolve<T>(identifier: ServiceIdentifier<T>): T

  /**
   * Resolve a service asynchronously
   */
  resolveAsync<T>(identifier: ServiceIdentifier<T>): Promise<T>

  /**
   * Check if service is registered
   */
  has(identifier: ServiceIdentifier): boolean

  /**
   * Create a child container (for scoped services)
   */
  createScope(): Container

  /**
   * Clear all registrations
   */
  clear(): void
}
