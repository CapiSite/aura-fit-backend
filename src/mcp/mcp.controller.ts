import { Controller, Get, Post, Param, Body } from '@nestjs/common'
import { McpService } from './mcp.service'

@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Get('health')
  health() {
    return this.mcp.health()
  }

  @Get('tools')
  listTools() {
    return { tools: this.mcp.getTools() }
  }

  @Post('tools/:name/call')
  callTool(@Param('name') name: string, @Body() body: any) {
    return this.mcp.callTool(name, body)
  }
}
