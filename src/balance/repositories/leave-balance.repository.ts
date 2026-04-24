import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeaveBalance } from '../entities/leave-balance.entity';

@Injectable()
export class LeaveBalanceRepository {
  constructor(
    @InjectRepository(LeaveBalance)
    private readonly repo: Repository<LeaveBalance>,
  ) {}

  findByDimension(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<LeaveBalance | null> {
    return this.repo.findOneBy({ employeeId, locationId, leaveType: leaveType as any });
  }

  findAllForEmployee(employeeId: string, locationId: string): Promise<LeaveBalance[]> {
    return this.repo.findBy({ employeeId, locationId });
  }

  save(balance: LeaveBalance): Promise<LeaveBalance> {
    return this.repo.save(balance);
  }

  upsert(balance: Partial<LeaveBalance>): Promise<void> {
    return this.repo
      .createQueryBuilder()
      .insert()
      .into(LeaveBalance)
      .values(balance)
      .orUpdate(['hcm_balance', 'last_synced_at', 'version', 'updated_at'], [
        'employee_id',
        'location_id',
        'leave_type',
      ])
      .execute()
      .then(() => undefined);
  }
}
