import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS (filtra undefined pra não passar valor inválido)
  const allowedOrigins = ['http://localhost:3000', process.env.FRONTEND_URL].filter(Boolean) as string[];
  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  const port = parseInt(process.env.PORT ?? '3000');
  await app.listen(port, '0.0.0.0');

  console.log(`Server listening:${port}`);
}

bootstrap();
