import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('semantic_memories')
export class SemanticMemoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  text: string;

  // Embedding vector serialized as JSON; swap to pgvector/sqlite-vec for scale.
  @Column({ type: 'text', nullable: true })
  embedding?: string;

  @CreateDateColumn()
  createdAt: Date;
}
