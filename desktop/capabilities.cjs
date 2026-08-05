const DESKTOP_CAPABILITIES = [
  {
    id: "chat.ai",
    category: "Brain",
    name: "AI conversation",
    status: "available",
    permission: "account/api",
    description:
      "General SVANS-AI chat, teaching, coding, writing, and reasoning.",
  },
  {
    id: "mind.routing",
    category: "Brain",
    name: "SVANS-Mind routing",
    status: "available",
    permission: "none",
    description:
      "Intent detection, module selection, confidence scoring, and fallback control.",
  },
  {
    id: "memory.personalization",
    category: "Memory",
    name: "Writing profile and memory",
    status: "available",
    permission: "account",
    description:
      "User style, preferences, learning notes, and useful long-term memories.",
  },
  {
    id: "workspace.select",
    category: "Workspace",
    name: "Permissioned folder access",
    status: "available",
    permission: "folder consent",
    description: "Read or trusted access to a selected local workspace folder.",
  },
  {
    id: "workspace.scan",
    category: "Workspace",
    name: "Selective folder scanning",
    status: "available",
    permission: "selected workspace",
    description:
      "Indexes supported files while skipping heavy folders like node_modules and .git.",
  },
  {
    id: "file.read",
    category: "Files",
    name: "Local file reading",
    status: "available",
    permission: "selected workspace",
    description: "Reads bounded text files inside the approved workspace only.",
  },
  {
    id: "file.write",
    category: "Files",
    name: "Trusted file writing",
    status: "available",
    permission: "trusted workspace",
    description:
      "Writes inside the approved workspace and creates a backup before replacing files.",
  },
  {
    id: "file.search",
    category: "Files",
    name: "Workspace text search",
    status: "available",
    permission: "selected workspace",
    description:
      "Searches supported text/code files for phrases without scanning ignored folders.",
  },
  {
    id: "terminal.allowlisted",
    category: "Sandbox",
    name: "Allowlisted terminal commands",
    status: "available",
    permission: "selected workspace",
    description:
      "Runs safe command families such as git, npm, node, npx, python, and PowerShell.",
  },
  {
    id: "git.status",
    category: "Code",
    name: "Git status and diff",
    status: "available",
    permission: "selected workspace",
    description:
      "Reads git status, recent log, branch name, and diffs for review.",
  },
  {
    id: "audit.log",
    category: "Shield",
    name: "Desktop audit log",
    status: "available",
    permission: "desktop app",
    description:
      "Records workspace, file, command, and desktop lifecycle events.",
  },
  {
    id: "web.search",
    category: "Tools",
    name: "Live web research",
    status: "configured",
    permission: "API key",
    description:
      "Uses configured research providers from the existing web app.",
  },
  {
    id: "ocr.image",
    category: "Vision",
    name: "OCR and image reading",
    status: "configured",
    permission: "API key/files",
    description:
      "Uses configured OCR/image providers through the existing SVANS-AI backend.",
  },
  {
    id: "image.generation",
    category: "Creative",
    name: "Image generation",
    status: "configured",
    permission: "API key",
    description:
      "Generates images through the existing backend provider integration.",
  },
  {
    id: "documents.office",
    category: "Documents",
    name: "Document and spreadsheet assistance",
    status: "partial",
    permission: "files/workspace",
    description:
      "Reads and reasons over supported files; deeper generation can be added as a desktop tool.",
  },
  {
    id: "sandbox.worktree",
    category: "Sandbox",
    name: "Isolated worktree experiments",
    status: "planned",
    permission: "trusted workspace",
    description:
      "Future safe branch/worktree creation for experiments before touching the main project.",
  },
  {
    id: "calendar.email",
    category: "Integrations",
    name: "Calendar and email",
    status: "planned",
    permission: "connector login",
    description:
      "Future reminders, scheduling, email drafting, and workflow automation.",
  },
  {
    id: "system.automation",
    category: "Automation",
    name: "Background jobs and monitors",
    status: "planned",
    permission: "owner approval",
    description:
      "Future recurring checks, project monitors, and owner-approved automations.",
  },
];

module.exports = {
  DESKTOP_CAPABILITIES,
};
