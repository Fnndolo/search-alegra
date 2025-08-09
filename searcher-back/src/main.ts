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
  
  app.enableCors({
    origin: [process.env.FRONTEND_ORIGIN || 'http://localhost:4200', 'http://localhost:4200'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`✅ Application is running on port: ${port}`);
  console.log(`🌐 Frontend Origin: ${process.env.FRONTEND_ORIGIN || 'http://localhost:4200'}`);
}
bootstrap();
