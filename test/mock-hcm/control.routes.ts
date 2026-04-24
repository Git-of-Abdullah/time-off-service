import { Router, Request, Response } from 'express';
import { MockHcmState, makeBalanceKey, createInitialState } from './state';

export function buildControlRouter(state: MockHcmState): Router {
  const router = Router();

  router.post('/seed', (req: Request, res: Response) => {
    const { employeeId, locationId, leaveType, balance } = req.body as {
      employeeId: string;
      locationId: string;
      leaveType: string;
      balance: number;
    };
    const key = makeBalanceKey(employeeId, locationId, leaveType);
    state.balances.set(key, { employeeId, locationId, leaveType, balance });
    res.json({ seeded: true, key });
  });

  router.post('/inject-error', (req: Request, res: Response) => {
    const { nextN, statusCode } = req.body as { nextN: number; statusCode: number };
    state.errorInjection = { statusCode, remainingCount: nextN };
    res.json({ injected: true });
  });

  router.post('/set-balance', (req: Request, res: Response) => {
    const { employeeId, locationId, leaveType, newBalance } = req.body as {
      employeeId: string;
      locationId: string;
      leaveType: string;
      newBalance: number;
    };
    const key = makeBalanceKey(employeeId, locationId, leaveType);
    const existing = state.balances.get(key);
    if (existing) {
      existing.balance = newBalance;
    } else {
      state.balances.set(key, { employeeId, locationId, leaveType, balance: newBalance });
    }
    res.json({ updated: true });
  });

  router.post('/reset', (_req: Request, res: Response) => {
    const fresh = createInitialState();
    state.balances = fresh.balances;
    state.errorInjection = fresh.errorInjection;
    state.processedEventIds = fresh.processedEventIds;
    res.json({ reset: true });
  });

  router.get('/state', (_req: Request, res: Response) => {
    res.json({
      balances: Object.fromEntries(state.balances),
      errorInjection: state.errorInjection,
    });
  });

  return router;
}
