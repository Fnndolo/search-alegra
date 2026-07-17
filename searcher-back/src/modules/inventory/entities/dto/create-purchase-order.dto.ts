import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePurchaseOrderUnitDto {
  @IsOptional()
  @IsString()
  identifier?: string;
}

export class CreatePurchaseOrderItemDto {
  @Type(() => Number)
  @IsInt()
  alegraItemId: number;

  /**
   * ProductVariant (color+sku) explícita para este ítem. Si se omite, se usa la primera
   * ProductVariant creada para el producto local mapeado a `alegraItemId` (fallback documentado
   * en purchase-orders.service.ts: resolveProductVariant).
   */
  @IsOptional()
  @IsString()
  productVariantId?: string;

  @IsString()
  name: string;

  @Type(() => Number)
  @IsNumber()
  price: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsBoolean()
  requiresSerial: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderUnitDto)
  units: CreatePurchaseOrderUnitDto[];
}

export class CreatePurchaseOrderDto {
  @IsString()
  store: string;

  @Type(() => Number)
  @IsInt()
  providerId: number;

  @IsString()
  providerName: string;

  @IsOptional()
  @IsString()
  providerIdentification?: string;

  @IsString()
  date: string;

  @IsString()
  dueDate: string;

  @IsString()
  alegraWarehouseId: string;

  @IsString()
  alegraWarehouseName: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  observations?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  items: CreatePurchaseOrderItemDto[];

  @IsOptional()
  @IsBoolean()
  draft?: boolean;
}

export class UpdatePurchaseOrderItemDto {
  @Type(() => Number)
  @IsInt()
  alegraItemId: number;

  @IsOptional()
  @IsString()
  productVariantId?: string;

  @IsString()
  name: string;

  @Type(() => Number)
  @IsNumber()
  price: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsBoolean()
  requiresSerial: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderUnitDto)
  units: CreatePurchaseOrderUnitDto[];
}

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  providerId?: number;

  @IsOptional()
  @IsString()
  providerName?: string;

  @IsOptional()
  @IsString()
  providerIdentification?: string;

  @IsOptional()
  @IsString()
  observations?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePurchaseOrderItemDto)
  items?: UpdatePurchaseOrderItemDto[];

  // Draft-editable warehouse / store fields (also forwarded from frontend on draft edit)
  @IsOptional()
  @IsString()
  alegraWarehouseId?: string;

  @IsOptional()
  @IsString()
  alegraWarehouseName?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  store?: string;
}

export class CancelPurchaseOrderDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListPurchaseOrdersQuery {
  @IsOptional()
  @IsString()
  store?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

export class CreateWarehouseDto {
  @IsString()
  store: string;

  @IsString()
  storeId: string;

  @IsString()
  name: string;
}

export interface CreateWarehouseResult {
  alegraWarehouseId: number;
  alegraWarehouseName: string;
  warehouseId: string;
}
