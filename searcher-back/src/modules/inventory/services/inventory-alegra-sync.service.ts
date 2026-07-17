import { Injectable, Logger } from '@nestjs/common';
import { InventoryAlegraFactory } from '../alegra/inventory-alegra.factory';

@Injectable()
export class InventoryAlegraSync {
  private readonly logger = new Logger(InventoryAlegraSync.name);

  constructor(private readonly factory: InventoryAlegraFactory) {}

  async updateItemInAlegra(
    storeKey: string,
    alegraItemId: number,
    changes: { price?: number; cost?: number; activo?: boolean },
  ): Promise<void> {
    const client = this.factory.getClient(storeKey);

    const body: Record<string, any> = {};
    if (changes.price !== undefined) {
      body.price = [{ id: 1, value: changes.price }];
    }
    if (changes.cost !== undefined) {
      body.inventory = { unitCost: changes.cost };
    }
    if (changes.activo !== undefined) {
      body.status = changes.activo ? 'active' : 'inactive';
    }

    await this.factory.requestWithRetry(() =>
      client.put(`/items/${alegraItemId}`, body),
    );

    this.logger.log(
      `[InventoryAlegraSync] Updated Alegra item id=${alegraItemId} store=${storeKey}`,
    );
  }

  async adjustStockInAlegra(
    storeKey: string,
    alegraItemId: number,
    alegraWarehouseId: number,
    quantity: number,
    date: Date,
  ): Promise<void> {
    const client = this.factory.getClient(storeKey);

    const body = {
      date: date.toISOString().split('T')[0],
      observations: 'Stock adjustment from inventory system',
      items: [
        {
          id: alegraItemId,
          quantity,
          warehouse: { id: alegraWarehouseId },
        },
      ],
    };

    await this.factory.requestWithRetry(() =>
      client.post('/inventory-adjustments', body),
    );

    this.logger.log(
      `[InventoryAlegraSync] Inventory adjustment posted item=${alegraItemId} warehouse=${alegraWarehouseId} qty=${quantity} store=${storeKey}`,
    );
  }
}
