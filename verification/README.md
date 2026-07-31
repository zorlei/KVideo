# KVideo strict verification

Run the complete read-only validation chain from the repository root:

```sh
./verification/run
```

The runner installs its pinned tools inside this directory, builds and starts
KVideo locally, exercises APIs and UI, and writes evidence under
`verification/artifacts/<run-id>/`. It does not edit application source.
The repository `.dockerignore` excludes this entire directory so dependencies,
reports, traces, and screenshots never enter the application build context.

Primary outputs:

- `report.html`: browsable report with every finding and evidence link.
- `summary.md`: compact human-readable result and coverage gaps.
- `summary.json`: machine-readable run metadata and totals.
- `findings.json`: every pass, failure, warning, skip, and explanation.
- `junit.xml`: CI-compatible result file.
- `events.ndjson`: chronological structured event log.
- `run.log`: chronological plain-text log.
- `raw/`: complete command output and remote response evidence.
- `screenshots/`: viewport, action, and visual-difference images.
- `traces/`: browser traces for failed flows.

Useful options:

```sh
./verification/run --quick
./verification/run --offline
./verification/run --reference-url https://kvideo.pages.dev
./verification/run --keep-server
./verification/run --max-actions 10000 --max-action-depth 10
```

Full mode explores up to 5,000 unique control-state operations per route and
eight same-route state transitions. Repeated controls with identical structure
and state are tested once; changed checked, expanded, pressed, value, and
disabled states are separate operations. Reaching either limit is reported as
a coverage failure, never as a pass.

Default mode is deliberately strict. Existing source files over 150 lines,
lint/type/build failures, uncaught browser errors, severe accessibility
violations, API contract failures, deployment drift, and threshold breaches
produce a non-zero exit code. Generated reports and third-party files are not
source code and are excluded from the 150-line source policy.

The suite cannot prove the absence of every defect. It reports exactly what it
enumerated, what it executed, what it skipped, and why. A green result means all
declared checks passed, not that arbitrary undiscovered states are impossible.
