# HarnessScope v0.2 workspace compatibility fixture

`workspace.sqlite` is a synthetic compatibility database generated with the released `v0.2.0` Node store contract (`src/core/store.mjs` blob `351770bc5f2ebad9dcb0ad440803c2b71df235f2`) and redaction contract (`src/core/redact.mjs` blob `5798771fccb1b4bbda150e64c54d73a45ec6d499`).

The fixture contains one deterministic desktop session, one redacted HTTP request event, and one finding/evidence link. The input sentinel secret is intentionally absent from the persisted database bytes.

Regenerate from repository source with:

```bash
node scripts/make-v02-workspace-fixture.mjs
```

The committed database has additionally been compacted with a normal SQLite `VACUUM` to reduce repository size; schema and row contents are unchanged.
