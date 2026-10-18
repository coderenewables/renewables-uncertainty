# Wind Energy Uncertainty

A framework tool for renewable project developers and owners to capture and calculate energy yield uncertainty across the whole project chain — from the wind mast or lidar (or irradiance data) to the point of interconnection — for wind, solar PV, wind + solar hybrids, and hybrids with battery storage.

It runs entirely in the browser: one self-contained HTML page (HTML + JavaScript + CSS), no server.

## What it does

- **Plant view (default):** a drawing of the plant. Each part (masts and lidars, long-term reference, extrapolation, turbines, PV array, inverters, grid connection, battery …) shows its energy uncertainty and its share of the total. Selecting a part pops out its uncertainty categories; the inspector holds the inputs.
- **Step-by-step view:** the same project as a chain of stages following IEC 61400-15-2 (wind) and IEA PVPS Task 13 (solar).
- **Five ways to set each item:** calculate from site inputs, describe the site, enter a value, use a generic default, or exclude — with an evidence tier tracked for each.
- **Combination:** GUM-style analytical combination (root-sum-square within categories, correlations across categories, wind-speed-to-energy sensitivity from the power curve), P50–P99 for 1-year, 10-year and lifetime periods, and a Monte Carlo check.
- **Hybrids:** wind and solar combined by energy share with year-to-year and assessment correlations; shared grid items counted once; portfolio gain at P90.
- **Battery and firm supply:** hourly simulation of plant + battery against supply rules (e.g. SECI FDRE), with a Monte Carlo over operating years, shortfall, penalty and the drivers of risk.
- **Exports:** Excel workbook (summary, uncertainty register, plant parts, inputs, firm supply, sources) and a JSON project file.

## Layout

```
src/
  index.html     page skeleton (fonts, script slots)
  styles.css     all styles, light and dark
  engine.js      analytical engine and Monte Carlo (no DOM)
  library.js     uncertainty items, defaults, explanations, sources, examples
  bess.js        hourly storage and firm-supply simulation (no DOM)
  plant.js       places every item on a plant part and category; part totals (no DOM)
  plantview.js   plant drawing and inspector (inlined into ui.js at build time)
  ui.js          interface
build.py         concatenates src/ into dist/wind-energy-uncertainty.html
dist/            the built single-file page
tests/           unit tests (node) and browser checks (Playwright)
docs/            decisions and build notes
```

## Build

```
python3 build.py
```

## Tests

```
node tests/engine.test.js     # analytical engine: wind, solar, hybrid
node tests/bess.test.js       # storage and firm supply
node tests/plant.test.js      # plant parts add up to the total
node tests/smoke.js  <outdir>             # step-by-step view in a browser
node tests/plant-ui.js <outdir>           # plant view in a browser
node tests/export.js <outdir> <xlsx.full.min.js> [solar|hybrid|bess]
```

The browser checks use Playwright; the paths to Playwright and Chromium at the top of those files point at the environment they were written in and may need changing.

## Notes

Default values marked "framework judgement" in the tool are starting points set from cited context, not published figures, and should be reviewed. See `docs/` for decisions, values to review and known limits.
