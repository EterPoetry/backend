import { NestFactory, BaseExceptionFilter } from '@nestjs/core';
import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

interface RawBodyRequest extends express.Request {
  rawBody?: Buffer | string;
}

type WebhookResponse = express.Response;
type WebhookNext = express.NextFunction;

@Catch()
class WebhookExceptionLoggingFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('WebhookException');

  override catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<express.Request | undefined>();

    if (request?.originalUrl === '/payments/webhook') {
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
      const response =
        exception instanceof HttpException ? exception.getResponse() : '[non-http exception]';
      const message =
        typeof response === 'string' ? response : JSON.stringify(response);

      this.logger.error(
        `Webhook request failed method=${request.method} path=${request.originalUrl} statusCode=${status} reason=${message}`,
      );
    }

    super.catch(exception, host);
  }
}

function formatWebhookBody(req: RawBodyRequest): string {
  if (typeof req.rawBody === 'string') {
    return req.rawBody;
  }

  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString('utf8');
  }

  if (req.body === undefined) {
    return '[no body]';
  }

  try {
    return JSON.stringify(req.body);
  } catch {
    return '[unserializable body]';
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
  const logger = new Logger('Bootstrap');
  const trustProxy = (process.env.TRUST_PROXY ?? '').toLowerCase();
  const storageDriver = (process.env.FILE_STORAGE_DRIVER ?? 'local').toLowerCase();

  app.use(cookieParser());
  app.use('/payments/webhook', (req: RawBodyRequest, res: WebhookResponse, next: WebhookNext) => {
    const body = formatWebhookBody(req);
    const signatureHeader = req.header('x-sign') ?? 'missing';
    const contentType = req.header('content-type') ?? 'missing';
    const contentLength = req.header('content-length') ?? 'missing';

    logger.log(
      `Incoming payments webhook method=${req.method} path=${req.originalUrl} contentType=${contentType} contentLength=${contentLength} signature=${signatureHeader} body=${body}`,
    );

    res.on('finish', () => {
      logger.log(
        `Completed payments webhook method=${req.method} path=${req.originalUrl} statusCode=${res.statusCode}`,
      );
    });

    next();
  });

  if (storageDriver === 'local') {
    const uploadsRoot = join(process.cwd(), 'uploads');
    mkdirSync(uploadsRoot, { recursive: true });
    app.use('/uploads', express.static(uploadsRoot));
  }

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
  app.useGlobalFilters(new WebhookExceptionLoggingFilter());

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
      .addTag('Complaints', 'Complaint reasons and complaint submission helpers')
      .addBearerAuth()
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig, {
      autoTagControllers: false,
    });
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
