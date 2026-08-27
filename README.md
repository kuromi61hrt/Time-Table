# Timetable Backend

Dependency-free Python backend for the timetable generator described in
`timetable-generator-spec.md`.

## Run

```powershell
python -m timetable.api
```

The API listens on `http://127.0.0.1:8000` by default.

- `GET /health` checks service health.
- `POST /validate` validates an input dataset.
- `POST /generate` validates and generates timetables.

Set `generation_options.variant_count` from 1 to 10 to request distinct,
deterministic timetable alternatives. The default remains one timetable.

Run the empty dataset with:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/generate `
  -ContentType application/json -InFile examples/empty-input.json
```

Tests use only the standard library:

```powershell
python -m unittest discover -s tests -v
```

Generate three Markdown tables and the complete JSON result in `generated/`:

```powershell
python -m timetable.export examples/ai-ds-ii-i-input.json --output generated
```

Every run overwrites the existing generated files. If fewer variants are
requested later, stale Markdown alternatives are removed.

Department overrides are loaded from `overrides/<department_id>.json` when
the request does not contain an inline override. Unknown custom rules are
reported as input errors rather than silently ignored.
