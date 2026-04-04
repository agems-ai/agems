import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Strips sensitive fields from ALL API responses when the user is a VIEWER (public read-only mode).
 * This is a defense-in-depth measure — even if individual controllers forget to filter,
 * this interceptor ensures no secrets leak to public viewers.
 */

const SENSITIVE_FIELDS = [
  'systemPrompt', 'system_prompt',
  'telegramConfig', 'telegram_config',
  'llmConfig', 'llm_config',
  'runtimeConfig', 'runtime_config',
  'adapterConfig', 'adapter_config',
  'passwordHash', 'password_hash',
  'n8n_api_key', 'n8nApiKey',
  'botToken', 'bot_token',
  'apiKey', 'api_key',
  'secretKey', 'secret_key',
  'accessToken', 'access_token',
  'refreshToken', 'refresh_token',
  'authConfig', 'auth_config',
  'webhook_secret', 'webhookSecret',
  'stripe_secret', 'stripeSecret',
  'snapshot', // config revision snapshots contain full prompts
];

function sanitize(data: any): any {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return data.map(sanitize);
  if (typeof data !== 'object') return data;
  if (data instanceof Date) return data;

  const clean: any = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      // Replace with redacted marker
      if (typeof value === 'string') {
        clean[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        clean[key] = { _redacted: true };
      } else {
        clean[key] = '[REDACTED]';
      }
    } else {
      clean[key] = sanitize(value);
    }
  }
  return clean;
}

@Injectable()
export class ViewerSanitizeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const isViewer = request.user?.role === 'VIEWER';

    if (!isViewer) return next.handle();

    return next.handle().pipe(map((data) => sanitize(data)));
  }
}
