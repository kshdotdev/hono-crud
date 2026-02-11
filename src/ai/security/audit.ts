import type { AIAuditLogEntry, AIAuditLogStorage } from './types';
import { createNullableRegistry } from '../../storage/registry';

// ============================================================================
// Registry
// ============================================================================

const aiAuditRegistry = createNullableRegistry<AIAuditLogStorage>('aiAuditLogStorage');

export function setAIAuditStorage(storage: AIAuditLogStorage): void {
  aiAuditRegistry.set(storage);
}

export function getAIAuditStorage(): AIAuditLogStorage | null {
  return aiAuditRegistry.get();
}

export function resetAIAuditStorage(): void {
  aiAuditRegistry.reset();
}

// ============================================================================
// Memory Implementation
// ============================================================================

export class MemoryAIAuditLogStorage implements AIAuditLogStorage {
  private logs: AIAuditLogEntry[] = [];

  async store(entry: AIAuditLogEntry): Promise<void> {
    this.logs.push(entry);
  }

  getAll(): AIAuditLogEntry[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }
}
