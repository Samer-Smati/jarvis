import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('brain_edges')
@Unique(['sourcePath', 'targetPath'])
export class BrainEdgeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  sourcePath: string;

  @Index()
  @Column()
  targetPath: string;

  @Column({ default: 'wiki' })
  kind: string;
}
