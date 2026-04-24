export interface HcmBalanceRecord {
  employeeId: string;
  locationId: string;
  leaveType: string;
  balance: number;
}

export interface ErrorInjection {
  statusCode: number;
  remainingCount: number;
}

export interface MockHcmState {
  balances: Map<string, HcmBalanceRecord>;
  errorInjection: ErrorInjection | null;
  processedEventIds: Set<string>;
}

export function makeBalanceKey(employeeId: string, locationId: string, leaveType: string): string {
  return `${employeeId}::${locationId}::${leaveType}`;
}

export function createInitialState(): MockHcmState {
  return {
    balances: new Map(),
    errorInjection: null,
    processedEventIds: new Set(),
  };
}
