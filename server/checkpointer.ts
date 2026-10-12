import type {RunnableConfig} from '@langchain/core/runnables';
import {BaseCheckpointSaver, WRITES_IDX_MAP, type Checkpoint, type CheckpointTuple,
  type CheckpointMetadata, type CheckpointListOptions, type PendingWrite} from '@langchain/langgraph-checkpoint';
import type {DatabaseSync} from 'node:sqlite';

// 使用 Node 自带 SQLite 保存官方检查点协议，避免本机扩展。 / Persist the official checkpoint contract with built-in SQLite.
export class NodeSqliteSaver extends BaseCheckpointSaver {
  constructor(private readonly db: DatabaseSync) {
    super();
    db.exec(`CREATE TABLE IF NOT EXISTS graph_checkpoints(thread TEXT, ns TEXT, id TEXT, parent TEXT,
      checkpoint_type TEXT, checkpoint BLOB, metadata_type TEXT, metadata BLOB, PRIMARY KEY(thread,ns,id));
      CREATE TABLE IF NOT EXISTS graph_writes(thread TEXT,ns TEXT,id TEXT,task TEXT,position INTEGER,
      channel TEXT,value_type TEXT,value BLOB,PRIMARY KEY(thread,ns,id,task,position));`);
  }
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const c = config.configurable ?? {};
    const row = c.checkpoint_id
      ? this.db.prepare('SELECT * FROM graph_checkpoints WHERE thread=? AND ns=? AND id=?').get(String(c.thread_id), String(c.checkpoint_ns ?? ''), String(c.checkpoint_id))
      : this.db.prepare('SELECT * FROM graph_checkpoints WHERE thread=? AND ns=? ORDER BY id DESC LIMIT 1').get(String(c.thread_id), String(c.checkpoint_ns ?? ''));
    if (!row) return undefined;
    const writes = this.db.prepare('SELECT * FROM graph_writes WHERE thread=? AND ns=? AND id=? ORDER BY task,position')
      .all(String(row.thread), String(row.ns), String(row.id));
    return {config: {configurable: {thread_id: row.thread, checkpoint_ns: row.ns, checkpoint_id: row.id}},
      checkpoint: await this.serde.loadsTyped(String(row.checkpoint_type), row.checkpoint as Uint8Array) as Checkpoint,
      metadata: await this.serde.loadsTyped(String(row.metadata_type), row.metadata as Uint8Array) as CheckpointMetadata,
      parentConfig: row.parent ? {configurable: {thread_id: row.thread, checkpoint_ns: row.ns, checkpoint_id: row.parent}} : undefined,
      pendingWrites: await Promise.all(writes.map(async w => [String(w.task), String(w.channel),
        await this.serde.loadsTyped(String(w.value_type), w.value as Uint8Array)] as [string,string,unknown]))};
  }
  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    const c = config.configurable ?? {};
    if (!c.thread_id) throw new Error('Missing graph thread_id');
    const [kind, data] = await this.serde.dumpsTyped(checkpoint);
    const [metaKind, metaData] = await this.serde.dumpsTyped(metadata);
    this.db.prepare('INSERT OR REPLACE INTO graph_checkpoints VALUES(?,?,?,?,?,?,?,?)')
      .run(String(c.thread_id), String(c.checkpoint_ns ?? ''), checkpoint.id, c.checkpoint_id ? String(c.checkpoint_id) : null,
        kind, Buffer.from(data), metaKind, Buffer.from(metaData));
    return {configurable: {thread_id: c.thread_id, checkpoint_ns: c.checkpoint_ns ?? '', checkpoint_id: checkpoint.id}};
  }
  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string) {
    const c = config.configurable ?? {};
    if (!c.thread_id || !c.checkpoint_id) throw new Error('Missing checkpoint identity');
    const special = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const rows = await Promise.all(writes.map(async ([channel, value], i) => {
      const [kind, data] = await this.serde.dumpsTyped(value);
      return [String(c.thread_id), String(c.checkpoint_ns ?? ''), String(c.checkpoint_id), taskId,
        WRITES_IDX_MAP[channel] ?? i, channel, kind, Buffer.from(data)] as const;
    }));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const statement = this.db.prepare(`INSERT OR ${special ? 'REPLACE' : 'IGNORE'} INTO graph_writes VALUES(?,?,?,?,?,?,?,?)`);
      for (const row of rows) statement.run(...row);
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  async *list(config: RunnableConfig, options: CheckpointListOptions = {}): AsyncGenerator<CheckpointTuple> {
    const rows = this.db.prepare('SELECT thread,ns,id FROM graph_checkpoints ORDER BY id DESC').all();
    let count = 0;
    for (const row of rows) {
      if (config.configurable?.thread_id && row.thread !== config.configurable.thread_id) continue;
      if (config.configurable?.checkpoint_ns !== undefined && row.ns !== config.configurable.checkpoint_ns) continue;
      if (options.before?.configurable?.checkpoint_id && String(row.id) >= options.before.configurable.checkpoint_id) continue;
      const tuple = await this.getTuple({configurable: {thread_id: row.thread, checkpoint_ns: row.ns, checkpoint_id: row.id}});
      if (!tuple || Object.entries(options.filter ?? {}).some(([key,value]) => JSON.stringify((tuple.metadata as Record<string, unknown> | undefined)?.[key]) !== JSON.stringify(value))) continue;
      if (options.limit !== undefined && count >= options.limit) return;
      count++; yield tuple;
    }
  }
  async deleteThread(threadId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM graph_writes WHERE thread=?').run(threadId);
      this.db.prepare('DELETE FROM graph_checkpoints WHERE thread=?').run(threadId);
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
}
