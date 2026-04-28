/**
 * Dependency injection container implementation
 */

import { createError } from '../errors/index.js'
import type {
  Container,
  ServiceIdentifier,
  ServiceFactory,
  ServiceLifecycle,
  ServiceRegistration,
} from './types.js'

/**
 * Simple dependency injection container
 */
export class DIContainer implements Container {
  private registrations = new Map<ServiceIdentifier, ServiceRegistration>()
  private scopedInstances = new Map<ServiceIdentifier, any>()
  private parent?: DIContainer

  constructor(parent?: DIContainer) {
    this.parent = parent
  }

  register<T>(
    identifier: ServiceIdentifier<T>,
    factory: ServiceFactory<T>,
    lifecycle: ServiceLifecycle = 'singleton'
  ): void {
    this.registrations.set(identifier, {
      identifier,
      factory,
      lifecycle,
    })
  }

  registerSingleton<T>(identifier: ServiceIdentifier<T>, factory: ServiceFactory<T>): void {
    this.register(identifier, factory, 'singleton')
  }

  registerTransient<T>(identifier: ServiceIdentifier<T>, factory: ServiceFactory<T>): void {
    this.register(identifier, factory, 'transient')
  }

  registerInstance<T>(identifier: ServiceIdentifier<T>, instance: T): void {
    this.registrations.set(identifier, {
      identifier,
      factory: () => instance,
      lifecycle: 'singleton',
      instance,
    })
  }

  resolve<T>(identifier: ServiceIdentifier<T>): T {
    const registration = this.getRegistration(identifier)

    if (!registration) {
      throw createError(
        'CONFIGURATION_ERROR',
        `Service not registered: ${String(identifier)}`
      )
    }

    // Return existing singleton instance
    if (registration.lifecycle === 'singleton' && registration.instance) {
      return registration.instance as T
    }

    // Return existing scoped instance
    if (registration.lifecycle === 'scoped') {
      const scopedInstance = this.scopedInstances.get(identifier)
      if (scopedInstance) {
        return scopedInstance as T
      }
    }

    // Create new instance
    const instance = registration.factory(this)

    // Check if factory returned a promise
    if (instance instanceof Promise) {
      throw createError(
        'CONFIGURATION_ERROR',
        `Async factory detected. Use resolveAsync() for: ${String(identifier)}`
      )
    }

    // Store singleton instance
    if (registration.lifecycle === 'singleton') {
      registration.instance = instance
    }

    // Store scoped instance
    if (registration.lifecycle === 'scoped') {
      this.scopedInstances.set(identifier, instance)
    }

    return instance as T
  }

  async resolveAsync<T>(identifier: ServiceIdentifier<T>): Promise<T> {
    const registration = this.getRegistration(identifier)

    if (!registration) {
      throw createError(
        'CONFIGURATION_ERROR',
        `Service not registered: ${String(identifier)}`
      )
    }

    // Return existing singleton instance
    if (registration.lifecycle === 'singleton' && registration.instance) {
      return registration.instance as T
    }

    // Return existing scoped instance
    if (registration.lifecycle === 'scoped') {
      const scopedInstance = this.scopedInstances.get(identifier)
      if (scopedInstance) {
        return scopedInstance as T
      }
    }

    // Create new instance (await if promise)
    const instance = await registration.factory(this)

    // Store singleton instance
    if (registration.lifecycle === 'singleton') {
      registration.instance = instance
    }

    // Store scoped instance
    if (registration.lifecycle === 'scoped') {
      this.scopedInstances.set(identifier, instance)
    }

    return instance as T
  }

  has(identifier: ServiceIdentifier): boolean {
    return this.registrations.has(identifier) || (this.parent?.has(identifier) ?? false)
  }

  createScope(): Container {
    return new DIContainer(this)
  }

  clear(): void {
    this.registrations.clear()
    this.scopedInstances.clear()
  }

  private getRegistration(identifier: ServiceIdentifier): ServiceRegistration | undefined {
    const registration = this.registrations.get(identifier)
    if (registration) {
      return registration
    }

    // Check parent container
    if (this.parent) {
      return this.parent.getRegistration(identifier)
    }

    return undefined
  }
}

/**
 * Create a new container
 */
export function createContainer(): Container {
  return new DIContainer()
}
