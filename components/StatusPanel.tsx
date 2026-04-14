import React from "react";

export function StatusPanel({
  status,
}: {
  status: { stage: string; detail?: string } | null;
}) {
  return (
    <div className="rounded-2xl border p-4 bg-white/5 text-white">
      <div className="text-sm opacity-70">Brain Status</div>
      <div className="text-lg font-semibold">{status?.stage || "idle"}</div>
      {status?.detail ? (
        <div className="text-sm opacity-80 mt-2">{status.detail}</div>
      ) : null}
    </div>
  );
}
