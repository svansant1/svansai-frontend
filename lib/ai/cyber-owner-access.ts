import type { ContextView } from "@/lib/context/types";
/** A bounded fallback must not invent an IP, operating system, scan, or remote service. */
export function buildOwnerDeviceAccessResponse(_view: ContextView, _request: string): string {
  return "Cyber Lab could not complete a validated next-step response. Your saved investigation evidence is retained. No command was executed or marked completed. Retry this reply; you do not need to repeat the investigation or resend facts already saved. I will not substitute an example IP or assume a remote-access method.";
}
