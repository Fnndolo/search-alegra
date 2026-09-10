import { Module } from '@nestjs/common';
import { StoreCredentialsService } from './store-credentials.service';
import { AlegraApiService } from './alegra-api.service';

@Module({
  providers: [StoreCredentialsService, AlegraApiService],
  exports: [StoreCredentialsService, AlegraApiService],
})
export class SharedModule {}
