import express, { Application } from 'express';
import { Server } from 'http';
import { createInitialState, MockHcmState, makeBalanceKey } from './state';
import { handleGetBalance, handleDeductBalance, handleCreditBalance } from './handlers';
import { buildControlRouter } from './control.routes';

export class MockHcmServer {
  private app: Application;
  private server: Server | null = null;
  private state: MockHcmState;
  public port: number;

  constructor(port = 4001) {
    this.port = port;
    this.state = createInitialState();
    this.app = express();
    this.app.use(express.json());
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.app.get('/balance', handleGetBalance(this.state));
    this.app.post('/balance/deduct', handleDeductBalance(this.state));
    this.app.post('/balance/credit', handleCreditBalance(this.state));
    this.app.use('/test', buildControlRouter(this.state));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // ── Convenience helpers for test setup ─────────────────────────────────────

  seed(record: { employeeId: string; locationId: string; leaveType: string; balance: number }): void {
    const key = makeBalanceKey(record.employeeId, record.locationId, record.leaveType);
    this.state.balances.set(key, { ...record });
  }

  injectError(opts: { nextN: number; statusCode: number }): void {
    this.state.errorInjection = { statusCode: opts.statusCode, remainingCount: opts.nextN };
  }

  setBalance(employeeId: string, locationId: string, leaveType: string, newBalance: number): void {
    const key = makeBalanceKey(employeeId, locationId, leaveType);
    const existing = this.state.balances.get(key);
    if (existing) {
      existing.balance = newBalance;
    } else {
      this.state.balances.set(key, { employeeId, locationId, leaveType, balance: newBalance });
    }
  }

  reset(): void {
    const fresh = createInitialState();
    this.state.balances = fresh.balances;
    this.state.errorInjection = fresh.errorInjection;
    this.state.processedEventIds = fresh.processedEventIds;
  }

  getBalance(employeeId: string, locationId: string, leaveType: string): number | undefined {
    return this.state.balances.get(makeBalanceKey(employeeId, locationId, leaveType))?.balance;
  }
}
