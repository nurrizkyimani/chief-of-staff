# Sandbox Parity Checklist (RFC-001)

Pass criteria:

- Same command entrypoint for standard run flow.
- Same receipt extraction fields and `receipt.v1.1` contract.
- Same Google Sheets write behavior for valid receipts.
- Same classification output for golden set.
- No regression in M1 accuracy targets.

Recommended flow:

1. Run baseline (sandbox network permissive for parity dry run).
2. Capture output JSON (`baseline.json`) from golden set.
3. Enable sandbox hardening (`mode=all`, network `none` or controlled network).
4. Run same golden set and capture output JSON (`sandbox.json`).
5. Compare with:
   - `make parity-compare BASELINE=./baseline.json SANDBOX=./sandbox.json`

Known intentional difference:

- Sandbox may block unsafe/unapproved actions; this is expected.
