import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

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

  @Column({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
