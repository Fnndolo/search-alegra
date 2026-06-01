import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('bank_mappings')
export class BankMapping {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    // ID de la cuenta bancaria en Alegra Kupocell
    @Column()
    kupoBankId: string;

    // Nombre de la cuenta bancaria en Alegra Kupocell (ej: "BANCO DE BOGOTA")
    @Column()
    kupoBankName: string;

    @Column({ nullable: true })
    namePasto: string;

    @Column({ nullable: true })
    nameArmenia: string;

    @Column({ nullable: true })
    namePereira: string;

    @Column({ nullable: true })
    nameMedellin: string;

    @Column({ nullable: true })
    nameBogota: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
