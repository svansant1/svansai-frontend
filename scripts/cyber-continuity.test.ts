import assert from "node:assert/strict";
import test from "node:test";
import { buildCyberContinuityContext } from "../lib/ai/cyber-continuity";
import type { CyberAccessContext } from "../lib/ai/cyber-mode";

const active: CyberAccessContext = {
  requested: true,
  active: true,
  ownerVerified: true,
  ownerSessionUnlocked: true,
  featureEnabled: true,
  scope: "owner_authorized",
  depth: "expert",
};

test("preserves owner target and desktop-only constraint", () => {
  const context = buildCyberContinuityContext(
    [
      { role: "user", content: "I want to do everything from my desktop. I do not want to touch the laptop." },
      { role: "user", content: "My laptop is 192.168.1.155." },
      { role: "user", content: "I want Kali and I want to identify an open port and go from there." },
    ],
    active,
  );

  assert.match(context, /Current target IP: 192\.168\.1\.155/);
  assert.match(context, /desktop side only/i);
  assert.match(context, /Kali Linux/i);
});

test("recognizes completed scans and netstat semantics", () => {
  const context = buildCyberContinuityContext(
    [
      { role: "user", content: "nmap -p 22,80,443 192.168.1.155" },
      { role: "assistant", content: "PORT STATE SERVICE\n22/tcp filtered ssh\n80/tcp filtered http" },
      { role: "user", content: "I ran netstat -ano and the connections say ESTABLISHED." },
    ],
    active,
  );

  assert.match(context, /Nmap has already been used/);
  assert.match(context, /netstat -ano has already been run/i);
  assert.match(context, /ESTABLISHED outbound\/client connections/i);
});
