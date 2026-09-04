import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // The raw body is required to verify the Razorpay webhook HMAC. A parsed and
    // re-stringified body will not match the signature.
    rawBody: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('port', 3000);
  const prefix = config.get<string>('apiPrefix', 'api');

  app.use(helmet());

  app.enableCors({
    origin: config.get<string>('corsOrigin', 'http://localhost:4200'),
    credentials: true, // required for the httpOnly refresh cookie
  });

  // Prefix, versioning, cookie parsing and validation - shared with the e2e tests.
  configureApp(app, { prefix });

  if (config.get<string>('nodeEnv') !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('Matrimony EventHub API')
      .setDescription('Matrimony and wedding event management platform')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth')
      .addTag('matrimony')
      .addTag('events')
      .addTag('vendors')
      .addTag('payments')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }

  app.enableShutdownHooks();

  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${port}/${prefix}/v1`);
  logger.log(`Swagger at http://localhost:${port}/api/docs`);
}

void bootstrap();
