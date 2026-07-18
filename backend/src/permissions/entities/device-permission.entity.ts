import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('device_permissions')
export class DevicePermissionEntity {
  @PrimaryColumn()
  scope: string;

  @Column({ default: false })
  granted: boolean;

  @Column({ default: 'desktop' })
  platform: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
