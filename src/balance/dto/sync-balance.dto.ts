import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { LeaveType } from '../../common/enums/leave-type.enum';

export class SyncBalanceDto {
  @IsString()
  @MaxLength(64)
  employeeId: string;

  @IsString()
  @MaxLength(64)
  locationId: string;

  @IsOptional()
  @IsEnum(LeaveType)
  leaveType?: LeaveType;
}
