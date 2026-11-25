---
kind: task
title: "t02-142 — Bootstrap-users manifest schema"
description: "Spec the canonical bootstrap-user manifest file shape; the manifest hash MUST be derived from canonical-JSON byte form."
slug: task:t02-142
of-goal: goal:v0.2a-multi-user-authoring
of-milestone: milestone:v0.2a-multi-user-single-node
kind-of-task: engineering
status: open
owned-by-office: office:engineering
assigned-to-personnel: null
priority: 3
estimated-effort-hours: null
actual-effort-hours: null
deadline-by-ord: null
depends-on-tasks: []
area: engineering
horizon: doing
authored-at: 2026-05-03
authority: "milestones/v0.2a-multi-user-single-node.md"
---

# t02-142 — Bootstrap-users manifest schema

## Description

Spec and pin the **bootstrap-user manifest** file shape: location on disk, JSON schema, canonical-form rules, hashing recipe. The manifest hash determines whether a re-boot is a no-op (`t02-141`) or a delta — so the canonical form has to be deterministic across implementations (Python and Rust, byte-identical) per [specs/kernel/canonicalization.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/specs/kernel/canonicalization.md).

The bootstrap routine ([`src/init_boot/bootstrap_users.py`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/src/init_boot/bootstrap_users.py)) currently consumes a manifest passed via the boot harness; this task records the canonical schema in `specs/init-boot/` (a new file or an addendum to `boot-sequence.md`), wires the schema into [`src/init_boot/boot.py`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/src/init_boot/boot.py), and authors the conformance fixture that pins the byte-form.

**Spec citations.**

- [specs/init-boot/boot-sequence.md §4.1](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/specs/init-boot/boot-sequence.md) — the four-step bootstrap routine; this task adds the manifest-schema sub-section.
- [specs/kernel/canonicalization.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/specs/kernel/canonicalization.md) — the manifest's canonical-byte form is the same canonicalization the substrate uses for cells and events.
- [decisions/canonical-json-conventions.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/decisions/canonical-json-conventions.md) — lexicographic key sort, no whitespace, minimal numeric form.
- [decisions/content-hash-via-sha256.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/decisions/content-hash-via-sha256.md) — the manifest hash is SHA-256 of the canonical bytes.
- Theory grounding: row 3 (predication cell and content addressing) of [references/theory-for-developers.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/references/theory-for-developers.md). The manifest is structurally a content-addressed input to boot.

**Modules to touch** (proposed; confirm exact file boundaries with captain when picking up).

- A new spec file `specs/init-boot/bootstrap-manifest.md` (or an addendum to `boot-sequence.md` §4.1) — pin the schema, the canonical form, the hashing recipe.
- [`src/init_boot/bootstrap_users.py`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/src/init_boot/bootstrap_users.py) — confirm the manifest hash computed by the routine matches the spec exactly; cite the new spec in the docstring.
- [`src/init_boot/boot.py`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/src/init_boot/boot.py) — the boot harness loads the manifest from the configured path; cite the spec.
- A pydantic model for the manifest entry (likely in [`src/init_boot/bootstrap_users.py`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/src/init_boot/bootstrap_users.py) or a new `src/init_boot/manifest.py`) per [implementation/python.md "What the Python implementation MUST NOT do"](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/implementation/python.md) — the model MUST round-trip canonical-JSON byte-identically.
- [`tests/conformance/`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/tests/conformance) — manifest canonicalization conformance test (paired with `t02-142f`).

**Procedure.** Follow [implementation/workflows.md recipe 1](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/implementation/workflows.md#1-landing-a-v02a-task-end-to-end). Pay attention to recipe 7 step 4 (canonicalization round-trip) — the manifest pydantic model must round-trip canonical-JSON byte-identically, or the manifest hash will diverge across implementations.

**Ship-target role.** Contributes to gate item 3 of [milestones/v0.2a-multi-user-single-node.md §Ship targets](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/milestones/v0.2a-multi-user-single-node.md). The manifest schema is the input contract; without a settled schema, idempotence (`t02-141`) is undefined.

**Depends on.** None directly; coordinates with `t02-141` (idempotence depends on a stable manifest hash) and `t02-140` (the routine consumes the manifest).

## Acceptance

Proposed checkable acceptance items per [implementation/workflows.md recipe 10](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/implementation/workflows.md#10-promoting-a-thin-t02-nn-task-record-into-a-procedural-plan); confirm exact spec location, schema fields, and fixture names with the captain.

- A spec file pinning the bootstrap-user manifest schema exists under `specs/init-boot/` (new file or addendum); cited from [`src/init_boot/bootstrap_users.py`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/src/init_boot/bootstrap_users.py)'s module docstring.
- The schema names every required field per the existing routine: user slug, role, capability grants, token-hash bootstrap convention. Captain confirms the field set before the schema ships.
- The pydantic model for the manifest entry round-trips canonical-JSON byte-identically per [implementation/python.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/implementation/python.md).
- The manifest hash is SHA-256 of the canonical bytes; reproducing the hash from the canonical-JSON of any conforming implementation produces the same value (verified by the Rust sibling if available).
- Paired fixture `t02-142f` authored under `tests/fixtures/bootstrap/` per [decisions/fixture-authoring-paired-task.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/decisions/fixture-authoring-paired-task.md); fixture is a sample manifest + its expected canonical bytes + its expected SHA-256 hash.
- A conformance test under [`tests/conformance/`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/tests/conformance) loads the fixture, canonicalizes the manifest, and asserts byte-identity of the canonical form and the hash.
- Progress cell `(task:t02-142, status, done, true)` appended with witnesses.

## Progress cells

Predcat-aware progress observations per [specs/work-orchestration/progress-tracking.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/specs/work-orchestration/progress-tracking.md).

- `(task:t02-142, status, open, true)` — recorded 2026-05-03 on first authoring of the per-family record.
- `(task:t02-142, horizon, doing, true)` — recorded 2026-05-03.
- `(task:t02-142, description-promoted, true, true)` — recorded 2026-05-03; thin dispatch-shell description promoted to procedural plan per [implementation/workflows.md recipe 10](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/implementation/workflows.md#10-promoting-a-thin-t02-nn-task-record-into-a-procedural-plan), following [`t02-30`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/tasks/engineering/t02-30-v0.2a-multi-user-authoring.md) and [`t02-140`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/tasks/engineering/t02-140-v0.2a-multi-user-authoring.md).
- `(task:t02-142, spec-authored, true, true)` — recorded 2026-05-03. New normative spec [`specs/init-boot/bootstrap-manifest.md`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/specs/init-boot/bootstrap-manifest.md) pins manifest location (`$SUBSTRATE_BOOTSTRAP_MANIFEST`), closed JSON schema (`users[].{slug,display_name,role,capabilities}`), the canonical-form construction (sort users by slug; sort capabilities; exactly four fields per entry; `capabilities=[]` when omitted), the byte form (delegates to `specs/kernel/canonicalization.md` — `sort_keys` + minimal separators + `ensure_ascii=False` + UTF-8), the SHA-256 hashing recipe, and the `(deployment, bootstrap-user-manifest-hash:<H>) = t` substrate cell binding.
- `(task:t02-142, canonicalization-bug-fixed, true, true)` — recorded 2026-05-03. [`bootstrap_users.manifest_hash`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/src/init_boot/bootstrap_users.py) was using raw `json.dumps(..., sort_keys=True, separators=(",",":"))` with default `ensure_ascii=True`, diverging from `specs/kernel/canonicalization.md` §6 reference (`ensure_ascii=False, allow_nan=False`). For non-ASCII display names the Python implementation would have produced `\\u00f3`-escaped bytes while a conformant Rust implementation produces verbatim UTF-8 — a silent cross-implementation hash divergence. Refactored to route through `substrate.canonicalization.canonical`; introduced `canonical_manifest_payload` and `canonical_manifest_bytes` so the canonical-form construction is itself addressable for test pinning.
- `(task:t02-142, paired-fixture-authored, true, true)` — recorded 2026-05-03. Fixtures at [`tests/fixtures/bootstrap/manifest-3-users.{json,canonical,sha256}`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/tests/fixtures/bootstrap) — a 4-user sample with one non-ASCII display name (`Dóra Östberg`) so the `ensure_ascii=False` rule is structurally checked; pinned canonical bytes (356 bytes) and pinned SHA-256 (`be247d3038a1afa6f59ea3985f539ac6578af4c25fa5dccbd96578f080ef4203`).
- `(task:t02-142f, conformance-test-authored, true, true)` — recorded 2026-05-03. New [`tests/conformance/test_t02_142f_bootstrap_manifest_canonicalization.py`](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/tests/conformance/test_t02_142f_bootstrap_manifest_canonicalization.py) — 11 tests covering: byte-identity vs pinned fixture, hash-identity vs pinned fixture, canonicalization round-trip (`canonical(json.loads(canonical(x))) == canonical(x)`), UTF-8 verbatim (no `\\u00f3`), invariance under user/capability reordering, schema closure (unknown top-level / per-entry keys / unknown roles rejected), canonical-payload structural rules (exactly four fields per user, users sorted, capabilities sorted).
- `(task:t02-142, status, done, true)` — recorded 2026-05-03. Witnesses: 47 tests pass (11 new in `test_t02_142f` + 36 prior in `test_bootstrap_users_manifest`, `test_t02_141f`, `test_t02_145f`, `test_boot`); zero regressions because pre-existing manifests use ASCII-only display names where `ensure_ascii=True` and `=False` produce identical bytes.
- `(task:t02-142f, status, done, true)` — recorded 2026-05-03; paired fixture-authoring task closed jointly per [decisions/fixture-authoring-paired-task.md](../../../../../../../../../../../../../../../lib/legacy/2026-10-24-archived-snapshot-code/lenticule-science/emsenn-pypredcomp/docs/dev/decisions/fixture-authoring-paired-task.md).
