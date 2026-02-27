/**
 * BBH HMS – AppModule
 * Root module. Initializes GlobalConfig seed on startup.
 */

import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from '../../libs/auth/auth.module';
import { StorageModule } from '../../libs/storage/storage.module';
import { AuditModule } from '../../libs/audit/audit.module';
import { PrismaModule } from '../../libs/prisma/prisma.module';
import { PrismaService } from '../../libs/prisma/prisma.service';
import { ConfigController } from './config/config.controller';
import { ConfigService as HmsConfigService } from './config/config.service';
import { UpdaterModule } from '../../libs/updater/updater.module';

@Module({
  imports: [
    // ── Environment ─────────────────────────────────────────────────────
    ConfigModule.forRoot({ isGlobal: true }),

    // ── Structured Logging ───────────────────────────────────────────────
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        redact: ['req.headers.cookie', 'req.headers.authorization'],
      },
    }),

    // ── Core Modules ─────────────────────────────────────────────────────
    PrismaModule,
    AuditModule,
    AuthModule,
    StorageModule,
    UpdaterModule,
  ],
  controllers: [ConfigController],
  providers: [HmsConfigService],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seed GlobalConfig if it doesn't exist yet.
   * Called once on application startup.
   */
  async onModuleInit(): Promise<void> {
    const existing = await this.prisma.globalConfig.count();

    if (existing === 0) {
      await this.prisma.globalConfig.create({
        data: {
          hotel_name: 'BBH Hotel',
          currency: 'USD',
          timezone: 'UTC',
          maintenance_mode: false,
          primary_color: '#1a56db',
          accent_color: '#7e3af2',
        },
      });
      this.logger.log('GlobalConfig seeded with default values');
    }

    // Seed default module states
    const { ModuleName } = await import('@prisma/client');
    const modulesToSeed = Object.values(ModuleName);

    for (const moduleName of modulesToSeed) {
      await this.prisma.moduleState.upsert({
        where: { module_name: moduleName },
        update: {},
        create: { module_name: moduleName, is_enabled: false },
      });
    }

    this.logger.log(`BBH HMS API started. Environment: ${process.env.NODE_ENV}`);
  }
}
