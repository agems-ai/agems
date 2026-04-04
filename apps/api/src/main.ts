import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: [
      process.env.WEB_URL || 'http://localhost:3000',
      'https://agems.ai',
      'https://open.agems.ai',
      /\.agems\.ai$/,
    ],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  console.log(`AGEMS API running on http://localhost:${port}`);
}
bootstrap();
