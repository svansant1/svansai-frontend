import { CapabilityError, type CapabilityDefinition, type ExecutionContext, type ExecutionState } from "./contracts";

/** Records execution facts, not model reasoning or inferred module activity. */
export async function runCapability<Input, Output>(definition: CapabilityDefinition<Input, Output>, rawInput: unknown, context: ExecutionContext): Promise<Output> {
  const event = async (state: ExecutionState, detail: string) => {
    const entry = { sequence: context.events.length + 1, requestId: context.requestId,
      capabilityId: definition.id, name: definition.name, state, at: new Date().toISOString(), detail };
    context.events.push(entry);
    await context.onEvent?.(entry);
  };
  const cancelled = () => { if (context.signal?.aborted) throw new CapabilityError("cancelled", "The request was cancelled."); };
  const authorized = async () => {
    try { await context.assertAuthorized?.(); }
    catch { throw new CapabilityError("blocked", "Live authorization is no longer available. Unlock or review the investigation before retrying."); }
  };
  try {
    cancelled();
    await authorized();
    const availability = definition.available();
    if (!availability.available) throw new CapabilityError("blocked", availability.reason || "This capability is not configured.");
    if (definition.permissions.some((permission) => !context.permissions.has(permission))) throw new CapabilityError("blocked", "This capability requires additional permission.");
    // External actions must go through the durable payload-bound approval executor, not chat.
    if (definition.sideEffects === "external") throw new CapabilityError("blocked", "External actions require the approval workflow.");
    const input = definition.parse(rawInput);
    await event("started", `${definition.name} started.`);
    const output = await definition.execute(input, context);
    cancelled();
    await authorized();
    await event("validating", definition.validation);
    await definition.validate(output);
    cancelled();
    await authorized();
    await event("completed", `${definition.name} completed. ${definition.validation}`);
    return output;
  } catch (error) {
    const known = error instanceof CapabilityError;
    await event(known ? error.code : "failed", known ? error.message : `${definition.name} did not complete.`);
    throw error;
  }
}
