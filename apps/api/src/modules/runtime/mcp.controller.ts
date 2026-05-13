import {
  Controller, Post, Req, Res, HttpCode, BadRequestException,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { PrismaService } from '../../config/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { Public } from '../../common/decorators/roles.decorator';
import { dispatch } from './mcp-dispatch';
import { buildToolCatalog } from './mcp-tools';

/**
 * AGEMS MCP-server endpoint.
 *
 * POST /api/mcp/v1
 *   Body: JSON-RPC 2.0 envelope (initialize / ping / tools/list / tools/call)
 *   Auth: shared MCP token in `Authorization: Bearer <token>` header,
 *         compared against settings `mcp_token` per org.
 *
 * The endpoint is @Public() at the framework guard layer — auth lives
 * inside the controller because MCP uses Bearer-token semantics, not
 * the platform's JWT. orgId is resolved from a per-org settings entry.
 *
 * Tools have visibility into the resolved orgId via the dispatch
 * context, so they can scope reads / writes to one tenant only.
 */
@Controller('mcp/v1')
export class McpController {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  @Post()
  @Public()
  @HttpCode(200)
  async handle(@Req() req: ExpressRequest, @Res() res: ExpressResponse) {
    const orgId = await this.resolveOrgFromToken(req);
    const tools = buildToolCatalog(this.prisma as any);
    const body = req.body;
    if (typeof body !== 'object' || body === null) {
      throw new BadRequestException('JSON body required');
    }
    const response = await dispatch(body, tools, {
      serverInfo: { name: 'agems', version: '1.0.0' },
      orgId,
    });
    res.status(200).json(response);
  }

  /**
   * Find the org whose `mcp_token` setting matches the Bearer in the
   * request. Returns undefined for missing / invalid token — the
   * dispatcher's tools will then reject orgId-gated calls with a clean
   * JSON-RPC error.
   */
  private async resolveOrgFromToken(req: ExpressRequest): Promise<string | undefined> {
    const auth = req.headers['authorization'];
    const headerValue = Array.isArray(auth) ? auth[0] : auth;
    if (!headerValue) return undefined;
    const match = /^Bearer\s+(\S+)$/i.exec(headerValue);
    if (!match) return undefined;
    const token = match[1];

    // Lookup token in Settings table — same place LLM API keys live.
    // Each org configures its own mcp_token (or admin sets one for them).
    const matchingSetting = await this.prisma.setting.findFirst({
      where: { key: 'mcp_token', value: token },
      select: { orgId: true },
    });
    return matchingSetting?.orgId ?? undefined;
  }
}
