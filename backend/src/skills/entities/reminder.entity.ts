import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateTimeColumnType } from '../../database/database.util';

@Entity('reminders')
@Index(['fired', 'dueAt'])
export class ReminderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  text: string;

  @Column({ type: dateTimeColumnType() })
  dueAt: Date;

  @Column({ default: false })
  fired: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
