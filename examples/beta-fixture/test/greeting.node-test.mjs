import test from "node:test";
import assert from "node:assert/strict";

import { createGreeting } from "../src/greeting.mjs";

test("createGreeting returns a friendly greeting", () => {
  assert.equal(createGreeting("Ada"), "Hello, Ada!");
});
