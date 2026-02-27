/**
 * BBH HMS – Decorators
 */

// ─── public.decorator.ts ──────────────────────────────────────────────────────
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route as publicly accessible (no session required).
 * @example @Public()
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);


// ─── current-user.decorator.ts ────────────────────────────────────────────────
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';

/**
 * Extracts the authenticated user from the request object.
 * @example login(@CurrentUser() user: User) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
