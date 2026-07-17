import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SystemSettings } from '../entities/system-settings.entity';
import { Store } from '../entities/store.entity';

export type SyncMode = 'auto' | 'manual';

export interface SyncConfigStore {
  id: string;
  name: string;
  store_key: string;
  effectiveMode: SyncMode;
  override: SyncMode | null;
}

export interface SyncConfigResult {
  globalMode: SyncMode;
  stores: SyncConfigStore[];
}

export interface UpdateSyncConfigDto {
  globalMode?: SyncMode;
  storeOverrides?: { storeId: string; mode: SyncMode | null }[];
}

const GLOBAL_KEY = 'alegra_sync_mode';

@Injectable()
export class InventorySyncConfigService {
  private readonly logger = new Logger(InventorySyncConfigService.name);

  constructor(
    @InjectRepository(SystemSettings)
    private readonly settingsRepo: Repository<SystemSettings>,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,
  ) {}

  async getGlobalMode(): Promise<SyncMode> {
    const setting = await this.settingsRepo.findOne({ where: { key: GLOBAL_KEY } });
    return (setting?.value as SyncMode) ?? 'manual';
  }

  async getEffectiveSyncMode(storeId: string): Promise<SyncMode> {
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    if (store?.alegra_sync_override) return store.alegra_sync_override;
    return this.getGlobalMode();
  }

  async getFullConfig(): Promise<SyncConfigResult> {
    const [globalMode, stores] = await Promise.all([
      this.getGlobalMode(),
      this.storeRepo.find({ order: { name: 'ASC' } }),
    ]);

    return {
      globalMode,
      stores: stores.map((s) => ({
        id: s.id,
        name: s.name,
        store_key: s.store_key,
        effectiveMode: s.alegra_sync_override ?? globalMode,
        override: s.alegra_sync_override,
      })),
    };
  }

  async updateConfig(dto: UpdateSyncConfigDto): Promise<SyncConfigResult> {
    if (dto.globalMode) {
      await this.settingsRepo.upsert(
        { key: GLOBAL_KEY, value: dto.globalMode },
        { conflictPaths: ['key'] },
      );
      this.logger.log(`[SyncConfig] Global mode set to: ${dto.globalMode}`);
    }

    if (dto.storeOverrides?.length) {
      for (const override of dto.storeOverrides) {
        await this.storeRepo.update(
          { id: override.storeId },
          { alegra_sync_override: override.mode },
        );
        this.logger.log(
          `[SyncConfig] Store ${override.storeId} override set to: ${override.mode ?? 'null (follows global)'}`,
        );
      }
    }

    return this.getFullConfig();
  }
}
