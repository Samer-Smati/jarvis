import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('episodic_events')
export class EpisodicEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  kind: string;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'text', nullable: true })
  detail?: string;

  @CreateDateColumn()
  createdAt: Date;
}
