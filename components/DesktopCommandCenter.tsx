"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DesktopCapability,
  DesktopCapabilityList,
  DesktopCommandResult,
  DesktopDecision,
  DesktopStatus,
  DesktopWorkspaceSearchResult,
  DesktopWorkspaceSummary,
  DesktopTreeResult,
} from "@/types/svans-desktop";

type StatusState = DesktopStatus | null;

const buttonStyle = (variant: "primary" | "soft" | "danger" = "soft") => ({
  borderRadius: "999px",
  border:
    variant === "primary"
      ? "1px solid rgba(56,189,248,0.42)"
      : variant === "danger"
        ? "1px solid rgba(248,113,113,0.34)"
        : "1px solid rgba(255,255,255,0.12)",
  background:
    variant === "primary"
      ? "linear-gradient(135deg, rgba(56,189,248,0.24), rgba(168,85,247,0.12))"
      : variant === "danger"
        ? "rgba(248,113,113,0.10)"
        : "rgba(255,255,255,0.055)",
  color: variant === "danger" ? "#fecaca" : "#e0f2fe",
  cursor: "pointer",
  fontWeight: 850,
  fontSize: "0.74rem",
  padding: "7px 10px",
});

export default function DesktopCommandCenter() {
  const [available, setAvailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<StatusState>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [capabilities, setCapabilities] = useState<DesktopCapability[]>([]);
  const [tree, setTree] = useState<DesktopTreeResult["tree"] | null>(null);
  const [summary, setSummary] = useState<
    DesktopWorkspaceSummary["summary"] | null
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState<
    DesktopWorkspaceSearchResult["search"] | null
  >(null);
  const [auditEvents, setAuditEvents] = useState<unknown[]>([]);
  const [lastCommand, setLastCommand] = useState<DesktopCommandResult | null>(
    null,
  );

  const workspaceLabel = useMemo(() => {
    if (!status?.workspace.root) return "No workspace selected";
    const parts = status.workspace.root.split(/[\\/]/).filter(Boolean);
    const name = parts.at(-1) || status.workspace.root;
    return `${name} · ${status.workspace.mode}`;
  }, [status]);

  const refreshStatus = async () => {
    if (!window.svansDesktop) return;
    const nextStatus = await window.svansDesktop.status();
    setStatus(nextStatus);
  };

  useEffect(() => {
    if (!window.svansDesktop) return;
    setAvailable(true);
    void refreshStatus();
    void window.svansDesktop
      .listCapabilities()
      .then((result: DesktopCapabilityList) =>
        setCapabilities(result.capabilities),
      );
  }, []);

  if (!available) return null;

  const runAction = async (
    label: string,
    action: () => Promise<
      DesktopDecision | DesktopTreeResult | DesktopCommandResult
    >,
  ) => {
    setBusy(true);
    setMessage(`${label}...`);
    try {
      const result = await action();
      setMessage(result.reason);
      await refreshStatus();
      return result;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Desktop action failed.";
      setMessage(reason);
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      style={{
        marginBottom: "10px",
        borderRadius: "18px",
        border: "1px solid rgba(125,211,252,0.18)",
        background:
          "linear-gradient(135deg, rgba(15,23,42,0.76), rgba(30,41,59,0.42))",
        boxShadow: "0 16px 42px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        style={{
          width: "100%",
          border: 0,
          background: "transparent",
          color: "white",
          cursor: "pointer",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          textAlign: "left",
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              color: "#7dd3fc",
              fontSize: "0.72rem",
              fontWeight: 950,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            SVANS-AI Desktop Command Center
          </span>
          <span
            style={{
              display: "block",
              color: "rgba(255,255,255,0.72)",
              fontSize: "0.78rem",
              marginTop: "3px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {workspaceLabel}
          </span>
        </span>
        <span
          style={{
            flexShrink: 0,
            color: "rgba(255,255,255,0.68)",
            fontWeight: 900,
          }}
        >
          {expanded ? "Hide" : "Open"}
        </span>
      </button>

      {expanded && (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.08)",
            padding: "10px 12px 12px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction("Selecting read workspace", () =>
                  window.svansDesktop!.selectWorkspace({
                    mode: "read",
                    ttlMinutes: 180,
                  }),
                )
              }
              style={buttonStyle("primary")}
            >
              Select read folder
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction("Selecting trusted workspace", () =>
                  window.svansDesktop!.selectWorkspace({
                    mode: "trusted",
                    ttlMinutes: 180,
                  }),
                )
              }
              style={buttonStyle("primary")}
            >
              Select trusted folder
            </button>
            <button
              type="button"
              disabled={busy || !status?.workspace.root}
              onClick={() =>
                void runAction("Scanning workspace", async () => {
                  const result = await window.svansDesktop!.getWorkspaceTree({
                    maxEntries: 800,
                  });
                  if (result.tree) setTree(result.tree);
                  return result;
                })
              }
              style={buttonStyle()}
            >
              Scan folder
            </button>
            <button
              type="button"
              disabled={busy || !status?.workspace.root}
              onClick={() =>
                void runAction("Checking git status", async () => {
                  const result = await window.svansDesktop!.runCommand({
                    command: "git",
                    args: ["status", "--short"],
                  });
                  setLastCommand(result);
                  return result;
                })
              }
              style={buttonStyle()}
            >
              Git status
            </button>
            <button
              type="button"
              disabled={busy || !status?.workspace.root}
              onClick={() =>
                void runAction("Clearing workspace", () =>
                  window.svansDesktop!.clearWorkspace(),
                )
              }
              style={buttonStyle("danger")}
            >
              Clear access
            </button>
          </div>

          {message && (
            <p
              style={{
                margin: "9px 0 0",
                color: "rgba(255,255,255,0.7)",
                fontSize: "0.78rem",
                lineHeight: 1.45,
              }}
            >
              {message}
            </p>
          )}

          {capabilities.length > 0 && (
            <div
              style={{
                marginTop: "10px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: "8px",
              }}
            >
              {capabilities.slice(0, 12).map((capability) => (
                <div
                  key={capability.id}
                  title={capability.description}
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(15,23,42,0.34)",
                    padding: "9px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "8px",
                      color: "#e0f2fe",
                      fontSize: "0.72rem",
                      fontWeight: 900,
                    }}
                  >
                    <span>{capability.name}</span>
                    <span
                      style={{
                        color:
                          capability.status === "available"
                            ? "#86efac"
                            : capability.status === "configured"
                              ? "#bae6fd"
                              : capability.status === "partial"
                                ? "#fde68a"
                                : "rgba(255,255,255,0.48)",
                        flexShrink: 0,
                      }}
                    >
                      {capability.status}
                    </span>
                  </div>
                  <div
                    style={{
                      color: "rgba(255,255,255,0.52)",
                      fontSize: "0.68rem",
                      marginTop: "3px",
                    }}
                  >
                    {capability.category} · {capability.permission}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              marginTop: "10px",
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              disabled={busy || !status?.workspace.root}
              onClick={() =>
                void runAction("Summarizing workspace", async () => {
                  const result =
                    await window.svansDesktop!.getWorkspaceSummary();
                  if (result.summary) setSummary(result.summary);
                  return result;
                })
              }
              style={buttonStyle()}
            >
              Workspace summary
            </button>
            <button
              type="button"
              disabled={busy || !status?.workspace.root}
              onClick={() =>
                void runAction("Reading git diff", async () => {
                  const result = await window.svansDesktop!.gitDiff();
                  setLastCommand(result);
                  return result;
                })
              }
              style={buttonStyle()}
            >
              Git diff
            </button>
            <button
              type="button"
              disabled={busy || !status?.workspace.root}
              onClick={() =>
                void runAction("Reading audit log", async () => {
                  const result = await window.svansDesktop!.readAudit({
                    limit: 25,
                  });
                  setAuditEvents(result.events || []);
                  return result;
                })
              }
              style={buttonStyle()}
            >
              Audit trail
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "10px",
              alignItems: "center",
            }}
          >
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search workspace text..."
              style={{
                flex: 1,
                minWidth: 0,
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(15,23,42,0.5)",
                color: "white",
                padding: "8px 10px",
                outline: "none",
                fontSize: "0.78rem",
              }}
            />
            <button
              type="button"
              disabled={busy || !status?.workspace.root || !searchQuery.trim()}
              onClick={() =>
                void runAction("Searching workspace", async () => {
                  const result = await window.svansDesktop!.searchWorkspace({
                    query: searchQuery,
                    maxResults: 40,
                  });
                  if (result.search) setSearch(result.search);
                  return result;
                })
              }
              style={buttonStyle("primary")}
            >
              Search
            </button>
          </div>

          {(tree ||
            summary ||
            search ||
            auditEvents.length > 0 ||
            lastCommand) && (
            <div
              style={{
                marginTop: "10px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "8px",
              }}
            >
              {tree && (
                <div
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(15,23,42,0.44)",
                    padding: "10px",
                  }}
                >
                  <div
                    style={{
                      color: "#bae6fd",
                      fontSize: "0.74rem",
                      fontWeight: 900,
                    }}
                  >
                    Folder scan
                  </div>
                  <div
                    style={{
                      color: "rgba(255,255,255,0.68)",
                      fontSize: "0.74rem",
                      marginTop: "4px",
                    }}
                  >
                    {tree.entries.length} entries
                    {tree.truncated ? " · truncated" : ""}
                  </div>
                </div>
              )}

              {lastCommand && (
                <div
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(15,23,42,0.44)",
                    padding: "10px",
                  }}
                >
                  <div
                    style={{
                      color: "#bae6fd",
                      fontSize: "0.74rem",
                      fontWeight: 900,
                    }}
                  >
                    Last command
                  </div>
                  <pre
                    style={{
                      margin: "6px 0 0",
                      maxHeight: "120px",
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      color: "rgba(255,255,255,0.74)",
                      fontSize: "0.72rem",
                    }}
                  >
                    {(lastCommand.stdout || lastCommand.stderr || "").trim() ||
                      `Exit code: ${lastCommand.exitCode}`}
                  </pre>
                </div>
              )}

              {summary && (
                <div
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(15,23,42,0.44)",
                    padding: "10px",
                  }}
                >
                  <div
                    style={{
                      color: "#bae6fd",
                      fontSize: "0.74rem",
                      fontWeight: 900,
                    }}
                  >
                    Workspace summary
                  </div>
                  <div
                    style={{
                      color: "rgba(255,255,255,0.68)",
                      fontSize: "0.74rem",
                      marginTop: "4px",
                    }}
                  >
                    {summary.fileCount} files · {summary.directoryCount} folders
                    · {Math.round(summary.totalBytes / 1024)} KB
                  </div>
                </div>
              )}

              {search && (
                <div
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(15,23,42,0.44)",
                    padding: "10px",
                  }}
                >
                  <div
                    style={{
                      color: "#bae6fd",
                      fontSize: "0.74rem",
                      fontWeight: 900,
                    }}
                  >
                    Search results
                  </div>
                  <pre
                    style={{
                      margin: "6px 0 0",
                      maxHeight: "120px",
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      color: "rgba(255,255,255,0.74)",
                      fontSize: "0.72rem",
                    }}
                  >
                    {search.results
                      .slice(0, 8)
                      .map(
                        (item) => `${item.path}:${item.line} ${item.preview}`,
                      )
                      .join("\n") || "No matches"}
                  </pre>
                </div>
              )}

              {auditEvents.length > 0 && (
                <div
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(15,23,42,0.44)",
                    padding: "10px",
                  }}
                >
                  <div
                    style={{
                      color: "#bae6fd",
                      fontSize: "0.74rem",
                      fontWeight: 900,
                    }}
                  >
                    Audit events
                  </div>
                  <div
                    style={{
                      color: "rgba(255,255,255,0.68)",
                      fontSize: "0.74rem",
                      marginTop: "4px",
                    }}
                  >
                    {auditEvents.length} recent events loaded.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
