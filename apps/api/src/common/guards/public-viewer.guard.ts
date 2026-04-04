import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/roles.decorator';

@Injectable()
export class PublicViewerGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Only active when PUBLIC_MODE is enabled
    if (process.env.PUBLIC_MODE !== 'true') return true;

    const request = context.switchToHttp().getRequest();

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
      // Check if there's a real JWT user (not public-viewer)
      if (!request.user?.id || request.user.id === 'public-viewer') {
        throw new ForbiddenException('Read-only mode');
      }
      return true;
    }

    // For GET requests without auth, inject virtual VIEWER user
    if (!request.user?.id) {
      const orgId = process.env.PUBLIC_VIEWER_ORG_ID;
      if (!orgId) throw new ForbiddenException('Public viewer not configured');

      request.user = {
        id: 'public-viewer',
        email: 'viewer@public',
        role: 'VIEWER',
        orgId,
      };
    }

    return true;
  }
}
