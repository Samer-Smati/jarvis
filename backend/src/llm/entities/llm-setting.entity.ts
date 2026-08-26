import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Small key-value store for LLM settings that must survive a serverless cold start —
 * in-memory state on LlmService alone doesn't, since Vercel can route the next request to a
 * different function instance. Currently holds just the manually selected provider. */
@Entity('llm_settings')
export class LlmSettingEntity {
  @PrimaryColumn()
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
