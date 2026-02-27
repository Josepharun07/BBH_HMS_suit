/**
 * BBH HMS – API Bootstrap (main.ts)
 * NestJS with Fastify adapter, Redis sessions, CORS, and structured logging.
 */

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import fastifySession from '@fastify/session';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import connectRedis from 'connect-redis';
import { createClient } from 'redis';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { PrismaService } from '../libs/prisma/prisma.service';

async function bootstrap(): Promise<void> {
  // ── Fastify Adapter ─────────────────────────────────────────────────────
  const adapter = new FastifyAdapter({
    logger: false, // Disabled in favour of Pino via nestjs-pino
    trustProxy: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: true },
  );

  // ── Structured Logging (Pino) ──────────────────────────────────────────
  app.useLogger(app.get(Logger));

  // ── Security Headers ───────────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', `storage.${process.env.DOMAIN}`],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });

  // ── Cookies ────────────────────────────────────────────────────────────
  await app.register(fastifyCookie);

  // ── Redis Session Store ────────────────────────────────────────────────
  const redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 2000) },
  });
  await redisClient.connect();

  const RedisStore = connectRedis(fastifySession as any);

  await app.register(fastifySession, {
    store: new RedisStore({ client: redisClient as any, prefix: 'sess:' }),
    secret: process.env.SESSION_SECRET!,
    cookie: {
      httpOnly: true,              // No JS access to cookie
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours (one work shift)
      path: '/',
    },
    saveUninitialized: false,
    rolling: true,               // Reset expiry on each request
  });

  // ── CORS ───────────────────────────────────────────────────────────────
  app.enableCors({
    origin: [
      `https://${process.env.DOMAIN}`,           // Public website
      `https://admin.${process.env.DOMAIN}`,     // Admin panel
    ],
    credentials: true,                           // Allow cookies cross-origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  });

  // ── Validation Pipeline ────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,             // Strip unknown fields
      forbidNonWhitelisted: true,  // Throw on unknown fields
      transform: true,             // Auto-transform to DTO types
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── API Prefix ─────────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Graceful Shutdown ──────────────────────────────────────────────────
  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  process.on('SIGTERM', async () => {
    await redisClient.quit();
    await app.close();
    process.exit(0);
  });

  // ── Start Server ───────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT ?? '3333', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`BBH HMS API running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start BBH HMS API:', err);
  process.exit(1);
});
