import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/roles.decorator';

@Injectable()
export class PublicViewerGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Only active when PUBLIC_MODE is enabled
    if (process.env.PUBLIC_MODE !== 'true') return true;

    const request = context.switchToHttp().getRequest();

    // Try to detect JWT token early (before JwtAuthGuard runs)
    if (!request.user?.id) {
      const authHeader = request.headers?.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const token = authHeader.slice(7);
          const payload = this.jwtService.verify(token);
          if (payload?.sub) {
            // Valid JWT — let JwtAuthGuard handle normally
            return true;
          }
        } catch {
          // Invalid token — let JwtAuthGuard handle the error
          return true;
        }
      }
    }

    // If request already has auth (admin logged in via JWT), let it through
    if (request.user?.id && request.user.id !== 'public-viewer') return true;

    // Check if route is marked @Public() (login, register, health)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const method = request.method?.toUpperCase();
    const path = request.url || '';

    // Allow auth routes for admin login
    if (path.startsWith('/api/auth/')) return true;

    // Block all mutations for unauthenticated users
    if (method !== 'GET') {
      throw new ForbiddenException('Read-only mode');
    }

    // For GET requests without auth, inject virtual VIEWER user
    const orgId = process.env.PUBLIC_VIEWER_ORG_ID;
    if (!orgId) throw new ForbiddenException('Public viewer not configured');

    request.user = {
      id: 'public-viewer',
      email: 'viewer@public',
      role: 'VIEWER',
      orgId,
    };

    return true;
  }
}
