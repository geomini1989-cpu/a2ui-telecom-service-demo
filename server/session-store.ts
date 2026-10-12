import type {Intent} from '../src/types.js';
import type {PendingOrder} from './database.js';
export type CatalogKind = 'business' | 'basic';
export interface TaskSession {
  id: string;
  version: number;
  balanceCents: number;
  workflowId?: string;
  pendingOrder?: PendingOrder;
  activeTask?: Intent;
  taskState?: string;
  slots: Record<string, unknown>;
  uiSelection: Record<string, unknown>;
  surfaceId?: string;
  catalog?: CatalogKind;
  selectedCard?: string;
  history: Array<{role: 'user' | 'assistant'; content: string}>;
  restoreMessages: unknown[];
  lastDebug?: Record<string, unknown>;
}
export function pushHistory(session: TaskSession, role: 'user' | 'assistant', content: string) {
  session.history.push({role, content});
  if (session.history.length > 12) session.history.splice(0, session.history.length - 12);
}
export function sessionSnapshot(session: TaskSession) {
  return {activeTask: session.activeTask ?? null, taskState: session.taskState ?? null,
    slots: session.slots, uiSelection: session.uiSelection, selectedCard: session.selectedCard ?? null,
    catalog: session.catalog ?? null, version: session.version, pendingOrderId: session.pendingOrder?.id ?? null};
}
