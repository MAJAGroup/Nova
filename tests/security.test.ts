import { test } from "node:test";
import assert from "node:assert/strict";
import {
  destination,
  publicAddress,
  passwordHash,
  passwordMatches,
  resolveAllowed,
} from "../packages/security";
import { needsApproval } from "../apps/api/agent";
import { Action } from "../packages/protocol";
test("network policy blocks private, mapped, reserved and metadata addresses", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "100.64.0.1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("1.1.1.1"), true);
  await assert.rejects(resolveAllowed("127.0.0.1", 80));
  await assert.rejects(resolveAllowed("1.1.1.1", 5432));
});
test("passwords use unique salted hashes and constant-time verification", () => {
  const a = passwordHash("a long passphrase");
  assert.notEqual(a, passwordHash("a long passphrase"));
  assert(passwordMatches("a long passphrase", a));
  assert(!passwordMatches("wrong", a));
});
test("input validation and deterministic approvals cannot be bypassed by alternative tools", () => {
  assert.equal(destination("example.com"), "https://example.com/");
  assert.throws(() => destination("https://user:pass@example.com"));
  assert.throws(() => Action.parse({ type: "shell", command: "id" }));
  for (const a of [
    { type: "click", element: "1" },
    { type: "key", key: "Enter" },
    { type: "text", text: "publish" },
    { type: "pointer", x: 1, y: 1 },
    { type: "fill", element: "1", text: "secret" },
    { type: "navigate", url: "https://example.com" },
  ])
    assert(needsApproval(Action.parse(a)));
  assert(!needsApproval({ type: "observe" }));
});
