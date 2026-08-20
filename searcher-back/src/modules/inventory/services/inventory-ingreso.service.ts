import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InventoryService } from './inventory.service';
import { InventoryStockService } from './inventory-stock.service';
import { Variant } from '../entities/variant.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { InventoryMovement } from '../entities/inventory-movement.entity';
import { MovementType } from '../entities/enums';

export interface IngresoUnidadesDto {
  sedeId: string;
  bodegaId?: string;
  productVariantId?: string;
  unidades: {
    identifier?: string;
    precioVenta?: number;
    precioCosto?: number;
  }[];
}

export interface IngresoUnidadesResult {
  resumen: {
    totalUnidades: number;
    variantesNuevas: number;
    errores: number;
  };
  unidades: {
    varianteId: string | null;
    identifier: string | null;
    error: string | null;
  }[];
}

@Injectable()
export class InventoryIngresoService {
  private readonly logger = new Logger(InventoryIngresoService.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly stockService: InventoryStockService,

    @InjectRepository(Variant)
    private readonly variantRepo: Repository<Variant>,

    @InjectRepository(ProductVariant)
    private readonly productVariantRepo: Repository<ProductVariant>,

    @InjectRepository(InventoryMovement)
    private readonly movementRepo: Repository<InventoryMovement>,
  ) {}

  async procesarIngreso(
    productId: string,
    dto: IngresoUnidadesDto,
    preview: boolean,
  ): Promise<IngresoUnidadesResult> {
    const product = await this.inventoryService.findProductById(productId);

    const productVariant = dto.productVariantId
      ? await this.productVariantRepo.findOne({
          where: { id: dto.productVariantId, product: { id: product.id } },
        })
      : await this.productVariantRepo.findOne({
          where: { product: { id: product.id } },
          order: { created_at: 'ASC' },
        });
    if (!productVariant) throw new NotFoundException(`Product ${productId} has no matching variant`);

    const store = await this.inventoryService.findStoreById(dto.sedeId);
    if (!store) throw new NotFoundException(`Store ${dto.sedeId} not found`);

    let warehouse = dto.bodegaId
      ? await this.inventoryService.findWarehousesByStoreId(dto.sedeId).then((ws) =>
          ws.find((w) => w.id === dto.bodegaId) ?? null,
        )
      : await this.inventoryService.findMainWarehouse(dto.sedeId);

    if (!warehouse) {
      warehouse = (await this.inventoryService.findWarehousesByStoreId(dto.sedeId))[0] ?? null;
    }

    const results: IngresoUnidadesResult['unidades'] = [];
    let variantesNuevas = 0;
    let errores = 0;

    for (const row of dto.unidades) {
      try {
        const identifier = row.identifier?.trim() || null;
        // Same uniqueness guard purchase-orders.service.ts already applies before creating a
        // Variant — without it, this manual entry flow could silently create a second unit with
        // an IMEI that's already active elsewhere, breaking FIFO matching on sale.
        if (identifier) {
          const existing = await this.variantRepo.findOne({ where: { identifier } });
          if (existing) {
            throw new BadRequestException(
              `El identificador ${identifier} ya existe (unidad ${existing.id}) — no se puede ingresar duplicado.`,
            );
          }
        }

        if (!preview) {
          const variant = this.variantRepo.create({
            product_variant: productVariant,
            warehouse,
            identifier,
            cost_price: row.precioCosto ?? null,
            entry_date: new Date(),
          });
          const saved = await this.variantRepo.save(variant);

          if (warehouse) {
            await this.stockService.adjustStock(saved.id, warehouse.id, 1);

            const movement = this.movementRepo.create({
              variant: { id: saved.id } as any,
              store: { id: dto.sedeId } as any,
              origin_warehouse: { id: warehouse.id } as any,
              movement_type: MovementType.ENTRY,
              quantity: 1,
              movement_date: new Date(),
            });
            await this.movementRepo.save(movement);
          }

          variantesNuevas++;
          results.push({ varianteId: saved.id, identifier: saved.identifier, error: null });
        } else {
          variantesNuevas++;
          results.push({ varianteId: null, identifier: row.identifier ?? null, error: null });
        }
      } catch (err: any) {
        errores++;
        results.push({
          varianteId: null,
          identifier: row.identifier ?? null,
          error: err?.message ?? 'Unknown error',
        });
        this.logger.error(`[InventoryIngreso] Error processing row: ${err?.message}`, err?.stack);
      }
    }

    return {
      resumen: { totalUnidades: dto.unidades.length, variantesNuevas, errores },
      unidades: results,
    };
  }

  async contarUnidadesCreadas(productId: string): Promise<number> {
    return this.variantRepo
      .createQueryBuilder('v')
      .innerJoin('v.product_variant', 'pv')
      .where('pv.product_id = :productId', { productId })
      .getCount();
  }

  /**
   * Busca una unidad por su `identifier`. Antes existían `buscarUnidadPorImei`/`buscarUnidadPorSerial`
   * por separado — `buscarUnidadPorSerial` buscaba (por error) por `barcode` en vez del serial.
   * Con `imei1`/`imei2`/`serial` colapsados en un solo campo, ambos casos son la misma búsqueda.
   */
  async buscarUnidadPorIdentifier(identifier: string): Promise<Variant | null> {
    return this.variantRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.product_variant', 'pv')
      .leftJoinAndSelect('pv.product', 'product')
      .leftJoinAndSelect('product.category', 'category')
      .where('v.identifier = :identifier', { identifier })
      .getOne();
  }

  /**
   * Busca primero por IMEI/serial de unidad (`buscarUnidadPorIdentifier`); si no matchea, intenta
   * el mismo texto contra el SKU de una variante de color (`ProductVariant.sku`) — cubre escanear
   * la etiqueta de la CAJA/variante (sin una unidad puntual todavía recibida) en vez de la etiqueta
   * de la unidad física. Devuelve una forma unificada con `matchType` para que el caller sepa cuál
   * de los dos casos fue.
   */
  async buscarPorIdentifierOSku(query: string): Promise<{
    matchType: 'unit' | 'variant';
    identifier: string | null;
    active: boolean;
    sale_price: number | null;
    product_variant: ProductVariant;
  } | null> {
    const unit = await this.buscarUnidadPorIdentifier(query);
    if (unit) {
      return {
        matchType: 'unit',
        identifier: unit.identifier,
        active: unit.active,
        sale_price: unit.sale_price,
        product_variant: unit.product_variant,
      };
    }

    const variant = await this.productVariantRepo
      .createQueryBuilder('pv')
      .leftJoinAndSelect('pv.product', 'product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('pv.color', 'color')
      .where('LOWER(pv.sku) = LOWER(:sku)', { sku: query.trim() })
      .getOne();
    if (!variant) return null;

    return {
      matchType: 'variant',
      identifier: null,
      active: variant.active,
      sale_price: variant.product.sale_price,
      product_variant: variant,
    };
  }
}
