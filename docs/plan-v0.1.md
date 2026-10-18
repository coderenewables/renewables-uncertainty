# Renewable Energy Uncertainty Framework Tool — Plan v0.1

*Draft for confirmation · 16 Oct 2026*

Scope: wind, solar, standalone and hybrid, plus BESS hybrids. Goal: help developers and owners see every source of uncertainty from the measurement device to the point of interconnection (POI), and still get a usable answer from whatever information they hold.

---

## 1. What the research says, and why it matters for the design

### 1.1 Wind already has a standard taxonomy — use it as the backbone

IEC 61400-15-2, *Framework for assessment and reporting of the wind resource and energy yield*, is the emerging industry reference. A BSI page still lists it as a proposal for comment, so I could not confirm it is published; its companion IEC 61400-15-1:2025 (site suitability) is published. The working group's public draft data format (EYA DEF, a JSON schema on GitHub, last updated Nov 2025) exposes the taxonomy:

**Wind uncertainty categories → subcategories**
- **Measurement** → wind speed measurement, wind direction measurement, other atmospheric parameters, data integrity
- **Historical wind resource** → long-term period representativeness, reference data consistency, long-term adjustment, wind speed distribution, on-site data synthesis
- **Vertical extrapolation** → measured data representativeness, vertical model uncertainty, excess propagated uncertainty
- **Horizontal extrapolation** → model inputs, model sensitivity, model appropriateness
- **Future assessment-period variability** → wind speed variability (interannual), climate change

**Plant performance (loss) categories → subcategories**
- **Turbine interaction** → internal, external, future wakes
- **Availability** → turbine, balance of plant, grid
- **Electrical** → electrical efficiency, facility parasitic consumption
- **Turbine performance** → sub-optimal performance, generic and site-specific power curve adjustment, high-wind hysteresis
- **Environmental** → icing, degradation, external conditions, exposure changes
- **Curtailment** → load, grid, environmental, operational strategies
- **Other** → asymmetric effects, upside scenarios

Three design features of the schema carry straight into the tool:
1. Wind uncertainties are stated as a relative **wind-speed** standard deviation and converted to energy with a **wind-speed-to-energy sensitivity factor** (the example file uses 1.65).
2. Losses are stated as **efficiencies** with a mean, a standard deviation and an **interannual variability tied to an evaluation period**.
3. Every loss subcategory carries a **"basis" tag**: time-series calculation, distribution calculation, other calculation, project-specific assumption, regional assumption, generic assumption, or not considered. This is exactly the mechanism needed to "work with whatever information is available" while staying honest about it.

### 1.2 Typical magnitudes (to seed the default library)

| Item | Typical range | Source |
|---|---|---|
| Cup anemometer, field (single sensor) | 1.3–2.5% wind speed | AWS Truepower compilation |
| Cup calibration (product data, 95%) | ~1.4–2.0% | NRG app note |
| Cup operational (classification) | u = k/√3 × (0.05 m/s + 0.005·U) | IEC 61400-12-1 Eq. 2 |
| Lidar, on-site verified + CFD-corrected, moderate/complex terrain | ~2–2.5% | DNV |
| Lidar, off-site calibration, no correction | ~4% | DNV |
| Lidar directional correction factors before CFD correction, complex terrain | up to ~9% | DNV |
| Long-term (MCP) | 1.6–2.8%; σ = σA·√(r²/N_R + (1−r²)/N_T) | AWS Truepower compilation |
| Interannual variability of wind speed σA | 3–5% | AWS Truepower compilation |
| Climate change | 0.5–2% | AWS Truepower compilation |
| Vertical extrapolation (shear) | 1.1–2.1%; the common "1% per 10 m" rule may overstate except in forest | AWS / Lee & Fields |
| Horizontal extrapolation (flow model) | ~2% simple, 3–6% typical, ≥10% complex | AWS Truepower compilation |
| Wind→energy sensitivity | ~2 at low-wind sites, ~1.5 at high-wind sites; not linear | Wind Energy – The Facts; DNV |
| Total wind loss (pre-construction) | 9.5–22.5% across eight studies | Lee & Fields 2021 |

Other findings that shape the engine:
- Lee & Fields (2021) found most categorical uncertainties sit at or below 10%, long-term uncertainty varies most between consultants, and horizontal extrapolation generally exceeds vertical. Root-sum-square is standard; correlation assumptions between categories are consultant-specific and change the total.
- DNV's WindFarmer runs a net-energy Monte Carlo (~500,000 samples), models availability with a long-tailed Weibull, and uses a project-specific sensitivity *curve* because straight-line ratios are inaccurate.
- Industry studies have found pre-construction P50s overpredicting by several percent, with the spread of P50 error around 6–7% (1σ). A bias sanity check is worth including.

### 1.3 Solar

- IEA PVPS Task 13 example combined uncertainty is ~6.5%: GHI 4.0%, plane-of-array transposition 2.5%, shading up to 3%, inverter 1.5%, temperature 1.0%, soiling 0.5%, most others 0–0.5%.
- Satellite GHI: literature gives 2–6% annual nRMSE; site-level bias can range from −5% to +10%. Transposition models can differ by up to ~2% annually. Module STC rating: ~1.6% at the best labs, 2–4% typical.
- The biggest disagreements between assessors are the irradiance database and site adaptation, degradation rate, soiling and shading.
- NREL's SAM separates **aleatory** (weather, interannual) from **epistemic** (model factor) uncertainty, gives each factor a distribution (normal or triangular), and runs Monte Carlo across weather years. Solargis uses RSS with P90 = P50·(1 − 1.282σ), dividing interannual variability by √N for an N-year horizon.

### 1.4 Hybrids

- Summing single-asset P90s assumes perfect correlation and is structurally conservative. 3E reports 2–4% P90 gains from portfolio treatment, more when wind and solar are combined, using a variance–covariance matrix weighted by energy share.
- Wind and solar technology uncertainties are near-fully independent; climate (interannual) correlation should be estimated from reanalysis; shared items (grid availability, curtailment, export line losses, metering) are fully correlated.

### 1.5 BESS hybrids

- I found no standard uncertainty framework for BESS. Risk is contract-driven: round-trip efficiency typically 85–95%, monthly availability around 98%, periodic capacity tests, cycling caps, and augmentation to offset degradation.
- Degradation depends on temperature, state-of-charge window, charge/discharge rate and cycling; NREL's BLAST/SAM life models report confidence intervals.
- In India's FDRE/RTC tenders the obligation is a **demand fulfilment ratio**: SECI's Aug 2026 1 GW tender requires ≥90% in peak hours, ≥80% off-peak (relaxable to 70% for two months in Jul–Sep) and 90% annually. ICRA notes monthly DFR, forced oversizing and merchant exposure. The uncertainty output that matters here is the **probability of meeting the DFR**, not only a MWh P90 — and it needs time-series simulation, because storage makes the response non-linear.

### 1.6 Existing tools and the gap

windPRO LOSS & UNCERTAINTY and WindFarmer cover wind; PVsyst, Solargis and SAM cover solar. I did not find a tool that spans wind, solar and BESS with one transparent, evidence-tagged register plus an explanatory layer for non-specialists. That is the gap this tool fills.

---

## 2. Proposed framework

### 2.1 The wind chain — measurement to POI

1. **Measurement** (per device)
   - Mast: cup calibration, operational/class, mounting (boom, tower shadow), data acquisition, icing/data loss, data integrity; vane offset for direction
   - Lidar/sodar: verification against reference, classification, mounting/levelling, terrain flow inhomogeneity (with or without CFD correction), availability/filtering
2. **Historical wind resource**: reference data consistency (ERA5/MERRA-2 trends), long-term period representativeness, MCP (r, overlap, method), distribution fit, gap filling
3. **Vertical extrapolation**: height gap to hub, shear model, propagated measurement uncertainty
4. **Horizontal extrapolation**: model type (WAsP/CFD), terrain and roughness inputs, RIX, distance and similarity of turbines to masts, number of masts
5. **Future variability**: interannual over 1-yr / 10-yr / lifetime; climate change
6. **Conversion to energy**: sensitivity curve from power curve + Weibull; power curve uncertainty
7. **Plant performance**: wakes (internal, external, future), blockage, availability (WTG/BOP/grid), electrical (array, transformers, export line to POI, auxiliaries), turbine performance, environmental, curtailment
8. **POI**: meter accuracy class; optional forecasting/scheduling deviation (revenue, not energy)

### 2.2 The solar chain

Irradiance source (ground sensor class, satellite model, site adaptation) → long-term and interannual → transposition and albedo (bifacial gain) → near/far shading → soiling and optical → temperature → module (nameplate tolerance, LID/LeTID, mismatch) → DC wiring → inverter and clipping → AC, transformer, export line → availability → curtailment → degradation over life → POI

### 2.3 The BESS layer

Beginning-of-life usable energy, state-of-health trajectory (calendar + cycle, temperature), round-trip efficiency and its decline, auxiliary/HVAC consumption, availability, SOC window, augmentation schedule, dispatch and forecast performance, grid-charging limits.
Outputs: delivered energy at POI, shifted energy, clipped-energy recapture, firm-supply (DFR) compliance probability, shortfall energy.

### 2.4 Hybrid combination

Covariance matrix across technologies weighted by energy share. Correlation groups: shared plant items fully correlated; resource measurement independent; interannual resource correlation entered by the user or estimated from reanalysis.

### 2.5 One line item = one record

Each uncertainty or loss item stores: stage, IEC label where one exists, quantity domain (wind speed, irradiance, energy, efficiency), central value, σ, distribution (normal, triangular, lognormal/Weibull for availability), time behaviour (static vs. interannual, which scales with 1/√N), correlation group, **evidence tier**, source/citation, and a plain-language note on what drives it and how to reduce it.

### 2.6 Working with whatever information exists — evidence tiers

Mapped onto the IEC "basis" tags:
- **Calculated** — user enters raw parameters and the tool computes (e.g., anemometer class + calibration certificate + mean wind speed → σ; MCP r and record lengths → σ)
- **Project-specific assumption** — user picks descriptors (terrain flat/moderate/complex; lidar verified on site yes/no; distance to mast) → looked-up range
- **Regional/generic default** — tool fills a cited literature default, visibly flagged
- **Not considered** — explicit and visible, never silently zero

The output always shows a **confidence mix** (share of total variance resting on generic defaults) and a **"reduce next" ranking** (which item, if improved, lifts P90 most).

### 2.7 Engine

- **Analytical (GUM)**: RSS with a correlation matrix; time horizon σ_N = √(σ_static² + σ_IAV²/N); P-values from the normal quantile
- **Monte Carlo**: sampled distributions, non-linear sensitivity curve, asymmetric losses, per-year degradation, BESS dispatch
- **Outputs**: P50, P75, P90, P95, P99 for 1-yr, 10-yr and lifetime; year-by-year table; energy at POI and CUF

### 2.8 Views

Chain diagram with uncertainty per stage; tornado of contributors; P-value table; confidence mix; "reduce next" list; exportable report and JSON aligned to the IEC EYA DEF for wind.

---

## 3. Phasing

| Phase | Content |
|---|---|
| 0 | Confirm decisions below; freeze taxonomy and the cited default library |
| 1 | Wind standalone, mast + lidar → POI, analytical engine, evidence tiers, core views |
| 2 | Solar standalone on the same engine; add Monte Carlo |
| 3 | Wind + solar hybrid combination (covariance) |
| 4 | BESS hybrids: hourly time-series Monte Carlo, DFR compliance probability |
| 5 (optional) | Operational re-assessment from SCADA, raw data processing, revenue/DSM effects |

---

## 4. Decisions needed — with my recommendation

1. **Primary user.** *Recommend:* developer/owner technical teams who commission, review and challenge consultant EYAs — build and review mode. *Why:* matches the project brief; lender-grade sign-off stays with the independent engineer, but the tool should produce IE-readable output.
2. **Tool format.** *Recommend:* an interactive web app (runs in browser and on phone) with saved projects and Excel/JSON export. *Why:* Monte Carlo and the hybrid/BESS time series are awkward in Excel; a web app also carries the explanatory layer. Excel export keeps it auditable.
3. **Standards backbone.** *Recommend:* IEC 61400-15-2 taxonomy and basis tags for wind; IEC 61400-12-1 and 61400-50-2 for instrument sub-calculations; IEA PVPS Task 13 plus the SAM factor approach for solar; our own documented framework for BESS. *Why:* bankable language for wind, best available practice for solar, nothing standard exists for BESS.
4. **Engine.** *Recommend:* analytical RSS with correlations as the default, Monte Carlo as a switch (mandatory for BESS). *Why:* RSS is transparent and matches consultant reports; Monte Carlo is needed for non-linear sensitivity, asymmetric losses and storage.
5. **Default values.** *Recommend:* a cited, versioned default library that every user can override, with defaults always flagged. *Why:* lets users with little data get an answer without hiding how much of it is assumption.
6. **Build order.** *Recommend:* wind (mast + lidar → POI) fully first, then solar, hybrid, BESS. *Why:* wind has the deepest chain and a standard to anchor it; solar and hybrid reuse the same engine.
7. **Raw data.** *Recommend:* Phase 1 takes parameters (r, record years, sensor class, terrain), not raw time series. *Why:* processing raw mast/lidar data is a separate wind-resource tool; the value here is the uncertainty framework. Upload can come later.
8. **Market.** *Recommend:* IEC-based and global, with India presets (CUF reporting, FDRE/RTC DFR checks, grid curtailment levels, CEA/NIWE references) if India is the main market. *Why:* standards are global, but tender obligations decide what "uncertainty" means commercially.
9. **BESS output metric.** *Recommend:* delivered energy P-values plus probability of meeting the DFR/availability obligation, from hourly profiles the user uploads (or a generated profile when none exists). *Why:* for firm-supply hybrids the penalty risk, not the MWh P90, drives financing.
10. **Project stage.** *Recommend:* pre-construction first; keep the data model ready for operational re-assessment. *Why:* that's where uncertainty is largest and decisions (mast vs lidar, extra measurement) are still open.

---

## 5. Sources

- IEC 61400-15-2 EYA DEF repository — https://github.com/IEC-61400/eya-def
- BSI project page, IEC 61400-15-2 proposal — https://standardsdevelopment.bsigroup.com/projects/9024-10576
- WindEurope 2022 poster on IEC 61400-15-2 — https://windeurope.org/tech2022/programme/posters/PO094
- WindEurope 2024 poster on IEC 61400-15 — https://windeurope.org/annual2024/conference/posters/PO168
- Lee & Fields (2021), Wind Energy Science 6, 311 — https://wes.copernicus.org/articles/6/311/2021/
- Uncertainty in Wind Resource Assessment (AWS Truepower-based) — https://www.inscc.utah.edu/~krueger/5270/UNCERTAINTY_IN_WIND_RESOURCE_ASSESSMENT.pdf
- NRG anemometer uncertainty app note — https://www.nrgsystems.com/assets/resources/40C-Anemometer-Uncertainty-AppNote.pdf
- DNV, remote sensing in complex flow — https://www.dnv.com/article/increasing-the-acceptance-of-remote-sensing-devices-in-complex-flow-conditions-226629/
- DNV WindFarmer net energy Monte Carlo — https://myworkspace.dnv.com/download/public/renewables/windfarmer/manuals/latest/CalcRef/NetEnergyMonteCarlo/netenergymontecarlo.html
- Wind Energy – The Facts, wind resource — https://www.wind-energy-the-facts.org/the-importance-of-the-wind-resource.html
- EMD windPRO LOSS & UNCERTAINTY — https://www.emd-international.com/software/windpro/modules/loss-uncertainty
- IEA PVPS Task 13 (2017) — https://iea-pvps.org/wp-content/uploads/2020/01/Uncertainties_in_PV_System_Yield_Predictions_and_Assessments_by_Task_13.pdf
- IEA PVPS Task 13 (2020) executive summary — https://iea-pvps.org/wp-content/uploads/2021/01/Executive-Summary-IEA-PVPS-T13-18_2020-Uncertainties-in-Yield-Assessments-and-PV-LCOE.pdf
- NREL SAM uncertainty method (2023) — https://nrel.gov/docs/fy23osti/86169.pdf
- Solargis, P50/P90 — https://kb.solargis.com/docs/p50-p90-and-other-scenarios
- 3E, portfolio effect on EYAs — https://www.3e.eu/resources/publications/portfolio-effect-energy-yield-assessments
- DWT, BESS performance risk (2026) — https://www.dwt.com/blogs/energy--environmental-law-blog/2026/02/managing-performance-risk-battery-energy-storage
- NREL battery lifespan — https://nrel.gov/transportation/battery-lifespan.html
- pv magazine, SECI 1 GW FDRE tender (Aug 2026) — https://www.pv-magazine.com/2026/08/10/secis-1-gw-fdre-rtc-power-tender-discovers-inr-5-25-kwh-tariff/
- ICRA on FDRE/RTC — https://www.icra.in/Media/GetNewsFile/22779
