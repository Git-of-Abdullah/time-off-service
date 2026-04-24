import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { LeaveType } from '../../common/enums/leave-type.enum';

export class GetBalanceQueryDto {
  @IsOptional()
  @IsEnum(LeaveType)
  leaveType?: LeaveType;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  refresh?: boolean = false;
}
