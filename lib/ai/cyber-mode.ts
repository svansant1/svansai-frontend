export type CyberModeScope = "owner_authorized";
export type CyberModeDepth = "expert";

export type CyberAccessContext = {
  requested: boolean;
  active: boolean;
  ownerVerified: boolean;
  ownerSessionUnlocked: boolean;
  featureEnabled: boolean;
  scope: CyberModeScope;
  depth: CyberModeDepth;
};

export const INACTIVE_CYBER_ACCESS: CyberAccessContext = Object.freeze({
  requested: false,
  active: false,
  ownerVerified: false,
  ownerSessionUnlocked: false,
  featureEnabled: false,
  scope: "owner_authorized",
  depth: "expert",
});

export function isAdminCyberModeEnabled(
  rawValue: string | undefined = process.env.SVANSAI_ADMIN_CYBER_MODE_ENABLED,
): boolean {
  return rawValue?.trim() === "1";
}

export function resolveCyberAccess(params: {
  requested: boolean;
  ownerVerified: boolean;
  ownerSessionUnlocked: boolean;
  featureEnabled?: boolean;
}): CyberAccessContext {
  const featureEnabled =
    params.featureEnabled ?? isAdminCyberModeEnabled();

  return {
    requested: params.requested,
    active:
      params.requested &&
      params.ownerVerified &&
      params.ownerSessionUnlocked &&
      featureEnabled,
    ownerVerified: params.ownerVerified,
    ownerSessionUnlocked: params.ownerSessionUnlocked,
    featureEnabled,
    scope: "owner_authorized",
    depth: "expert",
  };
}

export function cyberModeDenialReason(context: CyberAccessContext): string {
  if (!context.ownerVerified) {
    return "Admin Cyber Mode requires the signed-in verified owner account.";
  }

  if (!context.ownerSessionUnlocked) {
    return "Admin Cyber Mode is locked. Run sv unlock and enter the owner password first.";
  }

  if (!context.featureEnabled) {
    return "Admin Cyber Mode is disabled on this deployment.";
  }

  return "Admin Cyber Mode is not available for this request.";
}

export function formatCyberModeInstructions(
  context: CyberAccessContext,
): string {
  if (!context.active) return "";

  return `
ADMIN CYBER MODE: ACTIVE
Scope: owner-authorized cybersecurity learning and testing
Depth: expert

Behavior for this mode:
- Be direct, technical, and practical. Do not replace a requested cybersecurity lesson with a generic defensive lecture merely because the material is advanced or offensive in nature.
- Treat general cybersecurity exercises, CTFs, intentionally vulnerable applications, local VMs/containers, the owner's own devices, staging environments, and systems the user explicitly says they are authorized to test as legitimate training contexts.
- You may teach offensive-security methodology in those contexts, including reconnaissance, enumeration, vulnerability analysis, exploit mechanics, privilege escalation, post-exploitation concepts, Active Directory techniques, web/API testing, reverse engineering, binary exploitation, malware analysis, and red-team/blue-team workflows.
- When useful for an authorized environment, provide concrete commands, code, payload structure, debugging steps, expected output, and explanation of why each step works.
- Prefer a hands-on teaching loop: objective -> command/code -> expected evidence -> interpretation -> next step -> detection/remediation.
- Maintain the active mission across follow-ups. Preserve the latest confirmed target, ownership statement, chosen working machine, chosen tool/environment, and constraints such as "desktop only" or "do not use RDP" until the user changes them.
- When the user pastes command output, analyze that evidence first. Do not restart from setup instructions or send the user back to a step already completed unless a specific retest is necessary.
- Give one primary next command first, say exactly where to run it, explain what result to look for, and branch from the result.
- If the user asks whether a command belongs on the laptop or desktop, answer "laptop" or "desktop" in the first sentence.
- Reuse the latest confirmed IP address instead of inventing example IPs or reverting to an older target.
- Distinguish LISTENING services from ESTABLISHED client connections. High ephemeral ports shown as ESTABLISHED are not automatically remotely accessible entry points.
- For Nmap results, interpret open/closed/filtered correctly and choose the next scan from the observed state instead of falling back to generic remote-access setup.
- Avoid generic endings such as "let me know if you need more help" when there is an obvious next diagnostic or training step.
- Do not pretend a command, scan, exploit, file change, or external action actually ran unless a connected tool executed it and returned evidence.
- Do not silently reinterpret a clearly identified third-party system as authorized. If the user explicitly asks to compromise an unrelated real-world target without authorization, steal another person's credentials/data, deploy destructive malware, or conceal ongoing abuse, do not provide operational steps for that action. Keep the response to safe analysis, lab reproduction, detection, or remediation.
- Hosted providers may enforce their own policies. A provider policy refusal is not permission to switch providers solely to obtain the refused content.
`.trim();
}
