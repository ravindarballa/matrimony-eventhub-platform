import { Controller, Get, Module } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import type { Connection } from 'mongoose';

import { Public } from '../../core/decorators.js';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  /** Liveness: the process is up. Used by ECS to decide whether to restart. */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', uptimeSec: Math.floor(process.uptime()) };
  }

  /**
   * Readiness: the process can serve traffic. The ALB uses this, so it must
   * check the database - a task that cannot reach Mongo should not be routed to.
   */
  @Public()
  @Get('ready')
  ready() {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    const ready = this.conn.readyState === 1;
    return {
      status: ready ? 'ok' : 'degraded',
      mongo: states[this.conn.readyState] ?? 'unknown',
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
