import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Log de variables de entorno importantes para debugging
  console.log('🚀 Environment Variables Check:');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('PORT:', process.env.PORT);
  console.log('FRONTEND_ORIGIN:', process.env.FRONTEND_ORIGIN);
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'CONFIGURED' : 'NOT CONFIGURED');
  console.log('ALEGRA_API_URL:', process.env.ALEGRA_API_URL);
  console.log('ALEGRA_BILLS_API_URL:', process.env.ALEGRA_BILLS_API_URL);
  console.log('PASTO_API_KEY:', process.env.PASTO_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED');
  console.log('MEDELLIN_API_KEY:', process.env.MEDELLIN_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED');
  console.log('ARMENIA_API_KEY:', process.env.ARMENIA_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED');
  console.log('PEREIRA_API_KEY:', process.env.PEREIRA_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED');
  
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
  
  console.log('🌐 CORS configured with origins:', [
    process.env.FRONTEND_ORIGIN || 'http://localhost:4200', 
    'http://localhost:4200',
    'https://amusing-simplicity-production.up.railway.app'
  ]);
  
  // Middleware para logging de requests
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - Origin: ${req.headers.origin || 'no-origin'}`);
    next();
  });
  
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`✅ Application is running on port: ${port}`);
  console.log(`🌐 Frontend Origin: ${process.env.FRONTEND_ORIGIN || 'http://localhost:4200'}`);
}
bootstrap();
