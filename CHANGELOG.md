# Changelog

## 0.1.0 — initial

- Detect clasp projects via `.clasp.json`.
- Command: **GAS Fakes: Init in This Project** (installs `@mcpher/gas-fakes`, runs `gas-fakes init`).
- Command: **GAS Fakes: Sign In (ADC)** (`gcloud auth application-default login`).
- Command: **GAS Fakes: Run Function** — quick-pick of zero-arg top-level functions from all `.gs`/`.js` files in `rootDir`, runs the chosen one through `@mcpher/gas-fakes` and streams output.
- Status bar item showing the active clasp project.
