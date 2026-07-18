import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  action: string;

  @Column()
  trigger: string;

  @Column({ type: 'text' })
  detail: string;

  @Column()
  outcome: string;

  @CreateDateColumn()
  createdAt: Date;
}
