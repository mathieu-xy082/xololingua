# Pipeline stage contract normalization

Branch: `ec/pipeline-stage-contract-normalization`

Base branch: `ec/backend`

## Goal

Create one canonical contract for every pipeline stage result so browser implementations and Python fallback implementations can be composed without subtle shape or metadata mismatches.

This workstream exists because current hybrid routing already reports stages, runtimes, and fallbacks, but the result envelope is not yet isolated as a strict contract shared by all stages.

## Canonical envelope

Every stage runner should return an object shaped like:

```js
{
  stage: "audioExtraction" | "vad" | "transcription" | "translation" | "srtFormatting",
  runtime: "browser" | "python-fallback" | "server-fallback",
  strategy: string,
  payload: object,
  metadata: object
}
```

### Required semantics

- `stage` names the logical pipeline step, not the implementation.
- `runtime` identifies where the successful result was produced.
- `strategy` identifies the implementation path, for example `ffmpeg-wasm`, `webcodecs`, `python-ffmpeg`, `python-vad`, `transformers-js`, `faster-whisper`, or `argos-python`.
- `payload` contains only the data required by the next stage.
- `metadata` contains diagnostics, fallback reasons, limits, durations, endpoint names, and display/reporting data.

## Audio payload contract

Audio extraction is the first priority because every downstream stage depends on it.

Expected stable shape:

```js
{
  audioId: string | null,
  audioBlob: Blob | File | null,
  storage: "browser" | "server" | "none",
  mimeType: string | null,
  sampleRateHz: number | null,
  durationSeconds: number | null
}
```

Rules:

- Browser extraction may return `audioBlob` and `storage: "browser"`.
- Python fallback may return `audioId` and `storage: "server"`.
- A successful stage must provide at least one usable handoff: `audioBlob` or `audioId` depending on downstream support.
- Failed browser attempts should not masquerade as successful Python fallback; fallback reason belongs in `metadata`.

## Stage priorities

1. Normalize audio extraction output.
2. Normalize VAD segmentation output.
3. Normalize transcription output.
4. Normalize translation output.
5. Normalize SRT formatting / final download output if needed.

## Acceptance criteria

- Add a focused contract module or helper, preferably under `frontend/`, with tests.
- Add tests proving browser and Python fallback results for the same logical stage share the same envelope shape.
- Add tests for invalid/missing required fields.
- Preserve existing hybrid router behavior while moving it onto the canonical envelope.
- Keep browser/user E2E optional unless a runtime behavior change requires it.
- Run and pass `pdm run check`.
- If practical, run the API E2E or browser E2E only after the envelope touches real user flow.
- Do not merge into `ec/backend` without Mathieu's explicit review.

## Ready marker

When the branch is ready for review, the autonomous job must end with exactly:

```text
BRANCHE PRÊTE POUR REVIEW: ec/pipeline-stage-contract-normalization
```
