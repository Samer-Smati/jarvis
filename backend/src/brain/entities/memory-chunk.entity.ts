import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
