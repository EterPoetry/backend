import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const trustProxy = (process.env.TRUST_PROXY ?? '').toLowerCase();

  app.use(cookieParser());
  const uploadsRoot = join(process.cwd(), 'uploads');
  mkdirSync(uploadsRoot, { recursive: true });
  app.use('/uploads', express.static(uploadsRoot));

  if (trustProxy === '1' || trustProxy === 'true' || trustProxy === 'yes') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  try {
    // Keep app bootable when swagger packages are not installed yet.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
    const swaggerPath = process.env.SWAGGER_PATH ?? 'api/docs';

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Eter Poetry API')
      .setDescription('API documentation for Eter Poetry backend')
      .setVersion('1.0.0')
      .addTag('Authentication', 'Registration, login, token refresh, and logout')
      .addTag('Google Auth', 'Google OAuth flows for web and mobile clients')
      .addTag('Password Recovery', 'Password reset request and password reset completion')
      .addTag('Email Verification', 'Email verification code delivery and confirmation')
      .addTag('Profile', 'Current user profile management and statistics')
      .addBearerAuth()
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(swaggerPath, app, swaggerDocument, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  } catch {
    logger.warn(
      'Swagger is disabled: install @nestjs/swagger and swagger-ui-express to enable API docs.',
    );
  }

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
