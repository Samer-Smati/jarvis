import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './entities/audit-log.entity';

export interface ConfirmationRequest {
  id: string;
  conversationId: string;
  skillName: string;
  description: string;
  arguments: Record<string, unknown>;
}

interface PendingConfirmation {
  request: ConfirmationRequest;
  resolve: (approved: boolean) => void;
}

const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class GuardrailService {
  private readonly logger = new Logger(GuardrailService.name);
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
  ) {}

  /**
   * Pause the agent loop until the user approves or rejects the action.
   * `notify` is called with the request so the gateway can push it to the UI.
   */
  requestConfirmation(
    conversationId: string,
    skillName: string,
    args: Record<string, unknown>,
    notify: (request: ConfirmationRequest) => void,
  ): Promise<boolean> {
    const request: ConfirmationRequest = {
      id: randomUUID(),
      conversationId,
      skillName,
      description: `Skill "${skillName}" requires your approval before running.`,
      arguments: args,
    };
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        this.logger.warn(`Confirmation ${request.id} timed out — rejecting.`);
        resolve(false);
      }, CONFIRMATION_TIMEOUT_MS);

      this.pending.set(request.id, {
        request,
        resolve: (approved) => {
          clearTimeout(timeout);
          this.pending.delete(request.id);
          resolve(approved);
        },
      });
      notify(request);
    });
  }

  resolveConfirmation(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      return false;
    }
    entry.resolve(approved);
    return true;
  }

  pendingRequests(): ConfirmationRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  async audit(action: string, trigger: string, detail: string, outcome: string): Promise<void> {
    await this.auditLogs.save(this.auditLogs.create({ action, trigger, detail, outcome }));
  }

  async recentAudit(limit = 50): Promise<AuditLogEntity[]> {
    return this.auditLogs.find({ order: { createdAt: 'DESC' }, take: limit });
  }
}
