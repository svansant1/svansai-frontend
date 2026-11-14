export type ExecutionState = "started" | "validating" | "completed" | "failed" | "blocked" | "cancelled";
export type ExecutionEvent = {
  sequence: number;
  requestId: string;
  capabilityId: string;
  name: string;
  state: ExecutionState;
  at: string;
  detail: string;
};
export type ExecutionContext = {
  requestId: string;
  /** Constructed by trusted server code, never copied from model output. */
  permissions: ReadonlySet<string>;
  signal?: AbortSignal;
  /** Live authorization check; unlike a permission label this can observe revocation. */
  assertAuthorized?: () => Promise<void>;
  events: ExecutionEvent[];
  /** A durable worker can require a journal write before the next step runs. */
  onEvent?: (event: ExecutionEvent) => Promise<void>;
};
export type CapabilityManifest = {
  id: string;
  version: 1;
  name: string;
  inputs: string[];
  outputs: string[];
  permissions: string[];
  sideEffects: "none" | "artifact" | "external";
  validation: string;
};
export type CapabilityDefinition<Input, Output> = CapabilityManifest & {
  parse: (input: unknown) => Input;
  available: () => { available: boolean; reason?: string };
  execute: (input: Input, context: ExecutionContext) => Promise<Output>;
  validate: (output: Output) => void | Promise<void>;
};
export class CapabilityError extends Error {
  constructor(public readonly code: "blocked" | "failed" | "cancelled", message: string) { super(message); this.name = "CapabilityError"; }
}
