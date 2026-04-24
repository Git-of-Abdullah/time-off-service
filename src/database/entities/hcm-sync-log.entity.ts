import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum SyncType {
  BATCH = 'BATCH',
  REALTIME = 'REALTIME',
}

export enum SyncStatus {
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('hcm_sync_logs')
export class HcmSyncLog {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ name: 'sync_type', type: 'text' })
  syncType: SyncType;

  /** SHA-256 of the raw request body; prevents double-processing the same batch. */
  @Column({ name: 'payload_hash', type: 'text', unique: true })
  payloadHash: string;

  @Column({ name: 'status', type: 'text' })
  status: SyncStatus;

  @Column({ name: 'records_total', type: 'integer', nullable: true })
  recordsTotal: number | null;

  @Column({ name: 'records_updated', type: 'integer', nullable: true })
  recordsUpdated: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'text' })
  receivedAt: string;

  @Column({ name: 'completed_at', type: 'text', nullable: true })
  completedAt: string | null;
}
