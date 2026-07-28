import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_preferences')
export class UserPreferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'text', nullable: true })
  source?: string;

  @Column({ type: 'float', default: 1 })
  confidence: number;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ type: 'datetime', nullable: true })
  forgottenAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
