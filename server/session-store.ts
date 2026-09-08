import type {Intent} from '../src/types.js';

export type CatalogKind = 'business' | 'basic';

export interface TaskSession {
  id: string;
  activeTask?: Intent;
  taskState?: string;
  slots: Record<string, unknown>;
  uiSelection: Record<string, unknown>;
  surfaceId?: string;
  catalog?: CatalogKind;
  selectedCard?: string;
  history: Array<{role: 'user' | 'assistant'; content: string}>;
}

const sessions = new Map<string, TaskSession>();

export function getSession(id: string): TaskSession {
  const key = id || 'default';
  let session = sessions.get(key);
  if (!session) {
    session = {
      id: key,
      slots: {},
      uiSelection: {},
      history: [],
    };
    sessions.set(key, session);
  }
  return session;
}

export function resetTask(session: TaskSession, intent: Intent) {
  if (session.activeTask !== intent) {
    session.activeTask = intent;
    session.taskState = undefined;
    session.slots = {};
    session.uiSelection = {};
    session.surfaceId = undefined;
    session.catalog = undefined;
    session.selectedCard = undefined;
  }
}

export function pushHistory(session: TaskSession, role: 'user' | 'assistant', content: string) {
  session.history.push({role, content});
  if (session.history.length > 12) session.history.splice(0, session.history.length - 12);
}

export function sessionSnapshot(session: TaskSession) {
  return {
    activeTask: session.activeTask ?? null,
    taskState: session.taskState ?? null,
    slots: session.slots,
    uiSelection: session.uiSelection,
    selectedCard: session.selectedCard ?? null,
    catalog: session.catalog ?? null,
  };
}
