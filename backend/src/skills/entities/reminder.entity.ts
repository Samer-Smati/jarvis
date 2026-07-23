import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('reminders')
@Index(['fired', 'dueAt'])
export class ReminderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  text: string;

  @Column({ type: 'timestamp' })
  dueAt: Date;

  @Column({ default: false })
  fired: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
