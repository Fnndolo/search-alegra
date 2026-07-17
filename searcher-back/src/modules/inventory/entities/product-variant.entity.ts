import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { Color } from './color.entity';

/**
 * Variante de color/SKU de un producto. Siempre obligatoria, sin excepción — incluso productos
 * "planos" como cables tienen su propio SKU por color (ej. "Cable USB-C blanco").
 * Cuando `Product.has_identifier` es true, cada unidad física de esta variante es una fila
 * `Variant` con su `identifier`. Cuando es false, el stock se calcula desde `InventoryMovement`.
 */
@Entity('product_variants')
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Product, (p) => p.variants, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Index()
  @ManyToOne(() => Color, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'color_id' })
  color: Color;

  @Index('UQ_product_variant_sku', { unique: true })
  @Column({ type: 'varchar', length: 150 })
  sku: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
