import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TimeOffRequest } from '../entities/time-off-request.entity';

@Injectable()
export class TimeOffRequestRepository {
  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly repo: Repository<TimeOffRequest>,
    private readonly dataSource: DataSource,
  ) {}

  findById(id: string): Promise<TimeOffRequest | null> {
    return this.repo.findOneBy({ id });
  }

  findByIdempotencyKey(key: string): Promise<TimeOffRequest | null> {
    return this.repo.findOneBy({ idempotencyKey: key });
  }

  findPendingDaysByDimension(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<{ total: number }> {
    // Returns sum of days_requested for PENDING + HCM_DEDUCT_PENDING rows
    return this.repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.daysRequested), 0)', 'total')
      .where('r.employeeId = :employeeId', { employeeId })
      .andWhere('r.locationId = :locationId', { locationId })
      .andWhere('r.leaveType = :leaveType', { leaveType })
      .andWhere("r.status IN ('PENDING', 'HCM_DEDUCT_PENDING')")
      .getRawOne() as Promise<{ total: number }>;
  }

  findOverlapping(
    employeeId: string,
    locationId: string,
    leaveType: string,
    startDate: string,
    endDate: string,
  ): Promise<TimeOffRequest | null> {
    return this.repo
      .createQueryBuilder('r')
      .where('r.employeeId = :employeeId', { employeeId })
      .andWhere('r.locationId = :locationId', { locationId })
      .andWhere('r.leaveType = :leaveType', { leaveType })
      .andWhere("r.status IN ('PENDING', 'APPROVED', 'HCM_DEDUCT_PENDING')")
      .andWhere('r.startDate <= :endDate', { endDate })
      .andWhere('r.endDate >= :startDate', { startDate })
      .getOne();
  }

  findAsyncPending(): Promise<TimeOffRequest[]> {
    return this.repo
      .createQueryBuilder('r')
      .where("r.status IN ('HCM_DEDUCT_PENDING', 'CANCELLATION_CREDIT_PENDING')")
      .getMany();
  }

  save(request: TimeOffRequest): Promise<TimeOffRequest> {
    return this.repo.save(request);
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }
}
