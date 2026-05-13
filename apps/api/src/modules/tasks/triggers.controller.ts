import {
  Controller, Get, Post, Patch, Delete, Body, Param, Request,
  Req, Res, HttpCode, BadRequestException,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { TriggersService } from './triggers.service';
import { Public } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/types';

@Controller('triggers')
export class TriggersController {
  constructor(private triggers: TriggersService) {}

  // ── Authenticated management endpoints (CRUD) ────────────────

  @Post()
  create(
    @Body() body: {
      taskId: string;
      kind?: 'WEBHOOK' | 'GMAIL' | 'N8N';
      authKind?: 'HMAC' | 'BEARER' | 'NONE';
      signatureHeader?: string;
      metadata?: Record<string, unknown>;
    },
    @Request() req: { user: RequestUser },
  ) {
    if (!body?.taskId) throw new BadRequestException('taskId is required');
    return this.triggers.create(body, req.user.orgId, req.user.id);
  }

  @Get()
  findAll(@Request() req: { user: RequestUser }, @Param('taskId') taskId?: string) {
    return this.triggers.findAll(req.user.orgId, taskId);
  }

  @Patch(':id/enabled')
  setEnabled(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
    @Request() req: { user: RequestUser },
  ) {
    return this.triggers.setEnabled(id, !!body.enabled, req.user.orgId, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.triggers.delete(id, req.user.orgId, req.user.id);
  }

  // ── PUBLIC fire endpoint (signature-protected) ───────────────

  /**
   * POST /api/triggers/:slug
   *
   * Public — auth is delegated to the per-trigger signature scheme
   * (HMAC / BEARER / NONE). 401 on failure regardless of reason so
   * attackers can't distinguish "slug doesn't exist" from "bad signature".
   *
   * Raw body is required for HMAC verification. The framework's JSON
   * parser would already have consumed and re-stringified the body,
   * which can change whitespace and break the signature. To minimise
   * the change footprint we accept that limitation here (the verifier
   * uses what Express parsed) — for high-security webhooks the caller
   * should use BEARER auth instead until raw-body middleware lands.
   */
  @Post(':slug')
  @Public()
  @HttpCode(200)
  async fire(
    @Param('slug') slug: string,
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
    @Body() body: unknown,
  ) {
    // Reconstruct a body string that matches what we'd HMAC.
    // NOTE: matches the JSON-stringified form, NOT the original raw
    // bytes — see method docstring.
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    const result = await this.triggers.fireBySlug({
      slug,
      body: bodyString,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });

    if (!result.ok) {
      res.status(401).json({ ok: false });
      return;
    }
    res.status(200).json({ ok: true, taskId: result.taskId });
  }
}
