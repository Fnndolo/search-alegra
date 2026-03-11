import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  console.log('🔧 Configurando CORS...');
  
  // Configuración de CORS más permisiva
  app.enableCors({
    origin: [
      process.env.FRONTEND_ORIGIN,
      'http://localhost:4200',
      'https://search-alegra-production-5eed.up.railway.app',
      'https://amusing-simplicity-production.up.railway.app',
      'http://localhost:3000',
      'http://127.0.0.1:4200'
    ].filter(Boolean) as string[],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200,
    preflightContinue: false
  });
  
  
  
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Application is running on: http://0.0.0.0:${port}`);
}

bootstrap();
