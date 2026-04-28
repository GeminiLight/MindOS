import type { Result } from '../../foundation/shared/index.js';
import { AppError, createError } from '../../foundation/errors/index.js';
import type { IFileSystem } from '../storage/index.js';
import * as path from 'path';

// Helper functions for Result type
function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: Error): Result<T> {
  return { ok: false, error };
}

/**
 * Space metadata
 */
export interface SpaceMetadata {
  name: string;
  path: string;
  createdAt: Date;
  modifiedAt: Date;
}

/**
 * Space creation options
 */
export interface CreateSpaceOptions {
  /** Whether to create default scaffold files (INSTRUCTION.md, README.md) */
  scaffold?: boolean;
  /** Custom instruction content */
  instruction?: string;
  /** Custom README content */
  readme?: string;
}

function validateSpaceName(name: string): Result<string> {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed !== name ||
    path.isAbsolute(trimmed) ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('..')
  ) {
    return err(
      createError('VALIDATION_ERROR', 'Space name must be a single safe path segment', {
        context: { name },
      })
    );
  }

  return ok(trimmed);
}

/**
 * Space manager for creating and managing MindOS spaces
 */
export class SpaceManager {
  constructor(
    private fs: IFileSystem,
    private rootPath: string
  ) {}

  /**
   * Create a new space
   */
  async createSpace(
    name: string,
    options: CreateSpaceOptions = {}
  ): Promise<Result<SpaceMetadata>> {
    const nameResult = validateSpaceName(name);
    if (!nameResult.ok) {
      return err(nameResult.error);
    }

    const safeName = nameResult.value;
    const spacePath = path.join(this.rootPath, safeName);

    // Check if space already exists
    const existsResult = await this.fs.exists(spacePath);
    if (!existsResult.ok) {
      return err(existsResult.error);
    }
    if (existsResult.value) {
      return err(
        createError('CONFLICT', 'Space already exists', { context: { name, path: spacePath } })
      );
    }

    // Create space directory
    const createResult = await this.fs.mkdir(spacePath, true);
    if (!createResult.ok) {
      return err(createResult.error);
    }

    // Create scaffold files if requested
    if (options.scaffold !== false) {
      const instructionResult = await this._createInstruction(spacePath, options.instruction);
      if (!instructionResult.ok) {
        return err(instructionResult.error);
      }

      const readmeResult = await this._createReadme(spacePath, name, options.readme);
      if (!readmeResult.ok) {
        return err(readmeResult.error);
      }
    }

    const now = new Date();
    return ok({
      name: safeName,
      path: spacePath,
      createdAt: now,
      modifiedAt: now,
    });
  }

  /**
   * Delete a space
   */
  async deleteSpace(name: string): Promise<Result<void>> {
    const nameResult = validateSpaceName(name);
    if (!nameResult.ok) {
      return err(nameResult.error);
    }

    const safeName = nameResult.value;
    const spacePath = path.join(this.rootPath, safeName);

    // Check if space exists
    const existsResult = await this.fs.exists(spacePath);
    if (!existsResult.ok) {
      return err(existsResult.error);
    }
    if (!existsResult.value) {
      return err(
        createError('NOT_FOUND', 'Space not found', { context: { name, path: spacePath } })
      );
    }

    // Delete the space directory
    return await this.fs.remove(spacePath, true);
  }

  /**
   * Rename a space
   */
  async renameSpace(oldName: string, newName: string): Promise<Result<SpaceMetadata>> {
    const oldNameResult = validateSpaceName(oldName);
    if (!oldNameResult.ok) {
      return err(oldNameResult.error);
    }

    const newNameResult = validateSpaceName(newName);
    if (!newNameResult.ok) {
      return err(newNameResult.error);
    }

    const safeOldName = oldNameResult.value;
    const safeNewName = newNameResult.value;
    const oldPath = path.join(this.rootPath, safeOldName);
    const newPath = path.join(this.rootPath, safeNewName);

    // Check if old space exists
    const existsResult = await this.fs.exists(oldPath);
    if (!existsResult.ok) {
      return err(existsResult.error);
    }
    if (!existsResult.value) {
      return err(
        createError('NOT_FOUND', 'Space not found', { context: { name: oldName, path: oldPath } })
      );
    }

    // Check if new space already exists
    const newExistsResult = await this.fs.exists(newPath);
    if (!newExistsResult.ok) {
      return err(newExistsResult.error);
    }
    if (newExistsResult.value) {
      return err(
        createError('CONFLICT', 'Target space already exists', {
          context: { name: newName, path: newPath }
        })
      );
    }

    // Move the directory
    const moveResult = await this.fs.move(oldPath, newPath);
    if (!moveResult.ok) {
      return err(moveResult.error);
    }

    const now = new Date();
    return ok({
      name: safeNewName,
      path: newPath,
      createdAt: now,
      modifiedAt: now,
    });
  }

  /**
   * List all spaces
   */
  async listSpaces(): Promise<Result<SpaceMetadata[]>> {
    const listResult = await this.fs.readdir(this.rootPath);
    if (!listResult.ok) {
      return err(listResult.error);
    }

    const spaces: SpaceMetadata[] = [];
    for (const entry of listResult.value) {
      if (entry.isDirectory) {
        const statResult = await this.fs.stat(entry.path);
        if (statResult.ok) {
          spaces.push({
            name: entry.name,
            path: entry.path,
            createdAt: statResult.value.createdAt,
            modifiedAt: statResult.value.modifiedAt,
          });
        }
      }
    }

    return ok(spaces);
  }

  /**
   * Get space metadata
   */
  async getSpace(name: string): Promise<Result<SpaceMetadata>> {
    const nameResult = validateSpaceName(name);
    if (!nameResult.ok) {
      return err(nameResult.error);
    }

    const safeName = nameResult.value;
    const spacePath = path.join(this.rootPath, safeName);

    const statResult = await this.fs.stat(spacePath);
    if (!statResult.ok) {
      return err(statResult.error);
    }

    const stat = statResult.value;
    if (!stat.isDirectory) {
      return err(
        createError('VALIDATION_ERROR', 'Path is not a directory', { context: { name, path: spacePath } })
      );
    }

    return ok({
      name: safeName,
      path: spacePath,
      createdAt: stat.createdAt,
      modifiedAt: stat.modifiedAt,
    });
  }

  /**
   * Create INSTRUCTION.md file
   */
  private async _createInstruction(
    spacePath: string,
    customContent?: string
  ): Promise<Result<void>> {
    const instructionPath = path.join(spacePath, 'INSTRUCTION.md');
    const content =
      customContent ||
      `# Instructions

This is your space instruction file. Add guidelines, rules, or context that should be considered when working in this space.

## Purpose

Describe the purpose of this space.

## Guidelines

- Add your guidelines here
- Keep them clear and actionable
`;

    return await this.fs.writeFile(instructionPath, content);
  }

  /**
   * Create README.md file
   */
  private async _createReadme(
    spacePath: string,
    spaceName: string,
    customContent?: string
  ): Promise<Result<void>> {
    const readmePath = path.join(spacePath, 'README.md');
    const content =
      customContent ||
      `# ${spaceName}

Welcome to the ${spaceName} space.

## Overview

Add an overview of this space here.

## Contents

- Add links to important files
- Organize your content
`;

    return await this.fs.writeFile(readmePath, content);
  }
}

/**
 * Create a new space manager
 */
export function createSpaceManager(fs: IFileSystem, rootPath: string): SpaceManager {
  return new SpaceManager(fs, rootPath);
}
