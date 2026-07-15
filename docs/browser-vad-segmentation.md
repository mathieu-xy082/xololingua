# Browser VAD segmentation workstream

Branch: `ec/browser-vad-segmentation`

Base branch: `ec/backend`

## Goal

Implement and validate browser-side VAD segmentation while preserving Python fallback compatibility.

This branch must not be considered integrated merely because it was created from `ec/backend` and has no feature commits yet. A branch with zero unique commits is an unstarted placeholder, not evidence of completed work.

## Dependency on stage contracts

The VAD work must align with the canonical pipeline stage contract introduced by `ec/pipeline-stage-contract-normalization`:

```js
{
  stage,
  runtime,
  strategy,
  payload,
  metadata
}
```

For VAD, the logical stage is:

```js
stage: "vad"
```

Expected payload direction:

```js
{
  segments: [
    {
      start: number,
      end: number,
      // optional implementation-specific diagnostics belong in metadata, not payload
    }
  ]
}
```

Runtime examples:

- `browser` for a successful browser VAD implementation.
- `python-fallback` or `server-fallback` for Python service segmentation.

## Acceptance criteria

- Use strict TDD for any production behavior change.
- Do not invent a VAD payload shape that conflicts with the canonical stage contract.
- Browser and Python fallback VAD results must be consumable by the same downstream transcription path.
- Existing hybrid router behavior must remain compatible.
- Validation minimum: `pdm run check`.
- Browser E2E is only required if the implementation touches actual browser runtime behavior beyond unit-level adapters.

## Branch-state guard

Before deciding this branch is integrated, automation must check both:

1. The branch has at least one unique commit relative to `origin/ec/backend`.
2. Those unique commits are contained in the target branch.

If the unique commit count is zero, continue the workstream instead of stopping.

## Ready marker

When the branch is ready for review, the autonomous job must end with exactly:

```text
BRANCHE PRÊTE POUR REVIEW: ec/browser-vad-segmentation
```
