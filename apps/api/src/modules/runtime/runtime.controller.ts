import { Controller, Post, Get, Patch, Body, Param } from '@nestjs/common';
import { RuntimeService } from './runtime.service';

@Controller('agents')
export class RuntimeController {
  constructor(private runtimeService: RuntimeService) {}

  @Post(':id/execute')
  execute(
    @Param('id') id: string,
    @Body() body: { message: string; triggerType?: string; triggerId?: string },
  ) {
    return this.runtimeService.execute(id, body.message, {
      type: body.triggerType ?? 'MANUAL',
      id: body.triggerId,
    });
  }

  @Get(':id/builtin-tools')
  getBuiltinTools(@Param('id') id: string) {
    return this.runtimeService.getBuiltinToolNames(id);
  }

  @Patch(':id/builtin-tools')
  toggleBuiltinTool(
    @Param('id') id: string,
    @Body() body: { toolName: string; enabled: boolean },
  ) {
    return this.runtimeService.toggleBuiltinTool(id, body.toolName, body.enabled);
  }
}
