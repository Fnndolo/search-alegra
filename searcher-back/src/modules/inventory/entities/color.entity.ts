import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Paleta reutilizable de colores para `ProductVariant`. Se crea "al vuelo" desde el autocompletado
 * (nombre obligatorio, hex opcional) y se puede editar luego desde una pantalla de administración.
 *
 * Unicidad case-insensitive: elegimos NO usar un índice de expresión sobre `LOWER(name)`. Este
 * módulo no tiene infraestructura de migraciones (no hay carpeta `migrations/`, el schema se
 * gestiona con `synchronize: true` en dev — ver `app.module.ts`), y TypeORM no puede generar un
 * índice de expresión mediante decoradores + `synchronize`. En su lugar seguimos el mismo patrón
 * que ya usa `Category` (`unique: true` sobre `name` + verificación "buscar antes de crear" en el
 * service): aquí el "buscar" en `findOrCreateColor` usa `ILIKE` (case-insensitive) en vez de una
 * comparación exacta, preservando el casing tal cual lo tipeó el usuario (ej. "Rojo Cereza") para
 * mostrarlo en la UI, mientras evitamos duplicados como "rojo" / "Rojo" / "ROJO" a nivel de
 * aplicación. El `unique: true` en la columna sigue actuando como red de seguridad exacta.
 */
@Entity('colors')
export class Color {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  /** Código hexadecimal opcional para el swatch de color en la UI. Formato #RRGGBB. */
  @Column({ type: 'varchar', length: 7, nullable: true, default: null })
  hex_code: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
