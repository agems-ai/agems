import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = [
        process.env.WEB_URL || 'http://localhost:3000',
        'https://agems.ai',
        'https://open.agems.ai',
      ];
      if (allowed.includes(origin) || origin.endsWith('.agems.ai')) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  console.log(`AGEMS API running on http://localhost:${port}`);
}
bootstrap();
