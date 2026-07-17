import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from '../entities/store.entity';

const INITIAL_STORES: Pick<Store, 'name' | 'store_key' | 'active'>[] = [
  { name: 'Pasto', store_key: 'pasto', active: true },
  { name: 'Medellín', store_key: 'medellin', active: true },
  { name: 'Armenia', store_key: 'armenia', active: true },
  { name: 'Pereira', store_key: 'pereira', active: true },
  { name: 'Bogotá', store_key: 'bogota', active: true },
];

@Injectable()
export class StoresSeedService implements OnModuleInit {
  private readonly logger = new Logger(StoresSeedService.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
  ) {}

  async onModuleInit(): Promise<void> {
    const count = await this.storeRepo.count();
    if (count > 0) {
      this.logger.log(`Stores seed skipped — ${count} store(s) already exist`);
      return;
    }

    const stores = this.storeRepo.create(INITIAL_STORES);
    await this.storeRepo.save(stores);
    this.logger.log(`Stores seed complete — ${stores.length} stores created`);
  }
}
