import type { AttachedFile } from "@/lib/ai/file-types";
import type { ChatMessage, ResponseMode } from "@/lib/ai/types";
import type { UserMemory } from "@/lib/personalization/structured-memory";

export type MindIntent =
  | "education"
  | "coding"
  | "writing"
  | "research"
  | "image_generation"
  | "image_editing"
  | "file_analysis"
  | "workspace"
  | "site_safety"
  | "platform_build"
  | "debug"
  | "conversation";

export type MindToolId =
  | "education_solver"
  | "fallback_resolver"
  | "web_search"
  | "site_safety_checker"
  | "image_generation"
  | "image_editing"
  | "ocr"
  | "file_analysis"
  | "folder_analysis"
  | "code_editor"
  | "terminal_sandbox"
  | "database_access"
  | "email_calendar"
  | "document_generation"
  | "spreadsheet_generation"
  | "api_call"
  | "writing_profile"
  | "memory_recall"
  | "self_improvement_queue";

export type MindToolDecision = {
  tool: MindToolId;
  status: "active" | "available" | "permission_required" | "future";
  confidence: number;
  reason: string;
};

export type PermissionPosture = {
  localFiles:
    | "none"
    | "uploaded_only"
    | "selected_folder_required"
    | "trusted_workspace_required";
  writes: "blocked" | "owner_approval_required";
  externalActions:
    | "blocked"
    | "owner_approval_required"
    | "allowed_for_safe_readonly";
  auditRequired: boolean;
  note: string;
};

export type SvansMindPlan = {
  version: string;
  primaryIntent: MindIntent;
  confidence: number;
  activeTask: {
    type: MindIntent;
    subject: string;
    goal: string;
    continuityNeed: string;
  };
  tools: MindToolDecision[];
  memoryPlan: {
    recall: boolean;
    storeCandidate: boolean;
    rankingSignals: string[];
    ignoreNoise: string[];
  };
  reflectionChecks: string[];
  improvementSuggestions: string[];
  permissionPosture: PermissionPosture;
  commandCenter: string[];
};

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function compact(text: string, max = 180) {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function latestAssistant(messages: ChatMessage[]) {
  return (
    [...messages].reverse().find((message) => message.role === "assistant")
      ?.content ?? ""
  );
}

function detectSubject(message: string) {
  const normalized = normalize(message);
  if (/\bpython|def |if |elif|function|return|print\(|input\(/.test(normalized))
    return "Python / programming";
  if (
    /\bdns|router|bandwidth|ip address|network|osi|switch|subnet|mac address\b/.test(
      normalized,
    )
  )
    return "Networking";
  if (/\bubuntu|linux|apps list|terminal|dash|dock\b/.test(normalized))
    return "Linux / operating systems";
  if (/\bdiscussion post|professor|classmates|reply\b/.test(normalized))
    return "School writing";
  if (/\bscam|fraud|legit|bbb|trustworthy|safe site\b/.test(normalized))
    return "Website safety";
  if (
    /\bsvans-ai|svansai|vansant platform|shield|debugger|sandbox|vos\b/.test(
      normalized,
    )
  )
    return "Vansant Platform";
  return "General";
}

function detectPrimaryIntent(
  message: string,
  files: AttachedFile[],
  mode: ResponseMode,
): MindIntent {
  const normalized = normalize(message);
  if (
    mode === "debug" ||
    /\b(debug|error|bug|broken|stack trace|not working)\b/.test(normalized)
  )
    return "debug";
  if (
    /\b(sc(a|u)m|fraud|legit|trustworthy|bbb|safe site|fake site)\b/.test(
      normalized,
    )
  )
    return "site_safety";
  if (
    /\b(generate|create|make|draw|design|render|produce)\b.{0,80}\b(photo|image|picture|artwork|illustration|graphic|logo|wallpaper|poster)\b/.test(
      normalized,
    )
  )
    return "image_generation";
  if (
    files.some((file) => file.type.startsWith("image/")) &&
    /\b(edit|change|modify|cross|remove|add|replace)\b/.test(normalized)
  )
    return "image_editing";
  if (
    files.length ||
    /\b(file|folder|pdf|document|spreadsheet|screenshot|analyze this)\b/.test(
      normalized,
    )
  )
    return "file_analysis";
  if (
    /\b(c drive|workspace|local folder|selected folder|full access|permission|vos bridge)\b/.test(
      normalized,
    )
  )
    return "workspace";
  if (
    /\b(quiz|homework|question|answer choices|group of answer choices|study|chapter|complete the|what is|which)\b/.test(
      normalized,
    )
  )
    return "education";
  if (
    /\b(code|function|class|api|typescript|javascript|python|compile|program)\b/.test(
      normalized,
    )
  )
    return "coding";
  if (
    /\b(write|rewrite|refine|proofread|email|reply|discussion post|grammar|sound like me)\b/.test(
      normalized,
    )
  )
    return "writing";
  if (
    /\b(search|browse|internet|current|latest|today|source|research|website|url|domain)\b/.test(
      normalized,
    )
  )
    return "research";
  if (
    mode === "build" ||
    /\b(build|implement|upgrade|phase|platform|feature)\b/.test(normalized)
  )
    return "platform_build";
  return "conversation";
}

function confidenceForIntent(
  intent: MindIntent,
  message: string,
  files: AttachedFile[],
) {
  const normalized = normalize(message);
  let confidence = 0.68;
  if (
    intent === "education" &&
    /\b(answer choices|group of answer choices|quiz|complete the|sample output)\b/.test(
      normalized,
    )
  )
    confidence = 0.9;
  if (
    intent === "image_generation" &&
    /\b(generate|create|make|draw|render)\b/.test(normalized)
  )
    confidence = 0.92;
  if (
    intent === "site_safety" &&
    /\bhttps?:\/\/|[a-z0-9-]+\.[a-z]{2,}\b/.test(normalized)
  )
    confidence = 0.94;
  if (intent === "file_analysis" && files.length) confidence = 0.9;
  if (intent === "workspace") confidence = 0.86;
  return confidence;
}

function addTool(
  tools: MindToolDecision[],
  tool: MindToolId,
  status: MindToolDecision["status"],
  confidence: number,
  reason: string,
) {
  if (tools.some((item) => item.tool === tool)) return;
  tools.push({ tool, status, confidence, reason });
}

function buildToolPlan(
  intent: MindIntent,
  message: string,
  files: AttachedFile[],
  memories: UserMemory[],
): MindToolDecision[] {
  const normalized = normalize(message);
  const tools: MindToolDecision[] = [];

  if (
    intent === "education" ||
    /\b(answer choices|quiz|homework|sample output|complete the)\b/.test(
      normalized,
    )
  ) {
    addTool(
      tools,
      "education_solver",
      "active",
      0.9,
      "Classroom or quiz-style prompt detected.",
    );
    addTool(
      tools,
      "fallback_resolver",
      "active",
      0.86,
      "Prevent weak generic responses on simple questions.",
    );
  }

  if (intent === "research" || intent === "site_safety") {
    addTool(
      tools,
      "web_search",
      "active",
      0.88,
      "Request may need current or external information.",
    );
  }

  if (intent === "site_safety") {
    addTool(
      tools,
      "site_safety_checker",
      "active",
      0.93,
      "Website reputation/scam request detected.",
    );
  }

  if (intent === "image_generation") {
    addTool(
      tools,
      "image_generation",
      "active",
      0.94,
      "User is asking SVANS-AI to create an image.",
    );
  }

  if (intent === "image_editing") {
    addTool(
      tools,
      "image_editing",
      "available",
      0.78,
      "Attached image can be modified when an image-edit provider is wired.",
    );
  }

  if (files.some((file) => file.type.startsWith("image/")))
    addTool(
      tools,
      "ocr",
      "available",
      0.72,
      "Images may contain readable text.",
    );
  if (files.length)
    addTool(
      tools,
      "file_analysis",
      "active",
      0.9,
      "Uploaded files should be treated as primary context.",
    );
  if (files.some((file) => /[\\/]/.test(file.name)))
    addTool(
      tools,
      "folder_analysis",
      "active",
      0.86,
      "Uploaded files include folder paths.",
    );

  if (
    intent === "coding" ||
    intent === "debug" ||
    intent === "platform_build"
  ) {
    addTool(
      tools,
      "code_editor",
      "permission_required",
      0.76,
      "Code changes require approved workspace access.",
    );
    addTool(
      tools,
      "terminal_sandbox",
      "permission_required",
      0.72,
      "Execution should happen in a sandbox or approved workspace.",
    );
  }

  if (/\b(database|supabase|sql|table|schema)\b/.test(normalized))
    addTool(
      tools,
      "database_access",
      "permission_required",
      0.75,
      "Database access requires credentials and scope.",
    );
  if (
    /\b(email|gmail|outlook|calendar|meeting|schedule invite|appointment)\b/.test(
      normalized,
    )
  )
    addTool(
      tools,
      "email_calendar",
      "future",
      0.7,
      "Email/calendar integrations should be connected later with explicit account permission.",
    );
  if (/\b(document|docx|pdf|report)\b/.test(normalized))
    addTool(
      tools,
      "document_generation",
      "available",
      0.74,
      "Document generation can create structured deliverables.",
    );
  if (/\b(spreadsheet|excel|csv|xlsx|table)\b/.test(normalized))
    addTool(
      tools,
      "spreadsheet_generation",
      "available",
      0.74,
      "Spreadsheet generation/analysis can support tabular tasks.",
    );
  if (/\b(api|endpoint|webhook|call)\b/.test(normalized))
    addTool(
      tools,
      "api_call",
      "available",
      0.72,
      "API calls may support the requested workflow.",
    );
  if (
    intent === "writing" ||
    /\b(sound like me|my style|voice|tone)\b/.test(normalized)
  )
    addTool(
      tools,
      "writing_profile",
      "active",
      0.84,
      "Writing/personality profile should shape the response.",
    );
  if (
    memories.length ||
    /\b(remember|my preference|my style|current project)\b/.test(normalized)
  )
    addTool(
      tools,
      "memory_recall",
      memories.length ? "active" : "available",
      0.78,
      "Relevant approved memories can improve continuity.",
    );
  if (
    /\b(failed|generic|fallback|improve|wrong|not right|upgrade)\b/.test(
      normalized,
    )
  )
    addTool(
      tools,
      "self_improvement_queue",
      "active",
      0.82,
      "Failure or upgrade signal should be captured for improvement.",
    );

  return tools.sort((a, b) => b.confidence - a.confidence);
}

function permissionPosture(
  intent: MindIntent,
  files: AttachedFile[],
): PermissionPosture {
  if (intent === "workspace") {
    return {
      localFiles: "selected_folder_required",
      writes: "owner_approval_required",
      externalActions: "owner_approval_required",
      auditRequired: true,
      note: "Direct local path access requires a VOS/local workspace bridge with explicit folder scope.",
    };
  }

  if (files.length) {
    return {
      localFiles: "uploaded_only",
      writes: "blocked",
      externalActions: "allowed_for_safe_readonly",
      auditRequired: true,
      note: "SVANS-AI can analyze uploaded files but cannot write back to local disk from web chat.",
    };
  }

  return {
    localFiles: "none",
    writes: "blocked",
    externalActions: "allowed_for_safe_readonly",
    auditRequired: false,
    note: "No local workspace access is active for this request.",
  };
}

function commandCenterStatuses(
  tools: MindToolDecision[],
  memories: UserMemory[],
  files: AttachedFile[],
) {
  const statuses = tools
    .filter((tool) => tool.status === "active")
    .slice(0, 5)
    .map((tool) => {
      if (tool.tool === "web_search") return "Searching web…";
      if (tool.tool === "site_safety_checker")
        return "Checking site reputation…";
      if (tool.tool === "image_generation") return "Generating image…";
      if (tool.tool === "education_solver") return "Using education solver…";
      if (tool.tool === "fallback_resolver")
        return "Guarding against weak fallback…";
      if (tool.tool === "file_analysis") return "Analyzing uploaded files…";
      if (tool.tool === "folder_analysis")
        return "Reading folder upload structure…";
      if (tool.tool === "writing_profile") return "Applying writing profile…";
      if (tool.tool === "memory_recall") return "Memory recalled…";
      if (tool.tool === "self_improvement_queue")
        return "Improvement signal captured…";
      return `${tool.tool.replaceAll("_", " ")}…`;
    });

  if (files.length && !statuses.includes("Analyzing uploaded files…"))
    statuses.push("Files attached…");
  if (memories.length && !statuses.includes("Memory recalled…"))
    statuses.push("Memory available…");
  return Array.from(new Set(statuses));
}

export function buildSvansMindPlan(params: {
  messages: ChatMessage[];
  latestMessage: string;
  attachedFiles: AttachedFile[];
  responseMode: ResponseMode;
  userMemories: UserMemory[];
}): SvansMindPlan {
  const intent = detectPrimaryIntent(
    params.latestMessage,
    params.attachedFiles,
    params.responseMode,
  );
  const subject = detectSubject(params.latestMessage);
  const confidence = confidenceForIntent(
    intent,
    params.latestMessage,
    params.attachedFiles,
  );
  const tools = buildToolPlan(
    intent,
    params.latestMessage,
    params.attachedFiles,
    params.userMemories,
  );
  const previousAssistant = latestAssistant(params.messages);
  const lowerPrevious = normalize(previousAssistant);
  const storeCandidate =
    /\b(remember|prefer|always|never|my style|my project|my class|goal)\b/i.test(
      params.latestMessage,
    ) ||
    lowerPrevious.includes("couldn’t generate a strong answer") ||
    lowerPrevious.includes("couldn't generate a strong answer");

  return {
    version: "svans-mind-1",
    primaryIntent: intent,
    confidence,
    activeTask: {
      type: intent,
      subject,
      goal: compact(params.latestMessage || "Respond helpfully."),
      continuityNeed:
        params.messages.length > 2
          ? "Use the current chat task before pulling unrelated long-term memory."
          : "Treat this as a fresh task unless memory is directly relevant.",
    },
    tools,
    memoryPlan: {
      recall: params.userMemories.length > 0,
      storeCandidate,
      rankingSignals: [
        "recency",
        "user approval",
        "importance",
        "project relevance",
        "correction history",
      ],
      ignoreNoise: [
        "one-off quiz answers",
        "raw pasted text without user approval",
        "unrelated self-improvement snippets",
      ],
    },
    reflectionChecks: [
      "Answer the latest user turn directly.",
      "Use tools only when their signal beats normal reasoning.",
      "Reject generic fallback wording for simple education/coding questions.",
      "Ask a question only when missing information changes the outcome.",
      "Use memory as context, not as the final answer.",
    ],
    improvementSuggestions: [
      ...(tools.some((tool) => tool.tool === "fallback_resolver")
        ? [
            "If response confidence is low, queue a failure-learning item instead of returning a generic stall.",
          ]
        : []),
      ...(intent === "education"
        ? [
            "Add this prompt shape to education regression tests when it exposes a new failure.",
          ]
        : []),
      ...(intent === "workspace"
        ? [
            "Route future local-path requests through a VOS permission bridge before file reads/writes.",
          ]
        : []),
    ],
    permissionPosture: permissionPosture(intent, params.attachedFiles),
    commandCenter: commandCenterStatuses(
      tools,
      params.userMemories,
      params.attachedFiles,
    ),
  };
}

export function formatSvansMindPlan(plan: SvansMindPlan): string {
  return `
SVANS-Mind plan:
- Mind version: ${plan.version}
- Primary intent: ${plan.primaryIntent}
- Confidence: ${Math.round(plan.confidence * 100)}%
- Active task: ${plan.activeTask.type} / ${plan.activeTask.subject}
- Goal: ${plan.activeTask.goal}
- Continuity need: ${plan.activeTask.continuityNeed}
- Tools: ${
    plan.tools.length
      ? plan.tools
          .map(
            (tool) =>
              `${tool.tool} (${tool.status}, ${Math.round(tool.confidence * 100)}%): ${tool.reason}`,
          )
          .join("; ")
      : "No external tool needed."
  }
- Memory: recall=${plan.memoryPlan.recall ? "yes" : "no"}; store candidate=${plan.memoryPlan.storeCandidate ? "yes" : "no"}; ranking=${plan.memoryPlan.rankingSignals.join(", ")}
- Permission posture: localFiles=${plan.permissionPosture.localFiles}; writes=${plan.permissionPosture.writes}; externalActions=${plan.permissionPosture.externalActions}; audit=${plan.permissionPosture.auditRequired ? "yes" : "no"}; note=${plan.permissionPosture.note}
- Reflection checks: ${plan.reflectionChecks.join(" ")}
- Improvement suggestions: ${plan.improvementSuggestions.length ? plan.improvementSuggestions.join(" ") : "None for this turn."}
`.trim();
}
