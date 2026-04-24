import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { TimeOffService } from './time-off.service';
import { SubmitTimeOffRequestDto } from './dto/submit-time-off-request.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto';

@Controller('time-off')
export class TimeOffController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post('requests')
  async submit(
    @Body() dto: SubmitTimeOffRequestDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') headerKey?: string,
  ) {
    const idempotencyKey = headerKey ?? this.timeOffService.deriveIdempotencyKey(dto);
    const result = await this.timeOffService.submit(dto, idempotencyKey);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.request;
  }

  @Get('requests')
  list(@Query() query: ListRequestsQueryDto) {
    return this.timeOffService.list(query);
  }

  @Get('requests/:id')
  findById(@Param('id') id: string) {
    return this.timeOffService.findById(id);
  }

  @Patch('requests/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveRequestDto) {
    return this.timeOffService.approve(id, dto);
  }

  @Patch('requests/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectRequestDto) {
    return this.timeOffService.reject(id, dto);
  }

  @Delete('requests/:id')
  cancel(
    @Param('id') id: string,
    @Body('employeeId') employeeId: string,
  ) {
    return this.timeOffService.cancel(id, employeeId);
  }
}
