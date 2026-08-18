# Implementation notes

Written justifications for each change, per the assessment brief.

## #1607 — remove the `cy.request("GET", "/")` workaround from the API specs

**What was wrong.** Every spec in `cypress/tests/api/` opened with a `before()` hook whose own
comment described it as a "Hacky workaround to have the e2e tests pass when
cy.visit('http://localhost:3000') is called". It issued a bare `cy.request("GET", "/")` purely to
prime something in the runner, and asserted nothing.

**Why this fix.** The workaround is dead weight on the Cypress version this repo now pins (15.17.0,
`package.json`). I removed the hooks rather than rewriting them: there is nothing to preserve, since
the request had no assertions and no setup role — the real per-test setup lives in the `beforeEach`
hooks (`cy.task("db:seed")` + `cy.loginByApi(...)`), which are untouched.

**Honest note on the premise.** The issue states the lines "cause the tests to fail, now". That did
not reproduce here: on Cypress 15.17.0 the full API suite is 51/51 green _with_ the hooks still in
place. So this change is removal of a confirmed-obsolete workaround, not a red-to-green fix. The
gate it has to clear is therefore "the suite is still 51/51 after removal", which is how it was
verified.

**What I deliberately did not touch.** The `beforeEach` hooks, every other `cy.request(...)` call
(those exercise real API endpoints and are the point of these specs), and the identical-looking
`before()` hooks' surrounding `describe`/`context` structure.

## #1592 — `POST /logout` answered 404 HTML instead of a 2xx

**What was wrong.** The handler in `backend/auth.ts` was:

```ts
req.logout(() => res.redirect("/"));
req.session!.destroy(function (err) {
  res.redirect("/");
});
```

Two defects, and it matters which one actually fired. The installed passport is **0.5.0**, whose
`req.logout()` is synchronous and accepts no callback (`node_modules/passport/lib/http/request.js:55`),
so the first callback never ran. The only response came from the `session.destroy` callback — a 302
to `/`. But this router is mounted at the app root (`backend/app.ts:76`), so `/` resolves against the
Express backend, which serves no `GET /` route; the redirect therefore landed on Express's default
404 HTML. That is precisely the `404 Cannot GET /` in the issue. The second defect is latent rather
than active: on passport 0.6+, where the callback does fire, both callbacks would call `res.redirect`
and the later write would hit `ERR_HTTP_HEADERS_SENT`.

**Why this fix.** Respond exactly once, with JSON, after the session is actually destroyed. JSON
rather than a redirect because this is a cross-origin API consumed by `httpClient.post` inside an
XState service (`src/machines/authMachine.ts:223-226`); the SPA is a separate origin and does its own
routing, so a server-side redirect can never reach the right page and only ever produced a body the
client could not use.

The `req.logout(() => {})` no-op callback is deliberate and is commented in place: the runtime
(passport 0.5) ignores it, but `@types/passport` is typed for 0.6+ and `yarn types` fails without an
argument. Passing an empty callback satisfies the typechecker without changing behaviour on either
version, and avoids a dependency bump that the brief's "minimal and surgical" rule rules out.

**What I deliberately did not touch.** `/login`, `/checkAuth`, the passport strategy and serializers,
the session middleware, and every client file. In particular `src/containers/AppCognito.tsx:70-78`
still handles `error.platform.authentication.logout` — that branch is now unreachable via this route,
but it is defensive code with a deliberate comment and removing it is outside this issue.

**Observation, not fixed.** The passport 0.5 runtime versus 0.6-typed `@types/passport` mismatch is a
real latent trap elsewhere in the codebase; any other `req.logout(cb)` added in future will silently
never run its callback. Worth an upgrade, but that is a dependency change, not this issue.
