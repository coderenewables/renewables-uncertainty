# WattOdds

*Watt are the odds?*

WattOdds is a framework tool for renewable project developers and owners to capture and calculate energy yield uncertainty across the whole project chain — from the wind mast or lidar (or irradiance data) to the point of interconnection — for wind, solar PV, wind + solar hybrids, and hybrids with battery storage.

It runs entirely in the browser: one self-contained HTML page (HTML + JavaScript + CSS), no server.

## What it does

- **Results that stay on screen:** P50 to P99, the range of outcomes, the bridge from gross to net and the largest uncertainty drivers sit beside the inputs and follow every change. Figures that moved are tagged with the change; pin a baseline to compare two sets of inputs.
- **Gross to net:** every loss as a share of what is left, by group or by item, for wind, solar and hybrids (shared connection losses act on wind plus solar). Start from the tool's estimate, your own gross energy or a P50 from a report. This was LossStack, now part of WattOdds.
- **Plant view (default):** a drawing of the plant. Each part (masts and lidars, long-term reference, extrapolation, turbines, PV array, inverters, grid connection, battery …) shows its energy uncertainty and its share of the total. Selecting a part pops out its uncertainty categories; the inspector holds the inputs.
- **Step-by-step view:** the same project as a chain of stages following IEC 61400-15-2 (wind) and IEA PVPS Task 13 (solar).
- **Five ways to set each item:** calculate from site inputs, describe the site, enter a value, use a generic default, or exclude — with an evidence tier tracked for each.
- **Combination:** GUM-style analytical combination (root-sum-square within categories, correlations across categories, wind-speed-to-energy sensitivity from the power curve), P50–P99 for 1-year, 10-year and lifetime periods, and a Monte Carlo check.
- **Hybrids:** wind and solar combined by energy share with year-to-year and assessment correlations; shared grid items counted once; portfolio gain at P90.
- **Battery and firm supply:** hourly simulation of plant + battery against supply rules (e.g. SECI FDRE), with a Monte Carlo over operating years, shortfall, penalty and the drivers of risk. It reruns after each change, so delivered energy, battery losses and the chance of meeting the rules stay current.
- **Checks on the inputs:** capacity factors, performance ratios, plane-of-array ratios and clipping that do not fit the plant are flagged, with a link to the part concerned.
- **Exports:** Excel workbook (summary, uncertainty register, gross to net, plant parts, inputs, firm supply, sources), a loss table as CSV and a JSON project file.
- **Import from a report:** copy a prompt, run it with your consultant's report in an AI chat you are allowed to use, paste the JSON reply back, check each value against its page and quote, and apply. Nothing is sent from the page. Imported values are site values and keep their evidence.

## Layout

```
src/
  index.html     page skeleton (fonts, script slots)
  landing.html   landing page for coderenewables.com (buttons open app/)
  styles.css     all styles, light and dark
  engine.js      analytical engine and Monte Carlo (no DOM)
  library.js     uncertainty items, defaults, explanations, sources, examples
  bess.js        hourly storage and firm-supply simulation (no DOM)
  plant.js       places every item on a plant part and category; part totals (no DOM)
  reportimport.js  report import: schema, prompt, validation and apply (no DOM)
  plantview.js   plant drawing and inspector (inlined into ui.js at build time)
  results.js     results rail: P-values, odds curve, gross-to-net bridge, drivers, baseline (inlined into ui.js)
  importview.js  the "Import from a report" dialog (inlined into ui.js)
  ui.js          interface
build.py         concatenates src/ into dist/wind-energy-uncertainty.html and builds the website in dist/site/
dist/            the built single-file page (file name kept from before the rename so existing links keep working);
                 dist/site/ is the website (built, not committed)
tests/           unit tests (node) and browser checks (Playwright)
docs/            decisions and build notes
```

## Build

```
python3 build.py
```

## Website

coderenewables.com is deployed by GitHub Pages on every push to `main` (`.github/workflows/pages.yml`). The landing page (`src/landing.html`) is served at `/` and the app at `/app/`. `build.py` wraps both in a full HTML document (doctype, charset, viewport). Old links to an app stage on the root, such as `/#results`, are forwarded to `/app/#results`.

## Tests

```
node tests/engine.test.js     # analytical engine: wind, solar, hybrid, gross to net, input checks
node tests/bess.test.js       # storage and firm supply
node tests/plant.test.js      # plant parts add up to the total
node tests/reportimport.test.js  # report import: extraction, validation, units, duplicates, hybrid, apply and undo
node tests/import-ui.js <outdir>  # report import dialog in a browser
node tests/smoke.js  <outdir>             # step-by-step view in a browser
node tests/plant-ui.js <outdir>           # plant view in a browser
node tests/export.js <outdir> <xlsx.full.min.js> [solar|hybrid|bess]
node tests/suite.js <home-page> <loss-stack>  # suite project: LossStack opens in WattOdds with the same P50
```

The browser checks use Playwright (`npm i playwright`).

## Suite project

WattOdds can work on the same project as WindNudge, SolarNudge and LossStack, with the project bar at the top of the page. The shared storage and the bar come from `https://coderenewables.com/suite/v1/suite.js`, loaded deferred. Without it, WattOdds works as before.

- **Reads:** the `lossstack` section (the loss and storage items, the energy and plant values LossStack set) when WattOdds has not yet saved its own; the `windnudge` or `solarnudge` section (sensitivity, wind climate, rating, air density and shear, as the Nudge measured them). New upstream results are offered with **Apply**, never applied silently.
- **Writes:** its own `wattodds` section: the project and a year-1 summary, 800 ms after the last change.
- **Add to suite** (in the Projects panel) turns the project in front of you into a suite project, keeping its current state. New project, examples and opening a saved project leave the suite project.

The suite's storage is in the home page repository, `suite/v1/README.md`.

## Name and logo

The name is "what are the odds?" with watts: the tool gives the odds of an energy outcome (P50 to P99) and of meeting a supply contract. The mark is a dot plot of eleven outcomes; the one dot beyond the line is roughly the 10 % that falls below P90. At 24 px and below it becomes five bars. Colours follow the app: orange `#d9480f` (dark theme `#ff6b35`) on ink `#10212a`.

## Licence

WattOdds is open source under the [Apache License 2.0](LICENSE). Copyright 2026 Nithish Seenivasagam (coderenewables.com). You can use, change and share it, including commercially, as long as you keep the copyright and licence notices and say what you changed. See `LICENSE` and `NOTICE`.

## Notes

Default values marked "framework judgement" in the tool are starting points set from cited context, not published figures, and should be reviewed. See `docs/` for decisions, values to review and known limits.
