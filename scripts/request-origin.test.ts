import assert from "node:assert/strict";
import test from "node:test";
import { OwnerAccessError, requireSameOrigin } from "../lib/auth/owner-session";
import { POST as createProject } from "../app/api/projects/route";

const internal = "http://127.0.0.1:10000/api/projects";
const publicOrigin = "https://svansai.com";
const trusted = publicOrigin + ",https://svansai-frontend.onrender.com";

async function configured(value: string | undefined, run: () => void | Promise<void>) {
  const previous = process.env.SVANSAI_APP_ORIGINS;
  if (value === undefined) delete process.env.SVANSAI_APP_ORIGINS;
  else process.env.SVANSAI_APP_ORIGINS = value;
  try { await run(); }
  finally {
    if (previous === undefined) delete process.env.SVANSAI_APP_ORIGINS;
    else process.env.SVANSAI_APP_ORIGINS = previous;
  }
}

function request(origin?: string, url = internal, extra: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: {
    "content-type": "application/json", ...(origin === undefined ? {} : { origin }), ...extra,
  }, body: "{}" });
}
const denied = (error: unknown) => error instanceof OwnerAccessError && error.status === 403;

test("trusted public origins pass behind a proxy with an internal request URL", async () => {
  await configured(trusted, () => {
    assert.doesNotThrow(() => requireSameOrigin(request(publicOrigin)));
    assert.doesNotThrow(() => requireSameOrigin(request("https://svansai-frontend.onrender.com")));
  });
});

test("foreign, opaque and malformed origins cannot match an allowed site", async () => {
  await configured(trusted, () => {
    for (const origin of [undefined, "null", "https://evil.example", "http://svansai.com",
      "https://svansai.com.evil.example", "https://evil.svansai.com", "https://svansai.com:8443",
      "https://svansai.com/", "https://svansai.com/path", "https://svansai.com?x=1",
      "https://user@svansai.com", "https://svansai.com#fragment",
      "https://svansai.com, https://evil.example", "https://svansai.com https://evil.example"]) {
      assert.throws(() => requireSameOrigin(request(origin)), denied, String(origin));
    }
  });
});

test("host and forwarded headers cannot expand configured trust", async () => {
  await configured(trusted, () => {
    assert.throws(() => requireSameOrigin(request("https://evil.example", "https://evil.example/api/projects", {
      host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https",
      forwarded: "host=evil.example;proto=https",
    })), denied);
    assert.throws(() => requireSameOrigin(request("http://127.0.0.1:10000")), denied);
  });
});

test("direct local development remains same-origin without proxy configuration", async () => {
  await configured(undefined, () => {
    assert.doesNotThrow(() => requireSameOrigin(request("http://127.0.0.1:10000")));
    assert.throws(() => requireSameOrigin(request("https://evil.example", internal, {
      "x-forwarded-host": "evil.example", "x-forwarded-proto": "https",
    })), denied);
  });
});

test("malformed deployment configuration fails closed rather than falling back", async () => {
  for (const value of ["*", publicOrigin + ",", publicOrigin + "/path", "null", publicOrigin + ",https://user@svansai.com"]) {
    await configured(value, () => assert.throws(
      () => requireSameOrigin(request("http://127.0.0.1:10000")),
      (error: unknown) => error instanceof OwnerAccessError && error.status === 503,
    ));
  }
});

test("project creation reaches authentication behind a proxy, never bypasses it", async () => {
  await configured(trusted, async () => {
    const allowed = await createProject(request(publicOrigin));
    assert.equal(allowed.status, 401);
    assert.deepEqual(await allowed.json(), { error: "Sign in to create a project." });
    const blocked = await createProject(request("https://evil.example"));
    assert.equal(blocked.status, 403);
  });
});
