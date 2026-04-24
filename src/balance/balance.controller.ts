import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { GetBalanceQueryDto } from './dto/get-balance-query.dto';
import { SyncBalanceDto } from './dto/sync-balance.dto';

@Controller('time-off')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get('balances/:employeeId/:locationId')
  getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Query() query: GetBalanceQueryDto,
  ) {
    return this.balanceService.getBalance(employeeId, locationId, query);
  }

  @Post('balances/sync')
  @HttpCode(HttpStatus.OK)
  syncBalance(@Body() dto: SyncBalanceDto) {
    return this.balanceService.syncFromHcm(dto);
  }
}
