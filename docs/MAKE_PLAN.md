# Paper Make — agent-first functional app builder

## Target and boundaries

Offer the observable Figma Make workflow inside Paper: prompt or selected design → editable, running React app → iterative chat and targeted visual edits → version history and code editing → responsive inspection → export or publication. This is an independent Paper feature, not a claim of Figma feature parity or a reuse of Figma IP. Existing scene documents, MCP tools, cloud projects, and collaboration must keep working unchanged.

Reference behavior (official Figma help): [create](https://help.figma.com/hc/en-us/articles/31304485164695-Create-a-Figma-Make-file), [edit and annotate](https://help.figma.com/hc/en-us/articles/42009840449175-Edit-a-Figma-Make-file), [code editing](https://help.figma.com/hc/en-us/articles/33649966245783-Edit-the-code-of-a-functional-prototype-or-web-app), [publish/unpublish](https://help.figma.com/hc/en-us/articles/31304586129559-Publish-update-or-unpublish-a-Figma-Make-file), [copy preview as design layers](https://help.figma.com/hc/en-us/articles/35060759685015-Copy-a-Figma-Make-preview-as-design-layers).

## Product contract

- An App Project belongs to one authenticated Paper account and optionally references a Paper scene/project/revision. It contains a versioned manifest, bounded editable source files and asset references, immutable revisions, chat turns, preview status and release metadata. It is **not** a replacement for the scene document. Scene → app context is a snapshot; generated app → scene is an explicit, reviewable import/export, never silent round-trip mutation.
- The first vertical slice must generate a one-screen interactive app and show it in a working sandbox, not merely draw a mockup. Later slices add iteration, visual targeting, source editing, versioning, sharing and publishing.
- No model keys or backend secrets in client bundles or repo. Provider selection, permissions, input/output caps, cost budgets, cancellation and audit belong on the authenticated server. Generated content and external packages are untrusted.
- Build only static, pre-approved source modules; no `npm install`, arbitrary package scripts, `eval`, shell execution or server-side execution of generated code. Preview runs in a sandboxed, opaque-origin iframe with strict CSP/no credential access. Published apps run on a separate origin and go through an explicit release pipeline. User-provided backend access is scoped, not a generic arbitrary HTTP proxy.
- Preserve provenance: each model turn records user request, source revision, bounded file diff, validation outcome and rollback point. Concurrent edits reject stale revisions; model output does not silently overwrite manual edits.
- Every issue is one thin, testable slice. Write a failing behavior test first; run the targeted test, `npm test`, `npm run build`, plus relevant browser/security tests. Live demo and real account checks are required before public release. A failure blocks the queue; do not skip to the next issue.

## Ordered work packages (one GitHub issue each)

**Foundation (01–06):** manifest and schema; account-scoped durable storage; authenticated revision API; safe static compiler; sandboxed iframe/CSP; preview shell and diagnostics.

**Generation (07–12):** model gateway/budget; plan-only prompt; initial functional app generation; revisioned edit/diff; selected scene context; asset upload/validation.

**Editing and verification (13–18):** breakpoint preview; point/annotation targeting; direct visual properties; source editor; version restore; automated build/runtime/visual feedback.

**Delivery (19–24):** export ZIP; isolated publication/unpublish; sharing permissions; secret handles; scoped app data API; GitHub handoff. Gate 20–24 behind the full security and E2E suite. Optional enhancements (custom domain, third-party kits, generic package installs) are outside this plan and require separate review.

## Dependency and operations

Each issue depends on its immediate predecessor. Every unreleased issue is created with the `manual` hold label so owner auto-triage cannot start it. A queue controller may release exactly the next issue only when the previous issue is **closed** on GitHub and its local roadmap task is **completed**. If any task fails, is reopened or has a verification/deploy problem, stop and surface the blocker. The tri-agent orchestrator performs implementation sequentially; the supervisor does not write product feature code.

The acceptance of an issue is not a promise of full Make capability. Milestone M1 (01–10) proves generate → run → iterate; M2 (11–18) proves design-guided visual editing with rollback; M3 (19–24) proves secure export/publication/integration. A final cross-milestone acceptance run must create an app from a real Paper frame, change it with chat, restore a prior version, test desktop/mobile, export it, publish, revoke access and confirm another account cannot read it.
