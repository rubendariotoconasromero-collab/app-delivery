import 'reflect-metadata';
import { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('AppDelivery API')
      .setDescription(
        'Loop 2: phone identity, staff MFA sessions, permissions and driver onboarding.',
      )
      .setVersion('0.2.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Opaque mobile session token' })
      .addCookieAuth('appdelivery_admin')
      .build(),
  );
}

export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: app.get(AppConfig).values.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  });
  SwaggerModule.setup('api/docs', app, createOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
  });
}

export async function createApplication(
  options: NestApplicationOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, options);
  configureApplication(app);
  return app;
}
