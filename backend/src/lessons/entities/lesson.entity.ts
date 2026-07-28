import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { LessonStatus } from '../lessons.types';
import { dateTimeColumnType } from '../../database/database.util';

@Entity('lessons')
export class LessonEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'general' })
  taskType: string;

  @Column({ type: 'text' })
  triggerContext: string;

  @Column({ type: 'text' })
  lessonText: string;

  @Column({ type: 'text', nullable: true })
  embedding?: string;

  @Column({ type: 'float', default: 0.7 })
  confidenceScore: number;

  @Column({ type: 'int', default: 1 })
  reinforcementCount: number;

  @Column({ type: 'int', default: 0 })
  retrievalCount: number;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  sourceInteractionId?: string;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: LessonStatus;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ type: dateTimeColumnType(), nullable: true })
  lastUsedAt?: Date;

  @CreateDateColumn({ type: dateTimeColumnType() })
  createdAt: Date;

  @UpdateDateColumn({ type: dateTimeColumnType() })
  updatedAt: Date;
}
