/**
 * BBH HMS – AuditService
 * Write-only audit log. Never updated, never deleted.
 * All significant actions flow through here for compliance and duty logs.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogInput {
  action: string;
  resource: string;
  resourceId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  performedById?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          resource: input.resource,
          resource_id: input.resourceId,
          old_value: input.oldValue as any,
          new_value: input.newValue as any,
          performed_by_id: input.performedById,
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        },
      });
    } catch (error: any) {
      // Audit logging must never crash the main flow
      this.logger.error(`Failed to write audit log: ${error.message}`, {
        input,
      });
    }
  }

  async findByResource(resource: string, resourceId?: string) {
    return this.prisma.auditLog.findMany({
      where: { resource, ...(resourceId ? { resource_id: resourceId } : {}) },
      orderBy: { timestamp: 'desc' },
      include: { performed_by: { select: { first_name: true, last_name: true, email: true } } },
      take: 100,
    });
  }

  async findByUser(userId: string) {
    return this.prisma.auditLog.findMany({
      where: { performed_by_id: userId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
  }
}
