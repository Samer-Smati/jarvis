import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateTimeColumnType } from '../../database/database.util';

@Entity('memory_chunks')
export class MemoryChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'text' })
  text: string;

  @Column()
  sourceType: string;

  @Column({ nullable: true })
  sourcePath?: string;

  @Column({ type: 'text', nullable: true })
  embeddingJson?: string;

  @CreateDateColumn({ type: dateTimeColumnType() })
  createdAt: Date;
}
