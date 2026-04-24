import { Request, Response } from 'express';
import { MockHcmState, makeBalanceKey } from './state';

export function handleGetBalance(state: MockHcmState) {
  return (req: Request, res: Response): void => {
    if (shouldInjectError(state, res)) return;

    const { employeeId, locationId, leaveType } = req.query as Record<string, string>;
    const key = makeBalanceKey(employeeId, locationId, leaveType);
    const record = state.balances.get(key);

    if (!record) {
      res.status(404).json({ error: 'BALANCE_NOT_FOUND' });
      return;
    }

    res.json(record);
  };
}

export function handleDeductBalance(state: MockHcmState) {
  return (req: Request, res: Response): void => {
    if (shouldInjectError(state, res)) return;

    const { employeeId, locationId, leaveType, days } = req.body as {
      employeeId: string;
      locationId: string;
      leaveType: string;
      days: number;
      idempotencyKey: string;
    };

    const key = makeBalanceKey(employeeId, locationId, leaveType);
    const record = state.balances.get(key);

    if (!record) {
      res.status(422).json({ error: 'INSUFFICIENT_BALANCE', message: 'Balance record not found' });
      return;
    }

    if (record.balance < days) {
      res.status(422).json({ error: 'INSUFFICIENT_BALANCE', message: `Balance ${record.balance} < ${days}` });
      return;
    }

    record.balance = Math.round((record.balance - days) * 100) / 100;

    res.json({
      transactionId: `hcm_txn_${Date.now()}`,
      remainingBalance: record.balance,
    });
  };
}

export function handleCreditBalance(state: MockHcmState) {
  return (req: Request, res: Response): void => {
    if (shouldInjectError(state, res)) return;

    const { employeeId, locationId, leaveType, days } = req.body as {
      employeeId: string;
      locationId: string;
      leaveType: string;
      days: number;
      originalTransactionId: string;
    };

    const key = makeBalanceKey(employeeId, locationId, leaveType);
    const record = state.balances.get(key);

    if (record) {
      record.balance = Math.round((record.balance + days) * 100) / 100;
    }

    res.json({ success: true });
  };
}

function shouldInjectError(state: MockHcmState, res: Response): boolean {
  if (!state.errorInjection || state.errorInjection.remainingCount <= 0) return false;

  const { statusCode } = state.errorInjection;
  state.errorInjection.remainingCount--;
  if (state.errorInjection.remainingCount <= 0) state.errorInjection = null;

  res.status(statusCode).json({ error: 'INJECTED_ERROR' });
  return true;
}
