import type { CapabilityDefinition, CapabilityManifest } from "./contracts";

/** Only callable definitions are registered. Roadmap items do not appear as available tools. */
export class CapabilityRegistry<Input, Output> {
  private readonly definitions = new Map<string, CapabilityDefinition<Input, Output>>();
  register(definition: CapabilityDefinition<Input, Output>): void {
    if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(definition.id) || this.definitions.has(definition.id)) throw new Error("Invalid or duplicate capability ID.");
    this.definitions.set(definition.id, definition);
  }
  get(id: string): CapabilityDefinition<Input, Output> {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error("Capability is not installed.");
    return definition;
  }
  manifests(): Array<CapabilityManifest & { available: boolean; reason?: string }> {
    return [...this.definitions.values()].map(({ parse: _parse, execute: _execute, validate: _validate, available, ...manifest }) => ({ ...manifest, ...available() }));
  }
}
