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
import { ProductVariant } from './product-variant.entity';
import { Warehouse } from './warehouse.entity';

/** Unidad física individual. Solo existen filas cuando el producto tiene has_identifier = true. */
@Entity('variants')
export class Variant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => ProductVariant, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_variant_id' })
  product_variant: ProductVariant;

  /** Bodega dentro de la sede en la que está esta unidad — se deriva la sede vía warehouse.store. */
  @Index()
  @ManyToOne(() => Warehouse, { nullable: true })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse | null;

  /**
   * Identificador de la unidad (imei/serial). Colapsa lo que antes eran serial/imei1/imei2.
   * Unique a nivel DB (Postgres permite múltiples NULL sin violarlo) — es la última línea de
   * defensa detrás de las validaciones a nivel de servicio en purchase-orders.service.ts e
   * inventory-ingreso.service.ts, que son las que corren primero y dan el mensaje de error legible.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 150, nullable: true, default: null })
  identifier: string | null;

  /** Precio de venta específico de esta unidad — sobreescribe el de la ProductVariant si se define. */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    default: null,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v == null ? null : Number(v)),
    },
  })
  sale_price: number | null;

  /**
   * Precio de costo con el que ENTRÓ esta unidad puntual — de la línea de la orden de compra que
   * la generó, o del ingreso manual (`precioCosto`). Null en unidades creadas antes de que este
   * campo existiera. Es la base del "costo promedio" en existencias (promedio solo de unidades
   * activas — lo que ya se vendió no debe pesar en el promedio de lo que queda en stock).
   */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    default: null,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v == null ? null : Number(v)),
    },
  })
  cost_price: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  barcode: string | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  entry_date: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  exit_date: Date | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
