# lab-pdf-gen — synthetic lab-report generator

Generates realistic Indian-style lab-report PDFs (CBC, Lipid, LFT,
Thyroid) for stress-testing the `labsense-agent` watch / dedup /
upload pipeline and the `LabSense-Health` backend ingest path.
Output lands in `./test-sample/` (gitignored) — point the agent's
`watch_dir` at the absolute path:

```bash
labsense-agent --watch-dir ~/Projects/lab-pdf-gen/test-sample ...
```

## Why this exists

The agent's hot path is *watcher → SHA-256 → dedup → multipart
upload*. To exercise it under load we need:

1. **Volume** — at least a few thousand files, enough to surface
   debounce-window edge cases and SQLite WAL growth.
2. **Variety** — multiple report layouts and lab brandings so files
   hash differently and the dedup B-tree is exercised on more than
   one bucket prefix.
3. **Realistic patient mix** — most patients walk in once, a minority
   come back for follow-ups (e.g. thyroid recheck, lipid panel after
   diet change). Same patient on different dates produces different
   bytes → different sha256 → distinct upload, which is the most
   common real-lab pattern.

Hand-crafting 2k PDFs in Photoshop or relying on `dummy.pdf`
duplicates doesn't reproduce any of that. This generator does.

## Run

```bash
pnpm install
pnpm run generate:smoke           # 20 PDFs, seed 42, quick sanity
pnpm run generate:full            # ~2000 PDFs, seed 42
pnpm run generate -- --count 500 --seed 99 --out-dir ./test-sample
```

CLI flags:

- `--count N` — total PDFs to emit (default 2000).
- `--seed N` — deterministic RNG seed (default 42). Same seed →
  same patient set, same dates, same values, same filenames.
- `--out-dir PATH` — where the PDFs go (default `./test-sample`).
- `--mix unique=0.7,recurring=0.3` — override the patient mix.
- `--recurring-reports min=2,max=5` — override recurring patients'
  report-count range.

## Patient mix (default)

- **70%** unique walk-ins (one report each).
- **30%** recurring patients, each with **2–5** reports spread over
  the last 18 months. Each recurring patient stays on the same
  panel type roughly 70% of the time (a thyroid follow-up is a
  thyroid recheck, not a random CBC).

With `--count 2000`, that's ~1400 single-shot reports and ~600
follow-up reports across ~180 recurring patients.

## Layout

```
lab-pdf-gen/
├── package.json
├── data/
│   └── analyte-defs.json   # ref ranges, units, precision per analyte
├── src/
│   ├── index.js            # CLI entry
│   ├── render.js           # patient+report → PDF buffer → disk
│   ├── seedrand.js         # mulberry32 deterministic RNG
│   ├── labs.js             # 4 fictitious lab brandings
│   ├── generators/
│   │   ├── patients.js     # patient personas + recurring logic
│   │   └── analytes.js     # range-aware value generation
│   └── templates/
│       ├── shared.js       # header / footer / patient block
│       ├── cbc.js
│       ├── lipid.js
│       ├── lft.js
│       └── thyroid.js
└── test-sample/            # generated output (gitignored)
```

## Filename convention

```
{lab_slug}_{report_type}_{patient_id}_{YYYYMMDD-HHmmss}.pdf
```

Filenames are unique even for recurring patients (the timestamp
differs per follow-up), so a flat watch_dir won't collide.
