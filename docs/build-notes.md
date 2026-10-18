# Decisions and build notes — Phases 1–4 and the plant view

*Updated 16 Oct 2026*

## Decisions confirmed

All ten recommendations in `plan/uncertainty-framework-plan-v0.1.md` §4 were accepted, plus:
- **Format:** entirely HTML + JavaScript + CSS, running in the browser. No server.
- **Code protection:** not needed.

## Phase 1 delivered: wind, mast and lidar to POI

Published page: https://claude.ai/artifact/4FxesQ58JQEtbUwiz6N6QP (private until shared from its Share menu).

**Stages** (the left rail is the chain): Project → Measurement → Long-term wind → Vertical extrapolation → Horizontal extrapolation → Future variability → Wind to energy → Plant losses → POI → Results.

**Every item** carries its IEC 61400-15-2 category and subcategory, five input modes (Calculate, Describe, Enter value, Generic, Exclude), an evidence tier, sources, and a "what it is / what drives it / how to reduce it / where the numbers come from" panel.

**Evidence tiers → IEC basis tags:** Calculated → other_calculation; Site value → project_specific_assumption; Site description → project_specific_assumption; Generic default → generic assumption; Excluded → not_considered.

**Engine**
- Wind speed items: RSS within each IEC category; devices combined by share and an inter-device correlation; categories combined with a user-editable correlation matrix (default 0).
- σ_E(N)² = S² · (σ_ws,static² + σA²/N + σ_climate(N)²) + Σ energy items² + Σ (loss σ/η)² + Σ (loss yearly σ/η)²/N
- S computed numerically from the power curve and Weibull climate (±1 % on mean wind speed), or entered.
- P-values for 1-year, 10-year and lifetime: Pxx = P50 · (1 − z·σ).
- Monte Carlo check: non-linear wind-to-energy response, Weibull-distributed availability losses, seeded RNG, up to 250,000 samples.
- Outputs: P-value table with CUF, variance by stage and evidence tier, top items, evidence mix, "improve these first" (P90 gain if an item's σ is halved), reality checks (Hammond & Simley 2026 P50 bias, Vaisala wake bias, wind atlas bias), full uncertainty register.

**Information levels:** on-site (mast and/or lidar, any number) or desktop only (wind atlas σ 10.5 %, from RINA's 50-mast benchmark).

**Saving and export:** current project autosaves in the browser; "My projects" saves privately per user (cloud, any device); Excel workbook (sheets: Summary, Register, Inputs, Sources) and JSON project file via the viewer's download prompt; JSON import.

**Example project** (fictional, flagged in the app): 28 × 3.3 MW, 156 m rotor, 140 m hub, 6.8 m/s, moderate terrain, 100 m mast + on-site lidar. Net P50 299.5 GWh/yr, 10-year σ 8.70 %, P90 266.1 GWh/yr (88.9 % of P50). Largest contributor: flow model suitability (32 % of variance).

## Phase 2 delivered: solar PV, irradiance source to POI

Same page and link (version 2). Each project now picks a technology in Project: Wind or Solar PV. Switching technology on an example loads the matching example; Projects offers new and example projects for each.

**Solar stages:** Project → Irradiance data → Long-term and variability → Plane of array → PV conversion → Plant losses → POI → Results. Categories follow the IEA PVPS Task 13 structure (IEC 61400-15-2 is wind-only).

**Information levels for irradiance:** satellite only; satellite site-adapted with on-site sensors (satellite term replaced by sensor uncertainty + adaptation residual); on-site measurement only.

**Solar items (24):** satellite model, on-site sensors, site adaptation, long-term representativeness, year-to-year variability, transposition, horizon shading, bifacial rear-side gain, row shading, soiling (calculated from soiling rate × cleaning interval ÷ 2), reflection, spectral, low irradiance, temperature, module rating, LID/LeTID, mismatch, DC wiring, inverter, clipping (estimated from DC/AC ratio), simulation model chain, AC cabling and transformers, auxiliary consumption, plant availability, module degradation. Shared with wind: export line, grid availability, grid curtailment, other curtailment, metering.

**Engine additions**
- Irradiance is the resource: same combination as wind speed, with sensitivity S = 1.0 by default (enterable).
- P50 year 1 = DC MWp × annual GHI × POA/GHI ratio × Π(1 − loss); CUF on AC capacity; performance ratio and specific yield reported.
- Degradation is a yearly rate: year 1 excludes it; the N-year average loses rate × (N − 1)/2, and its uncertainty grows the same way. Period P50s and P-values reflect this.
- Bifacial gain is a negative loss with its own uncertainty.

**Solar example** (fictional): 195 MWp / 150 MWac, single-axis tracker, bifacial, GHI 1,950 kWh/m², POA ratio 1.24, hot climate, satellite data only. PR 77.8 %, 1,880 kWh/kWp, CUF 27.9 % (AC), P50 year 1 366.6 GWh. 10-year σ 7.04 %, P90 325.3 GWh (91.0 % of the 10-year P50). Largest contributor: satellite irradiance model (41 % of variance). Site adaptation cuts the irradiance term from 4.5 % to 2.4 %.

**Solar reality checks:** Task 13's main sources of assessor disagreement; clipping underestimated by hourly simulations at DC/AC ≥ 1.3 (Solargis); warning when a free irradiance database is used.

## Phase 3 delivered: wind + solar hybrid behind one connection

Same page and link (version 3). Technology now has a third option, Hybrid (wind + solar). Projects offers a new hybrid project and a hybrid example.

**Chain:** Project (wind plant, solar plant, grid connection) → the full wind chain → the full solar chain (solar losses become "Solar plant losses") → Shared connection → POI → Results. The rail groups stages as Wind, Solar and Shared.

**What is shared:** export line, grid availability, grid curtailment, other curtailment and metering are counted once, on the combined output. Each plant's own P50 is entered or estimated *before* those shared losses.

**New item:** export limit at the shared connection. Estimated from the connection size as a share of combined capacity, using a measured 1:1 PV–wind plant (Grab et al., ISES 2019: 0.04 % loss at 80 %, 0.63 % at 60 %, 1.98 % at 50 %, 6.67 % at 40 %), scaled up when the mix is far from 1:1. It can be entered from a joint time-series simulation.

**Combination**
- σ² = a_w² σ_w² + a_s² σ_s² + 2 a_w a_s (ρ_yearly σ_w,yearly σ_s,yearly + ρ_assessment σ_w,resource σ_s,resource) + shared items², with a = energy shares for the period.
- ρ_yearly: correlation of year-to-year resource variation (default 0). A MERRA-2 study found it near zero globally but strongly positive or negative in some regions; estimate from ERA5/MERRA-2 at the site.
- ρ_assessment: correlation between the two resource assessments (default 0; 3E treats different technologies as near-independent).
- Portfolio effect: the hybrid P90 is compared with the sum of the two plants' own P90s (3E: summing P90s is structurally conservative).
- Monte Carlo samples both plants together with the chosen correlations.

**Hybrid example** (fictional): the wind and solar examples behind a 150 MW connection (62 % of 242 MW combined). P50 year 1 661 GWh; 10-year σ 5.76 % against 8.71 % (wind alone) and 7.06 % (solar alone); P90 604 GWh, 16.7–17 GWh above the sum of the separate P90s. Export-limit loss estimated at 0.74 %. CUF on the connection about 50 %.

## Phase 4 delivered: battery storage and firm supply (hourly)

Same page and link (version 4). Any project (wind, solar or hybrid) can add a battery in Project ("Battery storage and firm supply"). Two stages are added: Battery storage and Firm supply. Projects offers a "Hybrid with storage" example.

**Hourly profiles:** upload one year of hourly MW (CSV; wind and/or solar columns; leap years trimmed) or let the tool generate them. Generated solar uses sun geometry for the mounting, daily cloud persistence and a seasonal pattern; generated wind uses a persistent Weibull series with seasonal and daily patterns through the project's power curve. Both are scaled to the chain's P50s (hybrid: after shared grid losses, before the export limit, which is applied hour by hour). The seasonal pattern options are "monsoon" (wind peak Jun–Aug, cloudy Jul–Aug; illustrative) and "no seasonality".

**Dispatch (hourly, rule-based, AC-coupled):** serve demand from generation within the export limit; charge from surplus; discharge to cover deficits, keeping a set share of the battery for peak hours; sell or curtail what is left. Battery charges only from the plant.

**Obligations:** rule sets for SECI FDRE-IV amendment 4 (monthly DFR ≥ 80 % all hours), SECI 1 GW FDRE Aug 2026 (peak ≥ 90 %, off-peak ≥ 80 % with two Jul–Sep months allowed at 70 %, annual 90 %), peak-only and round-the-clock. Targets and peak hours are editable. DFR = mean over the window's hours of min(supplied ÷ demand, 1), per FDRE-IV Annexure C. Penalty = shortfall energy below the minimum × penalty multiple (1.5) × tariff.

**Battery uncertainty items (6):** usable energy at start, round-trip efficiency (falls 0.15 points a year), capacity fade (default 2 %/yr; warranties typically 70–80 % SoH after 15–20 years), outages (whole days, Weibull), auxiliary/HVAC load, dispatch and forecast imperfection. Optional augmentation keeps capacity above a set level.

**Monte Carlo over operating years (year 1, 10 or final):** each simulated year draws wind and solar energy from the chain's one-year uncertainty (hybrid correlations included), reshuffles days within each month, applies solar degradation for the year, and draws the battery items. Outputs: chance of meeting every rule and each rule, months below target, shortfall P50/P90, penalty P50/P90, delivered energy with storage P50/P90, curtailment, cycles, monthly DFR (P50/P10), an average-day chart, and "what drives the risk" (each group held at its central value).

**Storage example** (fictional): the hybrid example with a 60 MW / 240 MWh battery and a 40 MW FDRE-IV contract. About 70 % chance of meeting every month at year 1 (400 years); October–December are the binding months; shortfall P90 about 0.5 GWh. Without the battery the chance is 0 %.

## Plant view delivered: interactive plant builder

Same page and link (version 5). The tool now opens on a drawing of the plant; the step-by-step view is one click away in the header and edits the same project.

**How it works:** pick Wind, Solar PV or Hybrid (and + Battery) above the drawing. Each part of the plant has a badge with its energy uncertainty (σ) and its share of the total. The shading on the drawing and the badge colour show the share; a small ring shows the evidence behind it (calculated, site value, site description, generic default). Selecting a part pops its uncertainty categories out as bubbles. The inspector beside the drawing shows the part's total, its set-up inputs and each category with its item cards, the same cards as the step-by-step view. A hybrid opens on the site (wind farm, solar farm, wind–solar link, shared connection, battery, buyer); selecting a farm opens its own drawing.

**Parts:**
- Wind: masts and lidars (one category per device), long-term reference, up to hub height, across the site, future wind, turbines, cables and substation, grid connection.
- Solar: irradiance data, future sunshine, sun to array, PV array, inverters, transformer and AC, grid connection.
- Hybrid site: wind farm, solar farm, wind–solar link, shared connection. Storage adds battery and firm supply (with the simulation run from the drawing).

**Numbers:** every item belongs to exactly one part and category. A part's σ is the square root of its share of the total variance, so the parts combine as root-sum-square to the plant total, and their shares add up to 100 % (plus the wind–solar correlation term in a hybrid). Wind and solar parts in a hybrid show σ relative to their own farm's energy and share relative to the site total. The plant summary explains why a straight sum of the parts is larger than the total. Battery items act through the hourly simulation, not the P-values.

**Layouts:** wide screens show the drawing with the inspector beside it; tablets show the inspector below; phones show the parts as a vertical chain from mast to grid, with the inspector as a bottom sheet. Light and dark themes.

**Export:** the Excel workbook has a new "Plant parts" sheet with every part and category, its energy σ, share of total, combined loss and share resting on generic defaults.

## Values to review

Items marked "framework judgement" in the app are starting values set by the tool from cited context, not published figures. They are the first thing for the team to review: mast data integrity, lidar verification/classification/mounting/availability, direction and density, reference consistency, long-term representativeness, distribution and gap filling, shear representativeness, flow model adjustments for model type, distance and number of masts, terrain inputs and sensitivity, power curve, all losses except internal wakes and electrical, and metering.

Storage: battery item defaults (capacity test, RTE, fade, outages, auxiliary load, dispatch imperfection), the generated seasonal patterns, and the rule-set details against the exact tender documents. The peak hours in the Aug 2026 preset are taken from FDRE-IV until the final tender text is checked.

Hybrid: the export-limit estimate (one German site; Indian hybrid sites with higher capacity factors will curtail more) and the default wind–solar correlations of 0.

Solar: satellite model tiers, sensor and site-adaptation values, long-term representativeness, transposition by mount, bifacial gains, row shading, soiling options, spectral default, temperature by climate, LID options, inverter options, clipping by DC/AC, model chain, auxiliary consumption, availability options and degradation options.

## Known limits (next candidates)

- The analytical export-limit loss (hybrid, no battery) is still an estimate; with a battery the hourly simulation applies the limit directly.
- Dispatch is rule-based with no look-ahead; forecast quality is represented by a single derating item.
- Capacity fade is linear in time; front-loaded fade and cycle-dependent ageing are not modelled.
- Generated profiles are illustrative; upload simulated 8760-hour profiles for real decisions.
- The battery charges only from the plant (no grid charging); DC-coupled batteries and sub-hourly effects are not modelled.
- Uploaded profiles are scaled to the chain's P50s and capped at the plant's capacity.
- The plant drawing is a standard layout drawn from the project's counts (up to three devices and three turbines are drawn), not the real site layout.
- No IEC EYA DEF JSON export yet; the register carries the IEC labels.
- No year-by-year table (wind blade degradation is a lifetime average; solar degradation uses period averages).
- Solar sensitivity is a constant (1.0 by default), not derived from a time-series model.
- Losses are independent of each other; only availability and grid curtailment have yearly variability.
- Parameters only, no raw mast or lidar data.

## Source code

The published page contains the full source in five script blocks: Engine (analytical calculations), Library (items, defaults, sources, explanations), Firm (hourly storage and supply simulation), Plant (which part and category each item belongs to, and each part's share of the total) and the interface (which includes the plant drawing). The build concatenates `styles.css`, `engine.js`, `library.js`, `bess.js`, `plant.js` and `ui.js` (with `plantview.js` inside it) into one page. Plant checks (14) cover that every item has one place, that parts add up to the total in variance at every period for all examples, device categories, desktop mode, hybrid farm shares and the correlation term, battery categories, degradation by period and excluded items. Plant view browser checks (91) cover badges without overlap, every part's bubbles staying inside the drawing, category cards, live updates that keep focus, device adding, period switching, keyboard selection and Escape, wind atlas mode, switching views, solar, hybrid drill-down and correlation, battery and a firm-supply run from the drawing, tablet and phone in light and dark. Storage checks (16) cover generated profile energy and seasonality, CSV parsing, energy conservation in dispatch, export limits, rule scoring with relaxation, the SECI penalty example, profile scaling, monotonic benefit of more storage, ageing and augmentation, drivers, single-technology runs and speed (400 years in about 0.2 s). Engine checks (37: 20 wind, 9 solar, 8 hybrid) cover the MCP and anemometer formulas, Weibull fitting, energy and sensitivity, horizons, variance decomposition, Monte Carlo agreement, device combination, desktop mode, entered P50, custom power curves and climate scaling, plus solar yield and CUF, degradation by period, site adaptation, clipping, soiling and Monte Carlo agreement, plus hybrid shared items, P50 composition, correlation effects, variance decomposition, joint Monte Carlo and the export-limit curve. Browser checks cover every stage of all project types, storage stages, profile upload, simulation runs and drivers at desktop and phone widths in light and dark, live updates, and the Excel and JSON exports.
