import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { LeaveType } from '../../common/enums/leave-type.enum';
import { RequestStatus } from '../../common/enums/request-status.enum';

@Entity('time_off_requests')
@Check(`"days_requested" > 0`)
@Check(`"end_date" >= "start_date"`)
@Check(`"hcm_committed" IN (0, 1)`)
@Check(
  `"status" IN ('PENDING','APPROVED','REJECTED','CANCELLED','HCM_DEDUCT_PENDING','CANCELLATION_CREDIT_PENDING','RETRY_EXHAUSTED')`,
)
// Covers list-by-employee queries and the retry-job async-pending filter
@Index('idx_tor_employee_status', ['employeeId', 'status'])
// Covers overlap checks on date range
@Index('idx_tor_date_range', ['employeeId', 'locationId', 'startDate', 'endDate'])
export class TimeOffRequest {
  @PrimaryColumn({ type: 'text' })
  id: string;

  /** SHA-256 derived from request content; guards duplicate submissions at the DB layer. */
  @Column({ name: 'idempotency_key', type: 'text', unique: true })
  idempotencyKey: string;

  @Column({ name: 'employee_id', type: 'text' })
  employeeId: string;

  @Column({ name: 'location_id', type: 'text' })
  locationId: string;

  @Column({ name: 'leave_type', type: 'text' })
  leaveType: LeaveType;

  /** ISO-8601 date string (YYYY-MM-DD). */
  @Column({ name: 'start_date', type: 'text' })
  startDate: string;

  /** ISO-8601 date string (YYYY-MM-DD). */
  @Column({ name: 'end_date', type: 'text' })
  endDate: string;

  /** Rounded to nearest 0.5; always > 0 (enforced by CHECK constraint). */
  @Column({ name: 'days_requested', type: 'real' })
  daysRequested: number;

  @Column({ name: 'status', type: 'text', default: RequestStatus.PENDING })
  status: RequestStatus;

  @Column({ name: 'manager_id', type: 'text', nullable: true })
  managerId: string | null;

  @Column({ name: 'manager_notes', type: 'text', nullable: true })
  managerNotes: string | null;

  /** HCM transaction ID returned after a successful deduct call. */
  @Column({ name: 'hcm_transaction_id', type: 'text', nullable: true })
  hcmTransactionId: string | null;

  /** 1 = HCM deduct confirmed; 0 = deduct not yet applied. Stored as integer (SQLite has no BOOLEAN). */
  @Column({ name: 'hcm_committed', type: 'integer', default: 0 })
  hcmCommitted: number;

  /** Incremented by the background retry job; triggers RETRY_EXHAUSTED after 10 attempts. */
  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'text' })
  createdAt: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'text' })
  updatedAt: string;
}
