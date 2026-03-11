import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('product_mappings')
export class ProductMapping {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'kupo_product_id', type: 'varchar' })
    kupoProductId: string;

    @Column({ name: 'kupo_product_name', type: 'varchar' })
    kupoProductName: string;

    @Column({ name: 'name_pasto', type: 'varchar', nullable: true })
    namePasto: string;

    @Column({ name: 'name_armenia', type: 'varchar', nullable: true })
    nameArmenia: string;

    @Column({ name: 'name_pereira', type: 'varchar', nullable: true })
    namePereira: string;

    @Column({ name: 'name_medellin', type: 'varchar', nullable: true })
    nameMedellin: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
