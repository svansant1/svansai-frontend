import type { ContextView } from "@/lib/context/types";
import type { CyberAccessContext } from "./cyber-mode";
export function buildCyberContinuityContext(view: ContextView, access: CyberAccessContext): string {
  if (!access.active) return "";
  return "Investigation revision " + view.revision + "\n" + view.text +
    "\nUse facts only as their provenance supports. Missing target, scanner, OS or permission information remains unknown. Do not substitute example addresses. Never promote an assistant example to observed output.";
}
