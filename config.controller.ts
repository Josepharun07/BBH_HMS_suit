/**
 * BBH HMS – Public Config Controller
 * GET /api/public/config – Returns hotel branding for the guest website.
 * No authentication required (decorated with @Public).
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../../libs/prisma/prisma.service';
import { Public } from '../../../libs/auth/decorators/public.decorator';
import { AuthGuard } from '../../../libs/auth/auth.guard';
import { RolesGuard } from '../../../libs/auth/roles.guard';
import { Roles } from '../../../libs/auth/roles.guard';
import { Role } from '@prisma/client';

// ─── Public Endpoint ──────────────────────────────────────────────────────────

@Controller('public')
export class PublicConfigController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the hotel's public branding config.
   * Used by the guest website header on every page load.
   */
  @Public()
  @Get('config')
  async getPublicConfig() {
    const config = await this.prisma.globalConfig.findFirst();
    return {
      hotelName: config?.hotel_name ?? 'BBH Hotel',
      logoUrl: config?.logo_url ?? null,
      primaryColor: config?.primary_color ?? '#1a56db',
      accentColor: config?.accent_color ?? '#7e3af2',
      currency: config?.currency ?? 'USD',
      timezone: config?.timezone ?? 'UTC',
      tagline: config?.tagline ?? null,
      address: config?.address ?? null,
      phone: config?.phone ?? null,
      email: config?.email ?? null,
    };
  }
}

// ─── Admin Config Controller ──────────────────────────────────────────────────

import {
  Body,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
} from '@nestjs/common';
import { IsOptional, IsString, IsBoolean, MaxLength } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../../../libs/audit/audit.service';

class UpdateConfigDto {
  @IsOptional() @IsString() @MaxLength(100) hotel_name?: string;
  @IsOptional() @IsString() @MaxLength(500) logo_url?: string;
  @IsOptional() @IsString() @MaxLength(7)   primary_color?: string;
  @IsOptional() @IsString() @MaxLength(7)   accent_color?: string;
  @IsOptional() @IsString() @MaxLength(3)   currency?: string;
  @IsOptional() @IsString() @MaxLength(50)  timezone?: string;
  @IsOptional() @IsBoolean()                maintenance_mode?: boolean;
  @IsOptional() @IsString() @MaxLength(255) tagline?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(50)  phone?: string;
  @IsOptional() @IsString() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(500) website_footer?: string;
}

@Controller('admin/config')
@UseGuards(AuthGuard, RolesGuard)
export class ConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(Role.OWNER, Role.MANAGER)
  async getConfig() {
    return this.prisma.globalConfig.findFirst();
  }

  @Patch()
  @Roles(Role.OWNER, Role.MANAGER)
  @HttpCode(HttpStatus.OK)
  async updateConfig(@Body() dto: UpdateConfigDto, @Req() req: FastifyRequest) {
    const current = await this.prisma.globalConfig.findFirst();
    const updated = await this.prisma.globalConfig.update({
      where: { id: current!.id },
      data: dto,
    });

    await this.audit.log({
      action: 'CONFIG_UPDATE',
      resource: 'GlobalConfig',
      resourceId: current!.id,
      oldValue: current as any,
      newValue: updated as any,
      performedById: (req as any).user?.id,
      ipAddress: req.ip,
    });

    return updated;
  }
}
