import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Color } from '../entities/color.entity';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeHex(hex?: string | null): string | null {
  if (hex === undefined || hex === null) return null;
  const trimmed = hex.trim();
  if (!trimmed) return null;
  if (!HEX_RE.test(trimmed)) {
    throw new BadRequestException(`Invalid hex code '${hex}', expected format #RRGGBB`);
  }
  return trimmed.toUpperCase();
}

export interface ColorDto {
  id: string;
  name: string;
  hexCode: string | null;
}

/**
 * Paleta reutilizable de colores (ver comentario de unicidad en `color.entity.ts`).
 * Concern separado de `InventoryService` siguiendo el patrón ya establecido en este módulo
 * (inventory-stock/ingreso/stats/purchase-orders/alegra-import son servicios propios por concern).
 */
@Injectable()
export class ColorService {
  constructor(
    @InjectRepository(Color)
    private readonly colorRepo: Repository<Color>,
  ) {}

  /** Entity → DTO: the entity's `hex_code` column must map to `hexCode` for the frontend's `Color` model. */
  private toDto(entity: Color): ColorDto {
    return { id: entity.id, name: entity.name, hexCode: entity.hex_code };
  }

  async listColors(): Promise<ColorDto[]> {
    const entities = await this.colorRepo.find({ order: { name: 'ASC' } });
    return entities.map((e) => this.toDto(e));
  }

  async searchColors(query?: string): Promise<ColorDto[]> {
    const qb = this.colorRepo.createQueryBuilder('color').orderBy('color.name', 'ASC').take(20);
    if (query?.trim()) {
      qb.andWhere('color.name ILIKE :term', { term: `%${query.trim()}%` });
    }
    const entities = await qb.getMany();
    return entities.map((e) => this.toDto(e));
  }

  /**
   * Busca por nombre case-insensitive (ILIKE con match exacto de longitud, no substring). Si existe,
   * la retorna tal cual (nunca sobreescribe su hex_code). Si no existe, la crea con el hex dado
   * (o null). Es el punto de entrada del flujo fluido de autocompletado.
   */
  async findOrCreateColor(name: string, hexCode?: string | null): Promise<Color> {
    if (!name?.trim()) {
      throw new BadRequestException('Color name is required');
    }
    const trimmedName = name.trim();

    const existing = await this.colorRepo
      .createQueryBuilder('color')
      .where('LOWER(color.name) = LOWER(:name)', { name: trimmedName })
      .getOne();
    if (existing) return existing;

    const entity = this.colorRepo.create({
      name: trimmedName,
      hex_code: normalizeHex(hexCode),
    });
    return this.colorRepo.save(entity);
  }

  async findColorById(id: string): Promise<Color> {
    const entity = await this.colorRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Color ${id} not found`);
    return entity;
  }

  async updateColor(id: string, dto: { name?: string; hexCode?: string | null }): Promise<ColorDto> {
    const entity = await this.findColorById(id);

    if (dto.name !== undefined) {
      const trimmedName = dto.name.trim();
      if (!trimmedName) throw new BadRequestException('Color name cannot be empty');
      if (trimmedName.toLowerCase() !== entity.name.toLowerCase()) {
        const conflict = await this.colorRepo
          .createQueryBuilder('color')
          .where('LOWER(color.name) = LOWER(:name)', { name: trimmedName })
          .andWhere('color.id != :id', { id })
          .getOne();
        if (conflict) throw new ConflictException(`Color '${trimmedName}' already exists`);
      }
      entity.name = trimmedName;
    }

    if (dto.hexCode !== undefined) {
      entity.hex_code = normalizeHex(dto.hexCode);
    }

    const saved = await this.colorRepo.save(entity);
    return this.toDto(saved);
  }
}
