import assert from "node:assert/strict";
import test from "node:test";
import { restoreVercelApiPath } from "../src/lib/vercel-path.ts";

test("restores the API path while preserving ordinary query parameters", () => {
  assert.equal(
    restoreVercelApiPath(
      "/api?__frogtown_api_path=healthz&verbose=true",
    ),
    "/api/healthz?verbose=true",
  );
});

test("restores nested API paths and decodes their URL-encoded separators", () => {
  assert.equal(
    restoreVercelApiPath(
      "/api?__frogtown_api_path=conversations%2Froom-1%2Fmessages&limit=20",
    ),
    "/api/conversations/room-1/messages?limit=20",
  );
});

test("leaves requests without the Vercel routing parameter unchanged", () => {
  assert.equal(restoreVercelApiPath("/api/healthz?check=db"), "/api/healthz?check=db");
  assert.equal(restoreVercelApiPath(undefined), undefined);
});

test("routes the API root without adding a trailing slash", () => {
  assert.equal(
    restoreVercelApiPath("/api?__frogtown_api_path="),
    "/api",
  );
});
