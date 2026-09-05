import { Controller, Get, Module } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import type { Connection } from 'mongoose';

import { ConfigService } from '@nestjs/config';

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

/**
 * The API root.
 *
 * Without this, opening the base URL in a browser returns Express's bare
 * "Cannot GET /api/v1", which reads as a broken server rather than as the
 * correct answer to asking for a path nothing is mapped to. Five lines to say
 * what this service is and where to go instead.
 */
@ApiTags('health')
@Controller()
class RootController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get()
  index() {
    const prefix = this.config.get<string>('apiPrefix', 'api');
    return {
      name: 'Matrimony EventHub API',
      version: '1.0',
      environment: this.config.get<string>('nodeEnv', 'development'),
      docs: `/${prefix}/docs`,
      health: {
        live: `/${prefix}/v1/health/live`,
        ready: `/${prefix}/v1/health/ready`,
      },
      web: this.config.get<string>('corsOrigin', 'http://localhost:4200'),
    };
  }
}

@Module({ controllers: [RootController, HealthController] })
export class HealthModule {}
