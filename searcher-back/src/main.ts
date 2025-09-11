import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Configuración de CORS más permisiva
  app.enableCors({
    origin: [
      process.env.FRONTEND_ORIGIN || 'http://localhost:4200', 
      'http://localhost:4200',
      'https://amusing-simplicity-production.up.railway.app',
      'http://localhost:3000',
      'http://127.0.0.1:4200',
      // Permitir cualquier origen en desarrollo
      ...(process.env.NODE_ENV !== 'production' ? ['*'] : [])
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200,
    preflightContinue: false
  });
  
  
  
  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();
