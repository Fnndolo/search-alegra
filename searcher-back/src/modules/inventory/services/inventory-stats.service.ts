import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, DataSource } from 'typeorm';

import { Product } from '../entities/product.entity';
import { Variant } from '../entities/variant.entity';

export interface StockByStore {
  storeId: string;
  name: string;
  outOfStock: number;
  inStock: number;
}

export interface InventoryStats {
  summary: {
    totalProducts: number;
    totalVariants: number;
    available: number;
    sold: number;
  };
  stockByStore: StockByStore[];
}

@Injectable()
export class InventoryStatsService {
  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,

    @InjectRepository(Variant)
    private readonly variantRepo: Repository<Variant>,
  ) {}

  async getStats(): Promise<InventoryStats> {
    const [totalProducts, totalVariants, available, stockByStore] = await Promise.all([
      this.productRepo.count({ where: { active: true } }),
      this.variantRepo.count({ where: { active: true } }),
      this.variantRepo.count({ where: { active: true, exit_date: IsNull() } }),
      this.getStockByStore(),
    ]);

    return {
      summary: {
        totalProducts,
        totalVariants,
        available,
        sold: totalVariants - available,
      },
      stockByStore,
    };
  }

  private async getStockByStore(): Promise<StockByStore[]> {
    const rows: { storeId: string; name: string }[] = await this.dataSource.query(
      `SELECT id AS "storeId", name FROM stores WHERE active = true ORDER BY name ASC`,
    );
    if (rows.length === 0) return [];

    const counts = await this.variantRepo
      .createQueryBuilder('variant')
      .innerJoin('variant.warehouse', 'warehouse')
      .select('warehouse.store_id', 'storeId')
      .addSelect('SUM(CASE WHEN variant.exit_date IS NULL THEN 1 ELSE 0 END)', 'inStock')
      .addSelect('SUM(CASE WHEN variant.exit_date IS NOT NULL THEN 1 ELSE 0 END)', 'outOfStock')
      .where('variant.active = true')
      .groupBy('warehouse.store_id')
      .getRawMany<{ storeId: string; inStock: string; outOfStock: string }>();

    const byStore = new Map(counts.map((c) => [c.storeId, c]));

    return rows.map((r) => {
      const c = byStore.get(r.storeId);
      return {
        storeId: r.storeId,
        name: r.name,
        inStock: c ? Number(c.inStock) : 0,
        outOfStock: c ? Number(c.outOfStock) : 0,
      };
    });
  }
}
