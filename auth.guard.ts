/**
 * BBH HMS – AuthGuard
 * Protects routes by verifying a valid Redis session exists.
 * Re-checks user.is_active on every request for instant revocation.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Allow routes decorated with @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = await this.authService.getSessionUser(request);

    if (!user) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    // Attach full user to request for downstream use
    request.user = user;
    return true;
  }
}

// ─── auth.guard.ts ────────────────────────────────────────────────────────────
// File above. Below is the RolesGuard in the same output file (separate export).
