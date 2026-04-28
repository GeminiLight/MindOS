/**
 * Dependency injection container tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DIContainer, createContainer, createToken } from './index.js'

// Test services
interface Logger {
  log(message: string): void
}

interface Database {
  query(sql: string): string[]
}

interface UserService {
  getUser(id: string): string
}

class SimpleLogger implements Logger {
  public logs: string[] = []

  log(message: string): void {
    this.logs.push(message)
  }
}

class SimpleDatabase implements Database {
  query(sql: string): string[] {
    return [`Result for: ${sql}`]
  }
}

class UserServiceImpl implements UserService {
  constructor(
    private logger: Logger,
    private db: Database
  ) {}

  getUser(id: string): string {
    this.logger.log(`Getting user ${id}`)
    const results = this.db.query(`SELECT * FROM users WHERE id = ${id}`)
    return results[0]
  }
}

describe('DIContainer', () => {
  let container: DIContainer

  beforeEach(() => {
    container = new DIContainer()
  })

  describe('Basic Registration and Resolution', () => {
    it('should register and resolve a service', () => {
      container.register('logger', () => new SimpleLogger())
      const logger = container.resolve<Logger>('logger')

      expect(logger).toBeInstanceOf(SimpleLogger)
    })

    it('should register and resolve with symbol identifier', () => {
      const LoggerToken = Symbol('Logger')
      container.register(LoggerToken, () => new SimpleLogger())
      const logger = container.resolve<Logger>(LoggerToken)

      expect(logger).toBeInstanceOf(SimpleLogger)
    })

    it('should throw error when resolving unregistered service', () => {
      expect(() => container.resolve('nonexistent')).toThrow()
    })

    it('should check if service is registered', () => {
      container.register('logger', () => new SimpleLogger())

      expect(container.has('logger')).toBe(true)
      expect(container.has('nonexistent')).toBe(false)
    })
  })

  describe('Singleton Lifecycle', () => {
    it('should return same instance for singleton', () => {
      container.registerSingleton('logger', () => new SimpleLogger())

      const logger1 = container.resolve<SimpleLogger>('logger')
      const logger2 = container.resolve<SimpleLogger>('logger')

      expect(logger1).toBe(logger2)
    })

    it('should create singleton instance only once', () => {
      let createCount = 0
      container.registerSingleton('logger', () => {
        createCount++
        return new SimpleLogger()
      })

      container.resolve('logger')
      container.resolve('logger')
      container.resolve('logger')

      expect(createCount).toBe(1)
    })

    it('should use singleton as default lifecycle', () => {
      container.register('logger', () => new SimpleLogger())

      const logger1 = container.resolve<SimpleLogger>('logger')
      const logger2 = container.resolve<SimpleLogger>('logger')

      expect(logger1).toBe(logger2)
    })
  })

  describe('Transient Lifecycle', () => {
    it('should return new instance for transient', () => {
      container.registerTransient('logger', () => new SimpleLogger())

      const logger1 = container.resolve<SimpleLogger>('logger')
      const logger2 = container.resolve<SimpleLogger>('logger')

      expect(logger1).not.toBe(logger2)
      expect(logger1).toBeInstanceOf(SimpleLogger)
      expect(logger2).toBeInstanceOf(SimpleLogger)
    })

    it('should create new instance each time for transient', () => {
      let createCount = 0
      container.registerTransient('logger', () => {
        createCount++
        return new SimpleLogger()
      })

      container.resolve('logger')
      container.resolve('logger')
      container.resolve('logger')

      expect(createCount).toBe(3)
    })
  })

  describe('Scoped Lifecycle', () => {
    it('should return same instance within scope', () => {
      container.register('logger', () => new SimpleLogger(), 'scoped')

      const logger1 = container.resolve<SimpleLogger>('logger')
      const logger2 = container.resolve<SimpleLogger>('logger')

      expect(logger1).toBe(logger2)
    })

    it('should return different instances in different scopes', () => {
      container.register('logger', () => new SimpleLogger(), 'scoped')

      const scope1 = container.createScope()
      const scope2 = container.createScope()

      const logger1 = scope1.resolve<SimpleLogger>('logger')
      const logger2 = scope2.resolve<SimpleLogger>('logger')

      expect(logger1).not.toBe(logger2)
    })
  })

  describe('Instance Registration', () => {
    it('should register and resolve an instance', () => {
      const logger = new SimpleLogger()
      container.registerInstance('logger', logger)

      const resolved = container.resolve<SimpleLogger>('logger')
      expect(resolved).toBe(logger)
    })

    it('should return same instance for registered instance', () => {
      const logger = new SimpleLogger()
      container.registerInstance('logger', logger)

      const resolved1 = container.resolve<SimpleLogger>('logger')
      const resolved2 = container.resolve<SimpleLogger>('logger')

      expect(resolved1).toBe(logger)
      expect(resolved2).toBe(logger)
    })
  })

  describe('Dependency Injection', () => {
    it('should inject dependencies', () => {
      container.registerSingleton('logger', () => new SimpleLogger())
      container.registerSingleton('database', () => new SimpleDatabase())
      container.registerSingleton('userService', (c) => {
        const logger = c.resolve<Logger>('logger')
        const db = c.resolve<Database>('database')
        return new UserServiceImpl(logger, db)
      })

      const userService = container.resolve<UserServiceImpl>('userService')
      const result = userService.getUser('123')

      expect(result).toContain('SELECT * FROM users WHERE id = 123')
    })

    it('should share singleton dependencies', () => {
      container.registerSingleton('logger', () => new SimpleLogger())
      container.registerSingleton('service1', (c) => ({
        logger: c.resolve<SimpleLogger>('logger'),
      }))
      container.registerSingleton('service2', (c) => ({
        logger: c.resolve<SimpleLogger>('logger'),
      }))

      const service1 = container.resolve<any>('service1')
      const service2 = container.resolve<any>('service2')

      expect(service1.logger).toBe(service2.logger)
    })
  })

  describe('Async Resolution', () => {
    it('should resolve async factory', async () => {
      container.register('logger', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return new SimpleLogger()
      })

      const logger = await container.resolveAsync<SimpleLogger>('logger')
      expect(logger).toBeInstanceOf(SimpleLogger)
    })

    it('should cache async singleton', async () => {
      let createCount = 0
      container.registerSingleton('logger', async () => {
        createCount++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return new SimpleLogger()
      })

      const logger1 = await container.resolveAsync<SimpleLogger>('logger')
      const logger2 = await container.resolveAsync<SimpleLogger>('logger')

      expect(logger1).toBe(logger2)
      expect(createCount).toBe(1)
    })

    it('should throw error when using sync resolve with async factory', () => {
      container.register('logger', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return new SimpleLogger()
      })

      expect(() => container.resolve('logger')).toThrow()
    })

    it('should resolve sync factory with resolveAsync', async () => {
      container.register('logger', () => new SimpleLogger())

      const logger = await container.resolveAsync<SimpleLogger>('logger')
      expect(logger).toBeInstanceOf(SimpleLogger)
    })
  })

  describe('Scoped Containers', () => {
    it('should create child scope', () => {
      const scope = container.createScope()
      expect(scope).toBeInstanceOf(DIContainer)
      expect(scope).not.toBe(container)
    })

    it('should inherit parent registrations', () => {
      container.register('logger', () => new SimpleLogger())

      const scope = container.createScope()
      const logger = scope.resolve<SimpleLogger>('logger')

      expect(logger).toBeInstanceOf(SimpleLogger)
    })

    it('should not affect parent when registering in child', () => {
      const scope = container.createScope()
      scope.register('logger', () => new SimpleLogger())

      expect(scope.has('logger')).toBe(true)
      expect(container.has('logger')).toBe(false)
    })

    it('should override parent registration in child', () => {
      class ParentLogger extends SimpleLogger {}
      class ChildLogger extends SimpleLogger {}

      container.register('logger', () => new ParentLogger())
      const scope = container.createScope()
      scope.register('logger', () => new ChildLogger())

      const parentLogger = container.resolve<SimpleLogger>('logger')
      const childLogger = scope.resolve<SimpleLogger>('logger')

      expect(parentLogger).toBeInstanceOf(ParentLogger)
      expect(childLogger).toBeInstanceOf(ChildLogger)
    })
  })

  describe('Clear', () => {
    it('should clear all registrations', () => {
      container.register('logger', () => new SimpleLogger())
      container.register('database', () => new SimpleDatabase())

      expect(container.has('logger')).toBe(true)
      expect(container.has('database')).toBe(true)

      container.clear()

      expect(container.has('logger')).toBe(false)
      expect(container.has('database')).toBe(false)
    })

    it('should clear scoped instances', () => {
      container.register('logger', () => new SimpleLogger(), 'scoped')

      const logger1 = container.resolve<SimpleLogger>('logger')
      container.clear()

      // After clear, should throw because registration is gone
      expect(() => container.resolve('logger')).toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle circular dependencies gracefully', () => {
      container.register('serviceA', (c) => ({
        name: 'A',
        serviceB: c.resolve('serviceB'),
      }))

      container.register('serviceB', (c) => ({
        name: 'B',
        serviceA: c.resolve('serviceA'),
      }))

      // This will cause infinite recursion, but that's expected behavior
      // In real code, circular dependencies should be avoided
      expect(() => container.resolve('serviceA')).toThrow()
    })

    it('should handle null/undefined values', () => {
      container.register('nullValue', () => null)
      container.register('undefinedValue', () => undefined)

      expect(container.resolve('nullValue')).toBeNull()
      expect(container.resolve('undefinedValue')).toBeUndefined()
    })

    it('should handle primitive values', () => {
      container.register('string', () => 'hello')
      container.register('number', () => 42)
      container.register('boolean', () => true)

      expect(container.resolve('string')).toBe('hello')
      expect(container.resolve('number')).toBe(42)
      expect(container.resolve('boolean')).toBe(true)
    })
  })
})

describe('createContainer', () => {
  it('should create a new container', () => {
    const container = createContainer()
    expect(container).toBeInstanceOf(DIContainer)
  })

  it('should create independent containers', () => {
    const container1 = createContainer()
    const container2 = createContainer()

    container1.register('logger', () => new SimpleLogger())

    expect(container1.has('logger')).toBe(true)
    expect(container2.has('logger')).toBe(false)
  })
})

describe('createToken', () => {
  it('should create a unique symbol token', () => {
    const token1 = createToken('Logger')
    const token2 = createToken('Logger')

    expect(typeof token1).toBe('symbol')
    expect(token1).not.toBe(token2)
  })

  it('should work as service identifier', () => {
    const LoggerToken = createToken<Logger>('Logger')
    const container = createContainer()

    container.register(LoggerToken, () => new SimpleLogger())
    const logger = container.resolve(LoggerToken)

    expect(logger).toBeInstanceOf(SimpleLogger)
  })
})
