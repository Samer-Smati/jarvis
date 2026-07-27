import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { dateTimeColumnType } from '../../database/database.util';

@Entity('brain_pages')
export class BrainPageEntity {
  @PrimaryColumn()
  path: string;

  @Column()
  title: string;

  @Column()
  category: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'simple-json', default: '[]' })
  links: string[];

  @Column({ type: dateTimeColumnType() })
  createdAt: Date;

  @UpdateDateColumn({ type: dateTimeColumnType() })
  updatedAt: Date;
}
