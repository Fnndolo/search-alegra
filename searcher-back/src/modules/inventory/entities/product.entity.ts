import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Category } from './category.entity';
import { Store } from './store.entity';
import { ProductVariant } from './product-variant.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Sede a la que pertenece el producto. Un producto se crea para UNA sola sede. */
  @Index()
  @ManyToOne(() => Store, { nullable: false })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Index()
  @ManyToOne(() => Category, { nullable: false })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @Column({ type: 'varchar', length: 300 })
  name: string;

  /**
   * Indica si las unidades de este producto requieren identificador (imei/serial) individual.
   * true: cada unidad física es una fila `Variant` con su `identifier` (celulares, laptops, etc.).
   * false: el stock de la variante de color se lleva por cantidad (accesorios, cables, etc.).
   */
  @Column({ type: 'boolean', default: true })
  has_identifier: boolean;

  /**
   * Flag informativo: permite vender sin stock disponible. Sin lógica de bloqueo asociada —
   * Alegra ya soporta la venta sin stock por su cuenta.
   */
  @Column({ type: 'boolean', default: false })
  negative_sell: boolean;

  /** Precio de venta general del producto — igual para todas sus variantes de color/sku. */
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

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => ProductVariant, (pv) => pv.product)
  variants: ProductVariant[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
