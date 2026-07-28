import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { dateTimeColumnType } from '../../database/database.util';
import type { ProjectStatus } from '../memory.types';

@Entity('user_projects')
export class UserProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 256 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status: ProjectStatus;

  @Column({ type: 'text', nullable: true })
  tags?: string;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ type: dateTimeColumnType(), nullable: true })
  forgottenAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
