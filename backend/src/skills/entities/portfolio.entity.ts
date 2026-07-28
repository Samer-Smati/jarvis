import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('crypto_portfolio_holdings')
@Index(['coinId'], { unique: true })
export class PortfolioEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  coinId: string;

  @Column()
  symbol: string;

  @Column({ type: 'real' })
  amount: number;

  @CreateDateColumn()
  createdAt: Date;
}
