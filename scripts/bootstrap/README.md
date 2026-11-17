# Bootstrap scripts

One-off Python scripts (standard library only) that produced the first catalog and the first artifact from a stack builder spreadsheet. The spreadsheet covered layers, technologies, languages, providers, runtimes and ten example stacks. The scripts are kept so the starting data can be traced and reproduced.

| Script | Does |
|---|---|
| `xlsx_rows.py <file.xlsx> <out.json>` | reads every sheet of an `.xlsx` with `zipfile` and `xml.etree` |
| `build_catalog.py <sheets.json> <catalog-dir> <json-dir>` | writes `catalog/{layers,technologies,languages,providers,runtimes}.yaml` (en + ASCII ro) and JSON copies |
| `build_blueprints.py <json-dir> <blueprints.yaml> <blueprints.json>` | writes `catalog/blueprints.yaml`, validating every id against the catalog |
| `build_artifact.py <repo> <json-dir> <claude-variant.html>` | builds `artifacts/2026-11-18-stack-map/` (the page plus `artifact.yaml` with source hashes) |

`agent-os stack import` and `agent-os artifact build` (Node, zero dependencies) will replace them. Run them with `python3 -I`.
