import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
const { getCorsOrigins, getPort } = require('../config');

async function bootstrap() {
  // Desactivamos el body-parser por defecto (límite 100kb) y lo reconfiguramos con un límite
  // mayor: el guardado de mapeos (Estandarizar Items/Bancos) envía toda la tabla en un solo
  // JSON y superaba los 100kb -> 413 "request entity too large".
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  console.log('🔧 Configurando CORS...');
  
  // Configuración de CORS más permisiva
  app.enableCors({
    origin: getCorsOrigins() as string[],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200,
    preflightContinue: false
  });
  
  
  
  const port = getPort();
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Application is running on: http://0.0.0.0:${port}`);
}

bootstrap();
