import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('interaction_log')
export class InteractionLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, default: 'default' })
  conversationId: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'text' })
  response: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  taskRoute?: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  provider?: string;

  @Column({ type: 'text', nullable: true })
  toolsUsed?: string;

  @Column({ type: 'int', nullable: true })
  latencyMs?: number;

  @Column({ type: 'int', nullable: true })
  rating?: number;

  @Column({ type: 'text', nullable: true })
  correction?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
