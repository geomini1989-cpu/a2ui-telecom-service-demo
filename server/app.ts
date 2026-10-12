import express from 'express';
import cors from 'cors';
import {resolve} from 'node:path';
import {TelecomStore} from './database.js';
import {TelecomWorkflow} from './workflow.js';
import {WorkflowError} from './errors.js';
import type {TelecomAction} from './action-router.js';

function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new WorkflowError(400, '无效的会话标识。');
  return value;
}
export function createApp(directory = process.env.TELECOM_DATA_DIR ?? resolve('.data')) {
  const store = new TelecomStore(directory);
  const workflow = new TelecomWorkflow(store);
  const app = express();
  app.use(cors()); app.use(express.json({limit: '128kb'}));
  const send = (res: express.Response, items: unknown[]) => {
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('cache-control', 'no-cache');
    for (const item of items) res.write(JSON.stringify(item) + '\n');
    res.end();
  };
  app.get('/api/health', (_req,res) => res.json({status:'ok', workflow:'langgraph', persistence:'sqlite', businessData:'demo'}));
  app.get('/api/session/:id', async (req,res,next) => {
    try {res.json(await workflow.restore(sessionId(req.params.id)));} catch (error) {next(error);}
  });
  app.post('/api/chat/stream', async (req,res,next) => {
    try {
      const id = sessionId(req.body?.sessionId);
      const message = req.body?.message;
      if (typeof message !== 'string' || !message.trim() || message.length > 4000 || !Number.isInteger(req.body?.expectedVersion)) {
        throw new WorkflowError(400, '消息或会话版本无效。');
      }
      send(res, await workflow.run(id, {kind:'chat', message, expectedVersion:req.body.expectedVersion}));
    } catch (error) {next(error);}
  });
  app.post('/api/action/stream', async (req,res,next) => {
    try {
      const id = sessionId(req.body?.sessionId);
      const action = req.body?.action as TelecomAction;
      if (!action || typeof action.name !== 'string' || typeof action.surfaceId !== 'string' ||
          (action.context !== undefined && (!action.context || typeof action.context !== 'object' || Array.isArray(action.context)))) {
        throw new WorkflowError(400, '界面操作无效。');
      }
      send(res, await workflow.run(id, {kind:'action', action}));
    } catch (error) {next(error);}
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof WorkflowError ? error.status : 500;
    if (status === 500) console.error(error);
    res.status(status).json({error: error instanceof WorkflowError ? error.message : '服务处理失败，请恢复会话后重试。'});
  });
  return {app, store, workflow};
}
