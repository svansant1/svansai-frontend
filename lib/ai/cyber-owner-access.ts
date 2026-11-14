import type { ContextView } from "@/lib/context/types";
/** A bounded fallback must not invent an IP, operating system, scan, or remote service. */
export function buildOwnerDeviceAccessResponse(_view: ContextView, _request: string): string {
  return "Cyber Lab could not complete this response. Your saved investigation evidence is retained. No command was executed. Check the target/scanner details in the evidence panel before continuing; I will not substitute an example IP or assume a remote-access method.";
}
