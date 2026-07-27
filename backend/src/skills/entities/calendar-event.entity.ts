import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateTimeColumnType } from '../../database/database.util';

@Entity('calendar_events')
export class CalendarEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Index()
  @Column({ type: dateTimeColumnType() })
  startAt: Date;

  @Column({ type: dateTimeColumnType(), nullable: true })
  endAt?: Date;

  @Column({ nullable: true })
  location?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt: Date;
}
