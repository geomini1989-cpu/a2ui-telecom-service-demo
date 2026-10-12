import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {OrderData} from '../src/types.js';
import type {TaskSession} from './session-store.js';
import {WorkflowError} from './errors.js';
import {findOrder} from './a2ui-builder.js';

export interface PendingOrder {id: string; order: OrderData; workflowId: string; surfaceId: string}
export interface Receipt {orderId: string; packageId: string; title: string; price: number; summary: string}
export class TelecomStore {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, {recursive: true});
    this.db = new DatabaseSync(join(directory, 'telecom.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL,
        status TEXT NOT NULL, receipt TEXT);
      CREATE INDEX IF NOT EXISTS orders_session ON orders(session_id);`);
  }
  getSession(id: string): TaskSession {
    const row = this.db.prepare('SELECT payload FROM sessions WHERE id=?').get(id);
    if (row) return JSON.parse(String(row.payload)) as TaskSession;
    const session: TaskSession = {id, version: 0, balanceCents: 5680, slots: {}, uiSelection: {}, history: [], restoreMessages: []};
    this.db.prepare('INSERT OR IGNORE INTO sessions VALUES(?,?,?)').run(id, 0, JSON.stringify(session));
    return JSON.parse(String(this.db.prepare('SELECT payload FROM sessions WHERE id=?').get(id)!.payload)) as TaskSession;
  }
  begin(session: TaskSession, expected: number) {
    session.version = expected + 1;
    const result = this.db.prepare('UPDATE sessions SET version=?,payload=? WHERE id=? AND version=?')
      .run(session.version, JSON.stringify(session), session.id, expected);
    if (!result.changes) throw new WorkflowError(409, '会话已变化，请恢复最新界面后重试。');
  }
  save(session: TaskSession) {
    const result = this.db.prepare('UPDATE sessions SET payload=? WHERE id=? AND version=?')
      .run(JSON.stringify(session), session.id, session.version);
    if (!result.changes) throw new WorkflowError(409, '会话已变化，请恢复最新界面后重试。');
  }
  prepare(session: TaskSession, pending: PendingOrder) {
    this.transaction(() => {
      this.db.prepare("UPDATE orders SET status='cancelled' WHERE session_id=? AND status='pending'").run(session.id);
      this.db.prepare("INSERT INTO orders VALUES(?,?,?,'pending',NULL)").run(pending.id, session.id, JSON.stringify(pending));
      session.pendingOrder = pending;
      this.save(session);
    });
  }
  receipt(sessionId: string, orderId: string): Receipt | undefined {
    const row = this.db.prepare("SELECT receipt FROM orders WHERE id=? AND session_id=? AND status='completed'").get(orderId, sessionId);
    return row?.receipt ? JSON.parse(String(row.receipt)) as Receipt : undefined;
  }
  cancel(session: TaskSession) {
    if (session.pendingOrder) this.db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND session_id=? AND status='pending'")
      .run(session.pendingOrder.id, session.id);
    session.pendingOrder = undefined;
  }
  execute(session: TaskSession, orderId: string): Receipt {
    return this.transaction(() => {
      const current = this.getSession(session.id);
      if (current.version !== session.version || current.pendingOrder?.id !== orderId) {
        throw new WorkflowError(409, '待办订单已变化，请重新确认。');
      }
      const row = this.db.prepare('SELECT * FROM orders WHERE id=? AND session_id=?').get(orderId, session.id);
      if (!row || row.status === 'cancelled') throw new WorkflowError(409, '订单已取消或不属于当前会话。');
      if (row.receipt) {
        // 回放结果必须使用已提交的余额，不能恢复旧检查点余额。 / Receipt replay must retain the committed balance, not a stale checkpoint balance.
        session.balanceCents = current.balanceCents;
        session.taskState = 'completed';
        session.selectedCard = 'ResultCard';
        return JSON.parse(String(row.receipt)) as Receipt;
      }
      const pending = JSON.parse(String(row.payload)) as PendingOrder;
      if (JSON.stringify(findOrder(pending.order.packageId)) !== JSON.stringify(pending.order)) throw new WorkflowError(409, '套餐信息已变化，请重新选择。');
      if (current.balanceCents < Math.round(pending.order.price * 100)) throw new WorkflowError(409, '余额已变化，请重新选择套餐。');
      const receipt: Receipt = {orderId: `DEMO-${orderId}`, packageId: pending.order.packageId,
        title: pending.order.title, price: pending.order.price, summary: `${pending.order.title} 已模拟办理成功，订单号 ${orderId}。`};
      session.balanceCents = current.balanceCents - Math.round(receipt.price * 100);
      session.taskState = 'completed';
      session.selectedCard = 'ResultCard';
      this.db.prepare("UPDATE orders SET status='completed',receipt=? WHERE id=?").run(JSON.stringify(receipt), orderId);
      this.save(session);
      return receipt;
    });
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {const result = work(); this.db.exec('COMMIT'); return result;}
    catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  close() {this.db.close();}
}
