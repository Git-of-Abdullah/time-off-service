import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TimeOffRequest } from '../entities/time-off-request.entity';
import { ListRequestsQueryDto } from '../dto/list-requests-query.dto';

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

  /**
   * Sum of days for PENDING + HCM_DEDUCT_PENDING rows for a given dimension.
   * Pass excludeId to omit a specific row (used during approval to exclude the row being approved).
   */
  async findPendingDaysByDimension(
    employeeId: string,
    locationId: string,
    leaveType: string,
    excludeId?: string,
  ): Promise<{ total: number }> {
    const qb = this.repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.daysRequested), 0)', 'total')
      .where('r.employeeId = :employeeId', { employeeId })
      .andWhere('r.locationId = :locationId', { locationId })
      .andWhere('r.leaveType = :leaveType', { leaveType })
      .andWhere("r.status IN ('PENDING', 'HCM_DEDUCT_PENDING')");

    if (excludeId) {
      qb.andWhere('r.id != :excludeId', { excludeId });
    }

    return qb.getRawOne() as Promise<{ total: number }>;
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

  async findWithFilters(
    query: ListRequestsQueryDto,
  ): Promise<{ data: TimeOffRequest[]; total: number }> {
    const qb = this.repo.createQueryBuilder('r');

    if (query.employeeId) qb.andWhere('r.employeeId = :eId', { eId: query.employeeId });
    if (query.locationId) qb.andWhere('r.locationId = :lId', { lId: query.locationId });
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if (query.leaveType) qb.andWhere('r.leaveType = :lt', { lt: query.leaveType });
    if (query.from) qb.andWhere('r.startDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('r.endDate <= :to', { to: query.to });

    const limit = query.limit ?? 20;
    const page = query.page ?? 1;

    qb.orderBy('r.createdAt', 'DESC').skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  save(request: TimeOffRequest): Promise<TimeOffRequest> {
    return this.repo.save(request);
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }
}
