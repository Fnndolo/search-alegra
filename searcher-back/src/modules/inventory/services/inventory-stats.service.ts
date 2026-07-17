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
    // TODO: add variant→store link once ingreso tracks which store received each unit.
    const rows: { storeId: string; name: string }[] = await this.dataSource.query(
      `SELECT id AS "storeId", name FROM stores WHERE active = true ORDER BY name ASC`,
    );
    return rows.map((r) => ({ storeId: r.storeId, name: r.name, outOfStock: 0, inStock: 0 }));
  }
}
