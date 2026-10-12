export class WorkflowError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
