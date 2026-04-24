import { createHash } from 'crypto';
import { TimeOffService } from '../../src/time-off/time-off.service';
import { LeaveType } from '../../src/common/enums/leave-type.enum';
import { SubmitTimeOffRequestDto } from '../../src/time-off/dto/submit-time-off-request.dto';

function makeDto(overrides: Partial<SubmitTimeOffRequestDto> = {}): SubmitTimeOffRequestDto {
  return Object.assign(
    {
      employeeId: 'emp1',
      locationId: 'loc1',
      leaveType: LeaveType.VACATION,
      startDate: '2030-06-01',
      endDate: '2030-06-05',
      daysRequested: 5,
    } as SubmitTimeOffRequestDto,
    overrides,
  );
}

describe('TimeOffService', () => {
  let service: TimeOffService;

  beforeEach(() => {
    service = new TimeOffService(
      {} as any, // requestRepo
      {} as any, // balanceService
      {} as any, // hcmClient
    );
  });

  describe('deriveIdempotencyKey', () => {
    it('produces identical output for identical inputs', () => {
      const dto = makeDto();
      expect(service.deriveIdempotencyKey(dto)).toBe(service.deriveIdempotencyKey(dto));
    });

    it('produces a valid 64-char hex SHA-256 string', () => {
      const key = service.deriveIdempotencyKey(makeDto());
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different output for different employeeId', () => {
      const a = service.deriveIdempotencyKey(makeDto({ employeeId: 'emp1' }));
      const b = service.deriveIdempotencyKey(makeDto({ employeeId: 'emp2' }));
      expect(a).not.toBe(b);
    });

    it('produces different output for different date range', () => {
      const a = service.deriveIdempotencyKey(makeDto({ startDate: '2030-06-01', endDate: '2030-06-05' }));
      const b = service.deriveIdempotencyKey(makeDto({ startDate: '2030-07-01', endDate: '2030-07-05' }));
      expect(a).not.toBe(b);
    });

    it('matches expected SHA-256 of pipe-joined fields', () => {
      const dto = makeDto();
      const payload = [
        dto.employeeId,
        dto.locationId,
        dto.leaveType,
        dto.startDate,
        dto.endDate,
        String(dto.daysRequested),
      ].join('|');
      const expected = createHash('sha256').update(payload).digest('hex');
      expect(service.deriveIdempotencyKey(dto)).toBe(expected);
    });
  });
});
