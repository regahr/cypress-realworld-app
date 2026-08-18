# Implementation notes

Written justifications for each change, per the assessment brief.

## Verification

Each issue is one commit. Counts below are from runs of the full suites on the final tree.

| Suite                     | Before any change        | After all four                                    |
| ------------------------- | ------------------------ | ------------------------------------------------- |
| `yarn types`              | clean                    | clean                                             |
| `yarn lint`               | clean                    | clean                                             |
| `yarn test:unit:ci`       | 44 passed, 10 skipped    | 44 passed, 10 skipped                             |
| e2e `cypress/tests/api/*` | 51 passed, 0 failed      | **53 passed, 0 failed** (+2 new tests from #1591) |
| e2e `cypress/tests/ui/*`  | 47 passed, **11 failed** | **48 passed, 10 failed**                          |

The UI suite was already red before any change here. Its 11 pre-existing failures all fail the same
way — `cy.its("response.body.results")` on an intercepted request, in `notifications.spec.ts` and
`transaction-feeds.spec.ts`. No issue in this batch covers them and none was "fixed" opportunistically.
Comparing failure names between the before and after runs: **no new failure was introduced**, and
`paginates public transaction feed` recovered as a side effect of #1555.

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

## #1591 — add an API-level logout Cypress command

**What the gap was.** There was an API login command (`loginByApi`, `cypress/support/commands.ts:88`)
but no API logout counterpart. The only way to log out from a test was `logoutByXstate`
(`commands.ts:182`), which drives the running app: it reaches into `window.authService`, sends the
XState `LOGOUT` event, and waits for the router to land on `/signin`. That is the wrong tool when a
test wants to invalidate the _server session_ without tearing down client auth state, and it is
unusable in the `cypress/tests/api/` specs, which never load the app at all.

**Why this shape.** `logoutByApi` mirrors `loginByApi` exactly — a single `cy.request` to the backend
resolved through `Cypress.expose("apiUrl")` — and sits directly beside it in both
`cypress/support/commands.ts` and `cypress/global.d.ts`, because this repo declares command types in
a separate file and the two must move together. It is deliberately not layered on `logoutByXstate`:
that command's window/XState/routing mechanics are exactly what an API-level command must avoid.

**What the test proves.** `cypress/tests/api/api-auth.spec.ts` asserts more than a 200. The first test
pins the response contract (`200`, `{ message: "Logged out" }`); the second proves the security
property that the issue actually asks for — after `logoutByApi()`, a follow-up request to
`GET /checkAuth` returns `401`, i.e. the server session is genuinely invalidated rather than the
client merely forgetting about it.

**Dependency.** This command is only meaningful because of #1592; against the previous handler it
would have asserted a 404. The two are separate commits, but #1591's test is what verifies #1592's
behaviour end to end.

**What I deliberately did not touch.** `loginByApi`, `logoutByXstate`, `switchUserByXstate`, and every
existing spec. No existing test was modified to use the new command — adding it is the issue; adopting
it everywhere is not.

## #1555 — migrate `TransactionInfiniteList` off `react-virtualized`

**What was wrong.** `react-virtualized` calls `ReactDOM.findDOMNode`, which React 19 removed, so the
transaction feed's virtualized list blocks the React upgrade. The dependency was also carrying a
local patch, `patches/react-virtualized+9.22.5.patch`, applied on every install purely to comment out
a broken import inside the package — a standing maintenance cost for a library that is already a
dead end.

**Why this fix.** `react-window` + `react-window-infinite-loader` are by the same author and model
virtualization the same way, so every API this component actually used maps 1:1 —
`isRowLoaded`→`isItemLoaded`, `loadMoreRows`→`loadMoreItems`, `rowCount`→`itemCount`,
`rowHeight`→`itemSize`, `registerChild`→`ref`. That makes this a port rather than a rewrite, which is
what keeps it inside the "minimal and surgical" rule for a change that necessarily swaps a dependency.
Both packages are pinned to v1: react-window v2 is a different API surface, and adopting it here would
be a redesign rather than a migration.

**How the DOM contract was preserved.** `cypress/tests/ui/transaction-feeds.spec.ts:203` paginates by
scrolling `cy.getBySel("transaction-list").children()`, so the element carrying
`data-test="transaction-list"` has to stay and the list's scroll container has to remain its direct
child. Since `react-window-infinite-loader`'s `InfiniteLoader` renders no DOM of its own, the
`styled()` wrapper moved off the loader and onto that div with its five declarations unchanged. The
responsive `height`/`width`/`itemSize` math, the `removePx` helper, the `useMediaQuery` breakpoints,
the `itemCount` formula, `threshold={2}` and the `loadMoreItems` promise are all carried over verbatim.
The row renderer is now typed with `ListChildComponentProps`, which let the previous `// @ts-ignore`
go without any behavioural change.

**Result.** The UI suite went from 47 passing / 11 failing to **48 passing / 10 failing**, with **no
new failures**. The test that recovered is "paginates public transaction feed" — the one that scrolls
the virtualized list — so the migration fixed a pre-existing red rather than merely avoiding one.

**What I deliberately did not touch.** `src/components/TransactionList.tsx` (the only consumer) keeps
the identical props interface and default export; the `patches/` directory and the `postinstall`
script remain for future patches; no test was modified to accommodate the new library.

**Not fixed, and named honestly.** The other 10 UI failures are pre-existing and unrelated to this
change — every one fails on `cy.its("response.body.results")` against an intercepted request, i.e. a
response-shape/intercept problem in the feed specs, not a rendering problem. They were red before any
change in this branch and no task covers them.
