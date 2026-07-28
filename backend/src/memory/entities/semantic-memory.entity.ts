import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { MemoryType } from '../memory.types';

@Entity('semantic_memories')
export class SemanticMemoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', length: 32, default: 'fact' })
  memoryType: MemoryType;

  @Column({ type: 'text', nullable: true })
  source?: string;

  @Column({ type: 'float', default: 1 })
  confidence: number;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ type: 'datetime', nullable: true })
  forgottenAt?: Date;

  @Column({ type: 'datetime', nullable: true })
  lastVerified?: Date;

  @Column({ type: 'text', nullable: true })
  embedding?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
