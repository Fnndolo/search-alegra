import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { InventoryService } from './inventory.service';
import { Warehouse } from '../entities/warehouse.entity';
import { Variant } from '../entities/variant.entity';
import { InventoryMovement } from '../entities/inventory-movement.entity';
import { MovementType } from '../entities/enums';

@Injectable()
export class InventoryStockService {
  private readonly logger = new Logger(InventoryStockService.name);

  constructor(
    private readonly inventoryService: InventoryService,

    @InjectRepository(Variant)
    private readonly variantRepo: Repository<Variant>,

    @InjectRepository(InventoryMovement)
    private readonly movementRepo: Repository<InventoryMovement>,

    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
  ) {}

  async resolveDefaultWarehouse(storeId: string): Promise<Warehouse | null> {
    const main = await this.inventoryService.findMainWarehouse(storeId);
    if (main) return main;
    return this.warehouseRepo.findOne({
      where: { store: { id: storeId }, active: true },
      order: { created_at: 'ASC' },
    });
  }

  // No-op: stock is now derived from variants.exit_date IS NULL.
  // Kept for backward compatibility with callers in inventory-ingreso.service.ts.
  async adjustStock(_variantId: string, _warehouseId: string, _delta: number): Promise<void> {}

  async decrementStock(variantId: string, warehouseId: string, quantity: number): Promise<void> {
    await this.adjustStock(variantId, warehouseId, -quantity);
  }

  async ingresoStock(
    variantId: string,
    warehouseId: string,
    quantity: number,
  ): Promise<{ variantId: string; warehouseId: string; quantity: number }> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Quantity must be a positive integer');
    }
    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId } });
    if (!warehouse) throw new NotFoundException(`Warehouse ${warehouseId} not found`);
    return { variantId, warehouseId, quantity };
  }

  async getStockByVariant(
    variantId: string,
  ): Promise<{ available: number; sold: boolean }> {
    const variant = await this.variantRepo.findOne({ where: { id: variantId } });
    if (!variant) return { available: 0, sold: false };
    return {
      available: variant.exit_date == null ? 1 : 0,
      sold: variant.exit_date != null,
    };
  }

  async getStockByStore(
    storeId: string,
  ): Promise<{ warehouse: Warehouse; variantId: string; available: number }[]> {
    const warehouses = await this.warehouseRepo.find({
      where: { store: { id: storeId }, active: true },
    });
    if (warehouses.length === 0) return [];

    // Count all available units globally (no warehouse link on variants yet)
    const available = await this.variantRepo.count({
      where: { active: true, exit_date: IsNull() },
    });

    // Return total only on the first warehouse; rest return 0
    // TODO: track warehouse per variant once ingreso links units to warehouses
    return warehouses.map((w, i) => ({
      warehouse: w,
      variantId: '',
      available: i === 0 ? available : 0,
    }));
  }

  async processInvoiceSale(storeKey: string, invoiceData: any): Promise<void> {
    try {
      const store = await this.inventoryService.findStoreByStoreKey(storeKey);
      if (!store) {
        this.logger.warn(
          `[InventoryStock] processInvoiceSale — store not found for storeKey=${storeKey}`,
        );
        return;
      }

      const invoiceId: string | null = invoiceData?.id ? String(invoiceData.id) : null;

      if (invoiceId) {
        const existing = await this.movementRepo.findOne({
          where: {
            alegra_invoice_id: invoiceId,
            movement_type: MovementType.SALE,
          },
        });
        if (existing) {
          this.logger.log(
            `[InventoryStock] Idempotency hit — invoiceId=${invoiceId} already processed`,
          );
          return;
        }
      }

      this.logger.log(
        `[InventoryStock] processInvoiceSale received for store=${storeKey} invoice=${invoiceId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[InventoryStock] processInvoiceSale failed storeKey=${storeKey}: ${err?.message}`,
        err?.stack,
      );
    }
  }
}
