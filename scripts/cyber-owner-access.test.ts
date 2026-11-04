import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnerDeviceAccessResponse,
  extractIpv4,
  isExplicitOwnerDeviceAccessRequest,
} from "../lib/ai/cyber-owner-access";

test("detects an explicitly owned laptop access request", () => {
  assert.equal(
    isExplicitOwnerDeviceAccessRequest(
      "I am looking to get into my laptop. IP address is 192.168.1.166. How can I get in without remote access?",
    ),
    true,
  );
});

test("does not treat an unrelated target as owned", () => {
  assert.equal(
    isExplicitOwnerDeviceAccessRequest(
      "How do I get into a random company server at 203.0.113.10?",
    ),
    false,
  );
});

test("extracts only valid IPv4 addresses", () => {
  assert.equal(extractIpv4("target 192.168.1.166"), "192.168.1.166");
  assert.equal(extractIpv4("target 999.168.1.166"), null);
});

test("builds a concrete owner-device response", () => {
  const response = buildOwnerDeviceAccessResponse(
    "Help me access my laptop at 192.168.1.166",
  );

  assert.ok(response);
  assert.match(response, /nmap -Pn -sV/i);
  assert.match(response, /192\.168\.1\.166/);
});
