import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
  Check,
} from 'typeorm';
import { LeaveType } from '../../common/enums/leave-type.enum';

@Entity('leave_balances')
// hcm_balance is the HCM-owned value cached locally; must never go negative
@Check(`"hcm_balance" >= 0`)
// available_balance = hcm_balance - pending_days is computed at query time, never stored
@Unique('uq_lb_employee_location_type', ['employeeId', 'locationId', 'leaveType'])
@Index('idx_lb_employee', ['employeeId', 'locationId'])
export class LeaveBalance {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ name: 'employee_id', type: 'text' })
  employeeId: string;

  @Column({ name: 'location_id', type: 'text' })
  locationId: string;

  @Column({ name: 'leave_type', type: 'text' })
  leaveType: LeaveType;

  /** Raw balance received from HCM; never modified by ExampleHR logic. */
  @Column({ name: 'hcm_balance', type: 'real' })
  hcmBalance: number;

  /** ISO-8601 timestamp of the last successful HCM sync for this row. */
  @Column({ name: 'last_synced_at', type: 'text' })
  lastSyncedAt: string;

  /** Incremented on every upsert; used for optimistic concurrency in batch sync. */
  @Column({ name: 'version', type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'text' })
  createdAt: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'text' })
  updatedAt: string;
}
