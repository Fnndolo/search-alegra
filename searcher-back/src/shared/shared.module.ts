import { Module } from '@nestjs/common';
import { StoreCredentialsService } from './store-credentials.service';

@Module({
  providers: [StoreCredentialsService],
  exports: [StoreCredentialsService],
})
export class SharedModule {}
