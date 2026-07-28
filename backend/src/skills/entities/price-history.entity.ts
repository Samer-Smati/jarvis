import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('crypto_price_history')
@Index(['snapshotDate'], { unique: true })
export class PriceHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  snapshotDate: string;

  @Column({ type: 'real' })
  totalValueUsd: number;

  @CreateDateColumn()
  createdAt: Date;
}
