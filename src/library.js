/* WattOdds — energy yield uncertainty, source to meter.
   Copyright 2026 Nithish Seenivasagam (coderenewables.com)
   SPDX-License-Identifier: Apache-2.0 */
/* Item library: every uncertainty and loss item, its input modes, defaults, sources and explanations.
   Values are percentages. Wind-speed items ('ws') are relative wind speed uncertainty;
   energy items ('en') are relative energy uncertainty; loss items carry a loss L (%) and its
   uncertainty s (percentage points), optionally an interannual variability iav. */
const Library = (() => {
  'use strict';
  const ln = Math.log;
  const SQ3 = Math.sqrt(3);

  const SOURCES = {
    iecdef: { t: 'IEC 61400-15-2 energy yield data exchange format (draft JSON schema)', u: 'https://github.com/IEC-61400/eya-def' },
    lee: { t: 'Lee & Fields (2021), An overview of wind-energy-production prediction bias, losses, and uncertainties, Wind Energy Science 6', u: 'https://wes.copernicus.org/articles/6/311/2021/' },
    aws: { t: 'Uncertainty in Wind Resource Assessment (compilation based on AWS Truepower methods)', u: 'https://www.inscc.utah.edu/~krueger/5270/UNCERTAINTY_IN_WIND_RESOURCE_ASSESSMENT.pdf' },
    nrg: { t: 'NRG Systems, anemometer uncertainty application note (IEC 61400-12-1 classification formula, calibration values)', u: 'https://www.nrgsystems.com/assets/resources/40C-Anemometer-Uncertainty-AppNote.pdf' },
    emd: { t: 'EMD, mast compliance check notes (IEC 61400-12-1 Annex G thresholds)', u: 'https://www.emd-international.com/files/windpro/210629_Notes-compliancy%20check.pdf' },
    nrgboom: { t: 'NRG Systems, IEC-compliant side-mount booms (boom distortion below 0.5 %)', u: 'https://nrgsystems.com/blog/new-iec-compliant-side-mount-booms' },
    dnvrsd: { t: 'DNV, Increasing the acceptance of remote sensing devices in complex flow conditions', u: 'https://www.dnv.com/article/increasing-the-acceptance-of-remote-sensing-devices-in-complex-flow-conditions-226629/' },
    dnvmc: { t: 'DNV WindFarmer, net energy Monte Carlo simulation', u: 'https://myworkspace.dnv.com/download/public/renewables/windfarmer/manuals/latest/CalcRef/NetEnergyMonteCarlo/netenergymontecarlo.html' },
    facts: { t: 'Wind Energy – The Facts, the importance of the wind resource', u: 'https://www.wind-energy-the-facts.org/the-importance-of-the-wind-resource.html' },
    vaisala: { t: 'Vaisala, Wake Loss Validation Study (2019)', u: 'https://www.vaisala.com/sites/default/files/documents/Vaisala-Wake_Loss_Validation_Study-2019.pdf' },
    kema: { t: 'DNV KEMA, power performance testing (EWEA Resource Assessment 2013)', u: 'https://www.ewea.org/events/workshops/wp-content/uploads/2013/06/EWEA-RA2013-Dublin-3-3-Mark-Young-DNV-Kema.pdf' },
    rina: { t: 'RINA, benchmark of Global Wind Atlas and GASP against 50 masts (WindEurope 2024, PO053)', u: 'https://windeurope.org/tech2024/programme/posters/PO053' },
    hammond: { t: 'Hammond & Simley (2026), preconstruction estimates versus operational data for 94 plants, Wind Energy Science 11', u: 'https://wes.copernicus.org/articles/11/1251/2026/' },
    vamk: { t: 'VAMK, Uncertainties in wind energy production (summary of typical values from Lee & Fields and KEMA)', u: 'https://energiaa.vamk.fi/en/articles/komptence/uncertainties-in-wind-energy-production/' },
    gum: { t: 'JCGM 100:2008, Guide to the expression of uncertainty in measurement (GUM)', u: 'https://doi.org/10.59161/JCGM100-2008E' },
    t13: { t: 'IEA PVPS Task 13, Uncertainties in PV System Yield Predictions and Assessments (2017)', u: 'https://iea-pvps.org/wp-content/uploads/2020/01/Uncertainties_in_PV_System_Yield_Predictions_and_Assessments_by_Task_13.pdf' },
    t13b: { t: 'IEA PVPS Task 13, Uncertainties in Yield Assessments and PV LCOE, executive summary (2020)', u: 'https://iea-pvps.org/wp-content/uploads/2021/01/Executive-Summary-IEA-PVPS-T13-18_2020-Uncertainties-in-Yield-Assessments-and-PV-LCOE.pdf' },
    sam: { t: 'NREL, PV energy uncertainty in the System Advisor Model (2023)', u: 'https://nrel.gov/docs/fy23osti/86169.pdf' },
    sgpv: { t: 'Solargis, P50, P90 and other scenarios', u: 'https://kb.solargis.com/docs/p50-p90-and-other-scenarios' },
    sgvar: { t: 'Solargis, solar resource variability', u: 'https://kb.solargis.com/docs/solar-resource-variability' },
    sgadapt: { t: 'Solargis, solar irradiance site adaptation', u: 'https://kb.solargis.com/docs/solar-irradiance-site-adaptation' },
    sgsub: { t: 'Solargis, the importance of sub-hourly input data in PV simulation', u: 'https://kb.solargis.com/docs/the-importance-of-sub-hourly-input-data-in-pv-systems-simulation-using-satellite-based-solar-model-data' },
    jordan: { t: 'NREL (Jordan et al.), PV degradation rates', u: 'https://www.nrel.gov/docs/fy15osti/65040.pdf' },
    rwsoil: { t: 'Renewable Watch, soiling analysis (Delhi field study)', u: 'https://renewablewatch.in/2018/12/22/soiling-analysis/' },
    albedo: { t: 'pv magazine, guidelines for albedo measurement for bifacial PV (2023)', u: 'http://www.pv-magazine.com/2023/07/31/new-guidelines-for-albedo-measurements-aim-to-reduce-uncertainties-in-bifacial-pv-yield-estimates/' },
    frontiers: { t: 'Frontiers in Energy Research (2022), PV energy performance and losses in coastal India', u: 'https://www.frontiersin.org/articles/10.3389/fenrg.2022.857948/pdf' },
    grab: { t: 'Grab et al. (ISES SWC 2019), Optimizing the grid connection of hybrid PV and wind power plants', u: 'https://proceedings.ises.org/conference/swc2019/papers/swc2019-0100-Grab.pdf' },
    iavcorr: { t: 'Interannual variability and seasonal predictability of wind and solar resources (MERRA-2, 1980–2016)', u: 'https://www.preprints.org/manuscript/201707.0013/v1' },
    e3: { t: '3E, Portfolio effect on long-term energy yield assessments', u: 'https://www.3e.eu/resources/publications/portfolio-effect-energy-yield-assessments' },
    hybpolicy: { t: 'IEA policy database, India National Wind-Solar Hybrid Policy', u: 'https://www.iea.org/policies/6485-national-wind-solar-hybrid-policy' },
    dwt: { t: 'Davis Wright Tremaine, Managing performance risk in battery energy storage projects (2026)', u: 'https://www.dwt.com/blogs/energy--environmental-law-blog/2026/02/managing-performance-risk-battery-energy-storage' },
    furo: { t: 'Furo Energy, How battery storage really ages and how we model it', u: 'https://www.furoenergy.com/en/articles/wie-batteriespeicher-wirklich-altern-und-wie-wir-das-modellieren' },
    esnews: { t: 'Energy-Storage.news, Navigating the rigid world of energy storage warranties', u: 'https://www.energy-storage.news/navigating-the-rigid-world-of-energy-storage-warranties/' },
    dnvwarr: { t: 'DNV, Energy storage capacity warranties: beyond the fine print', u: 'https://dnv.com/article/energy-storage-capacity-warranties-beyond-the-fine-print-200339' },
    nrelbatt: { t: 'NREL, Battery lifespan', u: 'https://nrel.gov/transportation/battery-lifespan.html' },
    fdre4: { t: 'SECI FDRE-IV RfS, amendment 4 (DFR definition and penalty)', u: 'https://www.seci.co.in/Upload/Tender/SECI000120-5746816-Amendment-04-SECI-FDRE-IV-finalupload.pdf' },
    fdre4a2: { t: 'SECI FDRE-IV RfS, amendment 2 (peak hours)', u: 'https://www.seci.co.in/Upload/Tender/SECI000120-9165256-Amendment-02-SECI-FDRE-IV-finalupload.pdf' },
    seci26: { t: 'pv magazine, SECI 1 GW FDRE tender (August 2026)', u: 'https://www.pv-magazine.com/2026/08/10/secis-1-gw-fdre-rtc-power-tender-discovers-inr-5-25-kwh-tariff/' },
    icra: { t: 'ICRA, FDRE and RTC tenders', u: 'https://www.icra.in/Media/GetNewsFile/22779' },
    judge: { t: 'Framework judgement value: a starting point set by this tool from the context cited alongside it. Replace it with a site value when you have one.', u: '' },
  };

  const STAGES = [
    { id: 'project', name: 'Project', blurb: 'Plant, wind climate and how the P50 is set.' },
    { id: 'measurement', name: 'Measurement', iec: 'measurement', blurb: 'How well the instruments record the wind at the measurement location and height.' },
    { id: 'historical', name: 'Long-term wind', iec: 'historical_wind_resource', blurb: 'How well the measured period, corrected with reference data, represents the long-term mean.' },
    { id: 'vertical', name: 'Vertical extrapolation', iec: 'vertical_extrapolation', blurb: 'Carrying the measured wind speed up (or down) to hub height.' },
    { id: 'horizontal', name: 'Horizontal extrapolation', iec: 'horizontal_extrapolation', blurb: 'Carrying the wind speed from the measurement location to every turbine.' },
    { id: 'future', name: 'Future variability', iec: 'future_assessment_period_variability', blurb: 'Natural year-to-year variation and climate change over the period you are evaluating.' },
    { id: 'conversion', name: 'Wind to energy', blurb: 'Turning wind speed into energy through the power curve.' },
    { id: 'losses', name: 'Plant losses', iec: 'plant_performance', blurb: 'Wakes, availability, electrical losses, turbine performance, environment and curtailment.' },
    { id: 'poi', name: 'Point of interconnection', blurb: 'The energy delivered and metered at the POI.' },
    { id: 'irradiance', name: 'Irradiance data', tech: 'solar', ref: 'irradiance_source', blurb: 'How well the satellite dataset or on-site sensors describe the sunshine at the site.' },
    { id: 'solar_lt', name: 'Long-term and variability', tech: 'solar', ref: 'long_term_irradiance', blurb: 'Whether the irradiance record stands for the future, and how much single years and periods vary.' },
    { id: 'poa', name: 'Plane of array', tech: 'solar', ref: 'plane_of_array', blurb: 'Turning horizontal irradiance into irradiance on the tilted or tracking modules, front and rear.' },
    { id: 'pvconv', name: 'PV conversion', tech: 'solar', ref: 'pv_conversion', blurb: 'Shading, soiling, optics, temperature, module quality, DC wiring, inverter and clipping.' },
    { id: 'pvlosses', name: 'Solar plant losses', tech: 'hybrid', ref: 'plant_losses', blurb: 'Solar AC losses, availability and module degradation over the years.' },
    { id: 'hybrid', name: 'Shared connection', tech: 'hybrid', blurb: 'What the wind and solar plants share, and how their errors relate: export line, grid availability, curtailment, the export limit and the wind–solar correlation.' },
    { id: 'bess', name: 'Battery storage', blurb: 'Battery size and the uncertainties that decide how much of it is there when it is needed.' },
    { id: 'supply', name: 'Firm supply', blurb: 'Hourly simulation of the plant and battery against a demand profile: the probability of meeting demand-fulfilment rules, shortfall and penalty.' },
    { id: 'results', name: 'Results', blurb: 'P-values, where the uncertainty comes from, and what to improve first.' },
  ];
  STAGES.find(s => s.id === 'losses').blurbSolar = 'AC losses, availability, curtailment and module degradation over the years.';
  STAGES.find(s => s.id === 'project').blurbSolar = 'Plant, irradiance and how the P50 is set.';
  STAGES.find(s => s.id === 'project').blurbHybrid = 'Wind plant, solar plant and the shared grid connection.';
  STAGES.find(s => s.id === 'losses').nameHybrid = 'Wind plant losses';
  STAGES.find(s => s.id === 'losses').blurbHybrid = 'Wakes, availability, electrical losses, turbine performance, environment and wind-specific curtailment. Grid-wide items sit under Shared connection.';

  const CHAINS = {
    wind: ['measurement', 'historical', 'vertical', 'horizontal', 'future', 'conversion', 'losses', 'poi'],
    solar: ['irradiance', 'solar_lt', 'poa', 'pvconv', 'losses', 'poi'],
    hybrid: ['measurement', 'historical', 'vertical', 'horizontal', 'future', 'conversion', 'losses', 'irradiance', 'solar_lt', 'poa', 'pvconv', 'pvlosses', 'hybrid', 'poi'],
  };
  const COMPONENT_OF_STAGE = { measurement: 'wind', historical: 'wind', vertical: 'wind', horizontal: 'wind', future: 'wind', conversion: 'wind', losses: 'wind', irradiance: 'solar', solar_lt: 'solar', poa: 'solar', pvconv: 'solar', pvlosses: 'solar' };

  const LOSS_GROUPS = [
    { id: 'turbine_interaction', name: 'Turbine interaction' },
    { id: 'availability', name: 'Availability' },
    { id: 'electrical', name: 'Electrical' },
    { id: 'turbine_performance', name: 'Turbine performance' },
    { id: 'environmental', name: 'Environmental' },
    { id: 'curtailment', name: 'Curtailment' },
  ];
  const GROUPS = {
    wind: { losses: LOSS_GROUPS },
    solar: {
      pvconv: [{ id: 'shading_optical', name: 'Shading and optics' }, { id: 'thermal', name: 'Temperature' }, { id: 'module', name: 'Modules' }, { id: 'dc_inverter', name: 'DC side and inverter' }, { id: 'model', name: 'Simulation model' }],
      losses: [{ id: 'electrical', name: 'Electrical' }, { id: 'availability', name: 'Availability' }, { id: 'curtailment', name: 'Curtailment' }, { id: 'degradation', name: 'Degradation' }],
    },
  };
  GROUPS.hybrid = {
    losses: LOSS_GROUPS,
    pvconv: GROUPS.solar.pvconv,
    pvlosses: [{ id: 'electrical', name: 'Electrical' }, { id: 'availability', name: 'Availability' }, { id: 'degradation', name: 'Degradation' }],
    hybrid: [{ id: 'electrical', name: 'Export line' }, { id: 'availability', name: 'Grid availability' }, { id: 'curtailment', name: 'Curtailment and export limit' }],
  };

  const onsite = ctx => !ctx.desktop;
  const vz = ctx => { const v = ctx.vertical || {}; const hm = +v.hMeas || ctx.hub; return hm >= ctx.hub ? 0 : Math.abs(ln(ctx.hub / hm)); };
  const SHEAR_F = { simple: 0.10, moderate: 0.15, complex: 0.20 };
  const mcp = (sA, r, nR, nT) => sA * Math.sqrt((r * r) / Math.max(1, nR) + (1 - r * r) / Math.max(0.25, nT));
  const frac = (L, f) => ({ L, s: L * f });

  const ITEMS = [
    /* ---------------- Measurement: mast ---------------- */
    {
      id: 'cup_cal', stage: 'measurement', device: 'mast', cat: 'measurement', sub: 'wind_speed_measurement', domain: 'ws',
      name: 'Anemometer calibration', defaultMode: 'desc',
      calc: { fields: [{ key: 'calExp', label: 'Expanded uncertainty on the calibration certificate (k = 2)', unit: '%', def: 1.5, step: 0.05 }], fn: x => x.calExp / 2, note: 'σ = certificate value ÷ 2' },
      desc: { def: 0, options: [
        { label: 'Individual wind-tunnel calibration (MEASNET)', v: 0.75 },
        { label: 'Batch or consensus calibration only', v: 1.5 },
        { label: 'Calibration status unknown', v: 2.0 } ] },
      def: { v: 1.0 },
      src: ['nrg', 'judge'],
      info: {
        what: 'The wind tunnel calibration that links the anemometer signal to wind speed has its own uncertainty, stated on the certificate.',
        drives: 'Calibration facility, sensor type, whether each sensor was calibrated individually.',
        reduce: 'Use individually MEASNET-calibrated sensors and enter the certificate value. Post-campaign recalibration confirms the sensor did not drift.',
        values: 'Product data quote about 1.4–2.0 % at 95 % confidence for individually calibrated cups, which is 0.7–1.0 % standard uncertainty.' },
    },
    {
      id: 'cup_op', stage: 'measurement', device: 'mast', cat: 'measurement', sub: 'wind_speed_measurement', domain: 'ws',
      name: 'Anemometer operational behaviour (class)', defaultMode: 'calc',
      calc: { fields: [{ key: 'k', label: 'Classification number k (e.g. 1.7 for "1.7A")', unit: '', def: 1.7, step: 0.1 }],
        fn: (x, ctx) => { const U = Math.max(3, ctx.wsMeas || ctx.meanWs); return x.k / SQ3 * (0.05 + 0.005 * U) / U * 100; },
        note: 'σ = k/√3 × (0.05 m/s + 0.005·U) ÷ U, U = mean wind speed at the sensor height' },
      desc: { def: 1, options: [
        { label: 'Premium sensor, class about 0.9–1.3', v: ctx => 1.1 / SQ3 * (0.05 + 0.005 * Math.max(3, ctx.wsMeas)) / Math.max(3, ctx.wsMeas) * 100 },
        { label: 'Standard sensor, class about 1.5–2.5', v: ctx => 2.0 / SQ3 * (0.05 + 0.005 * Math.max(3, ctx.wsMeas)) / Math.max(3, ctx.wsMeas) * 100 },
        { label: 'Class unknown', v: ctx => 3.0 / SQ3 * (0.05 + 0.005 * Math.max(3, ctx.wsMeas)) / Math.max(3, ctx.wsMeas) * 100 } ] },
      def: { v: ctx => 2.4 / SQ3 * (0.05 + 0.005 * Math.max(3, ctx.wsMeas)) / Math.max(3, ctx.wsMeas) * 100 },
      src: ['nrg'],
      info: {
        what: 'In the field an anemometer responds to turbulence, inclined flow and temperature differently than in the wind tunnel. The IEC classification number captures this.',
        drives: 'Sensor class, turbulence and terrain-induced flow inclination.',
        reduce: 'Use a sensor with a low class number for the site category (A for flat, B for complex terrain).',
        values: 'IEC 61400-12-1 gives σ = k/√3 × (0.05 m/s + 0.005·U). The generic default uses k = 2.4, the class A value quoted for a common reference cup.' },
    },
    {
      id: 'cup_mount', stage: 'measurement', device: 'mast', cat: 'measurement', sub: 'wind_speed_measurement', domain: 'ws',
      name: 'Mounting and mast flow distortion', defaultMode: 'desc',
      calc: { fields: [{ key: 'a', label: 'Largest remaining flow distortion after any correction', unit: '%', def: 1.0, step: 0.1 }], fn: x => x.a / SQ3, note: 'σ = a/√3 (rectangular distribution, GUM)' },
      desc: { def: 0, options: [
        { label: 'Top-mounted, compliant with IEC 61400-12-1 Annex G', v: 0.5 / SQ3 },
        { label: 'Side-mounted, boom meets the 0.5 % deficit criterion', v: 0.5 / SQ3 },
        { label: 'Side-mounted, boom meets the 1 % deficit criterion', v: 1.0 / SQ3 },
        { label: 'Not compliant or unknown', v: 2.0 / SQ3 } ] },
      def: { v: 1.0 / SQ3 },
      src: ['emd', 'nrgboom', 'gum', 'judge'],
      info: {
        what: 'The mast, booms and nearby sensors slow or speed up the flow at the sensor. What is left after correction is an uncertainty.',
        drives: 'Top versus side mounting, boom length relative to the mast width, mast type, direction of the main wind relative to the boom.',
        reduce: 'Follow Annex G mounting rules, orient booms to the main wind direction, and use paired sensors to correct directional effects.',
        values: 'Annex G treats a 0.5 % wind speed deficit as OK and 1 % as acceptable. The tool treats the remaining deficit as a rectangular distribution, so σ = a/√3.' },
    },
    {
      id: 'cup_daq', stage: 'measurement', device: 'mast', cat: 'measurement', sub: 'wind_speed_measurement', domain: 'ws',
      name: 'Data acquisition', defaultMode: 'default',
      def: { v: 0.1 },
      src: ['judge'],
      info: { what: 'Logger resolution and signal conversion.', drives: 'Logger type and counting method.', reduce: 'Usually negligible with modern loggers.', values: 'A 0.1 % starting value reflects the small size of this term in practice.' },
    },
    {
      id: 'mast_integrity', stage: 'measurement', device: 'mast', cat: 'measurement', sub: 'data_integrity', domain: 'ws',
      name: 'Data integrity and sensor condition', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Recovery above 95 %, post-calibration within tolerance', v: 0.3 },
        { label: 'Recovery 85–95 %, or no post-calibration', v: 0.7 },
        { label: 'Recovery below 85 %, icing, or degraded sensors', v: 1.5 } ] },
      def: { v: 0.7 },
      src: ['iecdef', 'judge'],
      info: { what: 'Gaps, icing, sensor degradation and data cleaning choices can bias the measured mean.', drives: 'Data recovery rate, maintenance visits, icing, whether sensors were recalibrated after removal.', reduce: 'Keep recovery high, document data cleaning, and recalibrate sensors at the end of the campaign.', values: 'IEC 61400-15-2 lists data integrity as its own measurement subcategory. The values here are framework judgement.' },
    },

    /* ---------------- Measurement: lidar ---------------- */
    {
      id: 'lid_verif', stage: 'measurement', device: 'lidar', cat: 'measurement', sub: 'wind_speed_measurement', domain: 'ws',
      name: 'Verification against a reference mast', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'Verified on site against an IEC-compliant mast', v: 1.5 },
        { label: 'Verified at a test site before deployment', v: 1.6 },
        { label: 'Not verified, manufacturer data only', v: 3.0 } ] },
      def: { v: 1.6 },
      src: ['dnvrsd', 'judge'],
      info: { what: 'A lidar is checked against a calibrated mast. The result carries the reference mast\'s own uncertainty plus the scatter and bias of the comparison.', drives: 'Quality of the reference mast, length of the test, how well the test site resembles your site.', reduce: 'Verify the unit on site, next to an IEC-compliant mast, before and after the campaign.', values: 'Set so that verification, classification, mounting and terrain terms add up to DNV\'s reported totals: about 2–2.5 % with on-site calibration and CFD correction, about 4 % with off-site calibration and no correction.' },
    },
    {
      id: 'lid_class', stage: 'measurement', device: 'lidar', cat: 'measurement', sub: 'wind_speed_measurement', domain: 'ws',
      name: 'Classification (sensitivity to conditions)', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Classified, low sensitivity (report shows about 0.5 % or less)', v: 0.5 },
        { label: 'Classified, typical sensitivity', v: 1.0 },
        { label: 'Not classified', v: 1.5 } ] },
      def: { v: 1.0 },
      src: ['judge'],
      info: { what: 'How much the lidar reading shifts with turbulence, shear, temperature and other conditions, from its classification test.', drives: 'Device model and the range of conditions at your site compared with the classification test.', reduce: 'Use a model with an IEC 61400-50-2 classification report and enter its stated uncertainty.', values: 'Classification reports state a standard uncertainty directly. Some current models report values close to zero.' },
    },
    {
      id: 'lid_mount', stage: 'measurement', device: 'lidar', cat: 'measurement', sub: 'wind_speed_measurement', domain: 'ws',
      name: 'Mounting and levelling', defaultMode: 'default',
      desc: { def: 0, options: [{ label: 'Fixed base, levelled, tilt logged', v: 0.1 }, { label: 'Tilt not logged or base unknown', v: 0.3 }] },
      def: { v: 0.2 },
      src: ['judge'],
      info: { what: 'Tilt or movement of the unit changes the measured horizontal speed.', drives: 'Base stability, levelling, tilt logging.', reduce: 'Install on a stable base and log tilt.', values: 'Small in practice. Framework judgement.' },
    },
    {
      id: 'lid_flow', stage: 'measurement', device: 'lidar', cat: 'measurement', sub: 'wind_speed_measurement', domain: 'ws',
      name: 'Terrain-induced flow across the scan', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Flat or simple terrain', v: 0.5 },
        { label: 'Moderate terrain, not corrected', v: 2.0 },
        { label: 'Moderate terrain, CFD-corrected', v: 1.0 },
        { label: 'Complex terrain, not corrected', v: 4.0 },
        { label: 'Complex terrain, CFD-corrected', v: 1.5 } ] },
      def: { v: 2.0 },
      src: ['dnvrsd', 'judge'],
      info: { what: 'A lidar reconstructs wind speed from beams pointing in different directions. If the flow is not the same across the scan, the reconstructed speed is biased.', drives: 'Terrain slope and curvature around the unit, measurement height.', reduce: 'Correct with a CFD flow model and, in complex terrain, verify the correction against a nearby mast.', values: 'DNV found directional correction factors within about 1 % in simple terrain and up to about 9 % in complex terrain before correction. CFD correction roughly halved the scatter against masts.' },
    },
    {
      id: 'lid_avail', stage: 'measurement', device: 'lidar', cat: 'measurement', sub: 'data_integrity', domain: 'ws',
      name: 'Data availability and filtering', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Availability above 90 % at the heights used', v: 0.3 },
        { label: 'Availability 80–90 %', v: 0.7 },
        { label: 'Availability below 80 %', v: 1.5 } ] },
      def: { v: 0.7 },
      src: ['judge'],
      info: { what: 'Lidars lose data in fog, heavy rain or very clean air. If those periods have different winds, the remaining data are biased.', drives: 'Climate, aerosol levels, height, filtering thresholds.', reduce: 'Check that data loss is not concentrated in particular seasons or wind conditions, and fill gaps from a co-located mast.', values: 'Framework judgement.' },
    },

    /* ---------------- Measurement: stage level ---------------- */
    {
      id: 'dir_meas', stage: 'measurement', cat: 'measurement', sub: 'wind_direction_measurement', domain: 'en', when: onsite,
      name: 'Wind direction measurement', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'Vane or lidar orientation verified', v: 0.2 },
        { label: 'Orientation not verified', v: 0.5 },
        { label: 'Orientation doubtful or large offset found', v: 1.0 } ] },
      def: { v: 0.3 },
      src: ['iecdef', 'judge'],
      info: { what: 'Direction errors shift the wind rose, which changes wake and flow-model results. Expressed directly as energy.', drives: 'Vane offset, magnetic declination, lidar heading.', reduce: 'Survey the vane or lidar heading at installation and check against reanalysis directions.', values: 'Framework judgement.' },
    },
    {
      id: 'atmos', stage: 'measurement', cat: 'measurement', sub: 'other_atmospheric_parameters', domain: 'en',
      name: 'Air density and other parameters', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Measured temperature and pressure on site', v: 0.2 },
        { label: 'Estimated from elevation and regional temperature', v: 0.5 } ] },
      def: { v: 0.5 },
      src: ['iecdef', 'judge'],
      info: { what: 'Power below rated scales with air density. An error in density shifts energy, mostly at low wind speeds.', drives: 'Whether temperature and pressure were measured, and how far the turbines are above the measurement.', reduce: 'Measure temperature and pressure at the mast.', values: 'Framework judgement.' },
    },
    {
      id: 'atlas', stage: 'measurement', cat: 'virtual_data', sub: 'other', domain: 'ws', when: ctx => ctx.desktop,
      name: 'Wind atlas or mesoscale estimate', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'Global Wind Atlas or mesoscale data only', v: 10.5 },
        { label: 'Mesoscale data checked against nearby masts', v: 6.0 } ] },
      def: { v: 10.5 },
      src: ['rina', 'judge'],
      info: { what: 'Without on-site measurement the wind speed comes from a model. Its error against reality replaces the measurement, long-term and extrapolation stages.', drives: 'Terrain complexity, model resolution, and how many measurements the model was validated against nearby.', reduce: 'Install a mast or lidar. Even a short campaign removes most of this term.', values: 'Against 50 masts, Global Wind Atlas wind speeds scattered by about 10.5 % (one standard deviation) and were on average 8.5 % too high. Treat desktop P50s with caution.' },
    },

    /* ---------------- Long-term ---------------- */
    {
      id: 'mcp', stage: 'historical', cat: 'historical_wind_resource', sub: 'long_term_adjustment', domain: 'ws', when: onsite,
      name: 'Long-term correction (MCP)', defaultMode: 'calc',
      calc: { fields: [
          { key: 'method', label: 'Method', type: 'select', def: 'mcp', options: [['mcp', 'Corrected with reference data (MCP)'], ['none', 'No long-term correction']] },
          { key: 'r', label: 'Correlation coefficient r with the reference', unit: '', def: 0.8, step: 0.01 },
          { key: 'nR', label: 'Length of the reference record', unit: 'years', def: 20, step: 1 },
          { key: 'nT', label: 'Concurrent (overlap) period', unit: 'years', def: 1, step: 0.25 } ],
        fn: (x, ctx) => mcp(ctx.sigmaA, x.method === 'none' ? 0 : Math.min(0.99, Math.max(0, x.r)), x.nR, x.nT),
        note: 'σ = σA × √(r²/N_R + (1 − r²)/N_T), σA from Future variability' },
      desc: { def: 1, options: [
        { label: 'Strong reference (r ≈ 0.85), 20 years, 1 year overlap', v: ctx => mcp(ctx.sigmaA, 0.85, 20, 1) },
        { label: 'Moderate reference (r ≈ 0.7), 15 years, 1 year overlap', v: ctx => mcp(ctx.sigmaA, 0.7, 15, 1) },
        { label: 'Weak reference (r ≈ 0.5) or less than a year of overlap', v: ctx => mcp(ctx.sigmaA, 0.5, 15, 0.75) } ] },
      def: { v: 2.5 },
      src: ['aws', 'vamk'],
      info: { what: 'A one- or two-year measurement is corrected to the long term using a reference dataset (reanalysis or a long-running station). The correction is only as good as the correlation and the overlap.', drives: 'Correlation with the reference, length of overlap, length of the reference record.', reduce: 'Measure longer (two full years if possible) and choose the reference with the best correlation.', values: 'The formula is from the AWS Truepower compilation, which gives 1.6–2.8 % for typical cases. The default 2.5 % sits inside that range and near the 2.3 % average of published assessments.' },
    },
    {
      id: 'ref_consistency', stage: 'historical', cat: 'historical_wind_resource', sub: 'reference_data_consistency', domain: 'ws', when: onsite,
      name: 'Reference data consistency', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'Reanalysis (ERA5, MERRA-2) checked, no trend', v: 1.0 },
        { label: 'Some inconsistency or a corrected trend', v: 2.0 },
        { label: 'Single nearby station with unknown history', v: 3.0 } ] },
      def: { v: 2.0 },
      src: ['iecdef', 'judge'],
      info: { what: 'Reference datasets can drift because of model changes, new instruments or changes around a station. A drifting reference distorts the long-term correction.', drives: 'Type of reference, documented changes, trend tests.', reduce: 'Compare two or more independent references and test for trends.', values: 'Framework judgement. IEC 61400-15-2 lists this as its own subcategory.' },
    },
    {
      id: 'lt_period', stage: 'historical', cat: 'historical_wind_resource', sub: 'long_term_period_representativeness', domain: 'ws', when: onsite,
      name: 'Representativeness of the long-term period', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Reference 20 years or longer, stable', v: 0.5 },
        { label: 'Reference 10–20 years', v: 1.0 },
        { label: 'Under 10 years, or a regime shift is visible', v: 2.0 } ] },
      def: { v: 1.0 },
      src: ['iecdef', 'judge'],
      info: { what: 'Whether the chosen reference period stands for the future wind climate, beyond the sampling already counted in the MCP term.', drives: 'Length of the reference period, trends and step changes.', reduce: 'Use the longest consistent reference period and check sensitivity to its start year.', values: 'Framework judgement. The MCP formula already covers sampling of the reference mean, so this term is kept small to avoid counting it twice.' },
    },
    {
      id: 'ws_dist', stage: 'historical', cat: 'historical_wind_resource', sub: 'wind_speed_distribution_uncertainty', domain: 'ws', when: onsite,
      name: 'Wind speed distribution', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'Measured time series or distribution used directly', v: 0.3 },
        { label: 'Fitted Weibull distribution', v: 1.0 } ] },
      def: { v: 0.5 },
      src: ['iecdef', 'judge'],
      info: { what: 'The shape of the frequency distribution matters as much as the mean. A fitted curve may not match the measured shape.', drives: 'Whether a fitted Weibull or the measured distribution is used.', reduce: 'Use the measured, long-term-corrected time series in the energy calculation.', values: 'Framework judgement, expressed as equivalent wind speed as IEC 61400-15-2 does.' },
    },
    {
      id: 'synthesis', stage: 'historical', cat: 'historical_wind_resource', sub: 'on_site_data_synthesis', domain: 'ws', when: onsite,
      name: 'Gap filling (on-site data synthesis)', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'Less than 5 % of the record gap-filled', v: 0.2 },
        { label: '5–20 % gap-filled', v: 0.6 },
        { label: 'More than 20 % gap-filled', v: 1.2 } ] },
      def: { v: 0.5 },
      src: ['iecdef', 'judge'],
      info: { what: 'Missing periods filled from other sensors or the reference add uncertainty in proportion to how much is filled.', drives: 'Share of the record filled and the quality of the filling source.', reduce: 'Keep redundant sensors at several heights so gaps can be filled from the same mast.', values: 'Framework judgement.' },
    },

    /* ---------------- Vertical ---------------- */
    {
      id: 'vert_model', stage: 'vertical', cat: 'vertical_extrapolation', sub: 'vertical_model_uncertainty', domain: 'ws', when: onsite,
      name: 'Shear model', defaultMode: 'calc',
      calc: { fields: [], fn: (x, ctx) => vz(ctx) * (SHEAR_F[(ctx.vertical || {}).shear] || 0.15) * (+(ctx.vertical || {}).alpha || 0.2) * 100,
        note: 'σ = ln(hub/measurement height) × σα, σα = 10–20 % of the measured shear exponent' },
      def: { v: ctx => vz(ctx) * 0.15 * 0.2 * 100 },
      src: ['aws', 'lee'],
      info: { what: 'Wind speed changes with height. Extrapolating from the measurement height to hub height relies on a shear model whose exponent is itself uncertain.', drives: 'Height gap, shear exponent, terrain and forest, atmospheric stability.', reduce: 'Measure at or near hub height, for example with a lidar, or use a taller mast.', values: 'The AWS Truepower compilation puts the shear exponent uncertainty at about 10–20 % of the observed shear. Lee & Fields note the common "1 % per 10 m" rule can overstate this outside forests.' },
    },
    {
      id: 'vert_prop', stage: 'vertical', cat: 'vertical_extrapolation', sub: 'excess_propagated_uncertainty', domain: 'ws', when: onsite,
      name: 'Measurement errors carried up by the shear', defaultMode: 'calc',
      calc: { fields: [{ key: 'u', label: 'Uncorrelated measurement uncertainty between the two heights', unit: '%', def: 0.5, step: 0.05 }],
        fn: (x, ctx) => { const v = ctx.vertical || {}; const hm = +v.hMeas || ctx.hub, hl = +v.hLow || hm * 0.6; const d = vz(ctx); return d > 0 && hl < hm ? d / Math.abs(ln(hm / hl)) * Math.SQRT2 * x.u : 0; },
        note: 'σ = ln(hub/h_top) ÷ ln(h_top/h_low) × √2 × u' },
      def: { v: ctx => { const v = ctx.vertical || {}; const hm = +v.hMeas || ctx.hub, hl = +v.hLow || hm * 0.6; const d = vz(ctx); return d > 0 && hl < hm ? d / Math.abs(ln(hm / hl)) * Math.SQRT2 * 0.7 : 0; } },
      src: ['aws', 'judge'],
      info: { what: 'The shear exponent is derived from two measurement heights. Independent errors at those heights change the exponent and are amplified when extrapolating above the top sensor.', drives: 'Separation between the two heights, height gap to hub, sensor quality.', reduce: 'Spread measurement heights widely and use individually calibrated sensors at both.', values: 'The AWS Truepower compilation says the speed-ratio uncertainty is about √2 times the single-height uncertainty.' },
    },
    {
      id: 'vert_repr', stage: 'vertical', cat: 'vertical_extrapolation', sub: 'measured_data_representativeness', domain: 'ws', when: onsite,
      name: 'Shear representativeness across the site', defaultMode: 'calc',
      calc: { fields: [{ key: 'g', label: 'Terrain and roughness variation across the turbine area', type: 'select', def: '0.10', options: [['0.05', 'Uniform'], ['0.10', 'Mixed'], ['0.15', 'Heterogeneous (forest edges, ridges)']] }],
        fn: (x, ctx) => vz(ctx) * (+(ctx.vertical || {}).alpha || 0.2) * (+x.g) * 100,
        note: 'σ = ln(hub/measurement height) × α × g' },
      def: { v: ctx => vz(ctx) * 0.2 * 0.10 * 100 },
      src: ['iecdef', 'judge'],
      info: { what: 'The shear measured at the mast may not hold at every turbine.', drives: 'Differences in roughness, forest and slope between the mast and the turbines.', reduce: 'Measure shear at more than one location, for example with a mobile lidar.', values: 'Framework judgement, scaled with the extrapolation distance so it disappears when you measure at hub height.' },
    },

    /* ---------------- Horizontal ---------------- */
    {
      id: 'horiz_approp', stage: 'horizontal', cat: 'horizontal_extrapolation', sub: 'horizontal_model_appropriateness', domain: 'ws', when: onsite,
      name: 'Flow model suitability', defaultMode: 'desc',
      calc: { fields: [
          { key: 'rmse', label: 'Cross-prediction error between measurement locations (RMSE)', unit: '%', def: 4, step: 0.1 },
          { key: 'n', label: 'Number of measurement locations', unit: '', def: 3, step: 1 } ],
        fn: x => x.rmse / Math.sqrt(Math.max(1, Math.round(x.n))), note: 'σ = RMSE ÷ √N (needs two or more locations)' },
      desc: { fields: [
          { key: 'model', label: 'Flow model', type: 'select', def: 'linear', options: [['linear', 'Linear (e.g. WAsP)'], ['cfd', 'CFD (RANS or LES)'], ['meso', 'Mesoscale-coupled']] },
          { key: 'dist', label: 'Typical distance from a turbine to its nearest measurement', type: 'select', def: '5', options: [['2', 'Within 2 km'], ['5', '2–5 km'], ['10', '5–10 km'], ['20', 'Over 10 km']] } ],
        options: [{ label: 'Estimate from terrain, flow model, distance and number of measurement locations', v: (ctx, f) => {
          const base = { flat: 1.5, simple: 2.0, moderate: 4.0, complex: 7.0, vcomplex: 10.0 }[ctx.terrain] || 4.0;
          const hard = ['moderate', 'complex', 'vcomplex'].includes(ctx.terrain);
          const mf = f.model === 'cfd' ? (hard ? 0.85 : 1.0) : f.model === 'meso' ? (hard ? 0.9 : 1.0) : (hard ? 1.2 : 1.0);
          const df = { '2': 1.0, '5': 1.25, '10': 1.5, '20': 2.0 }[String(f.dist)] || 1.25;
          const nf = 1 / Math.sqrt(1 + 0.5 * (Math.min(4, ctx.nMeasLocations) - 1));
          return base * mf * df * nf; } }] },
      def: { v: 4.0 },
      src: ['aws', 'judge'],
      info: { what: 'The flow model predicts how wind speed changes from the measurement to each turbine. How well it does that depends on the terrain and the model.', drives: 'Terrain complexity, flow model type, distance to the nearest measurement, number of measurements.', reduce: 'Add measurement locations near the turbines that are hardest to model, and use CFD in moderate or complex terrain.', values: 'The AWS Truepower compilation gives about 2 % in simple terrain, 3–6 % typically and 10 % or more in complex terrain. The adjustments for model, distance and number of masts are framework judgement.' },
    },
    {
      id: 'horiz_inputs', stage: 'horizontal', cat: 'horizontal_extrapolation', sub: 'horizontal_model_inputs', domain: 'ws', when: onsite,
      name: 'Terrain and roughness inputs', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'High-resolution terrain (30 m or better) and verified roughness', v: 0.5 },
        { label: 'Standard global datasets (SRTM, land cover)', v: 1.0 },
        { label: 'Coarse or unverified data, or changing land use', v: 2.0 } ] },
      def: { v: 1.0 },
      src: ['iecdef', 'judge'],
      info: { what: 'The flow model is only as good as its elevation and roughness maps.', drives: 'Resolution and age of the maps, local verification.', reduce: 'Use local survey or lidar-derived elevation and check roughness on a site visit.', values: 'Framework judgement.' },
    },
    {
      id: 'horiz_sens', stage: 'horizontal', cat: 'horizontal_extrapolation', sub: 'horizontal_model_sensitivity', domain: 'ws', when: onsite,
      name: 'Model setting sensitivity', defaultMode: 'desc',
      desc: { def: 1, options: [{ label: 'Sensitivity tests done, results stable', v: 0.5 }, { label: 'Not tested', v: 1.0 }] },
      def: { v: 1.0 },
      src: ['iecdef', 'judge'],
      info: { what: 'Results can change with grid resolution, stability settings or the choice of mast used to drive the model.', drives: 'Model settings and how many were tested.', reduce: 'Run the model with alternative settings and driving masts and report the spread.', values: 'Framework judgement.' },
    },

    /* ---------------- Future ---------------- */
    {
      id: 'ws_iav', stage: 'future', cat: 'future_assessment_period_variability', sub: 'wind_speed_variability', domain: 'ws', time: 'annual', reducible: false,
      name: 'Interannual variability of wind speed', defaultMode: 'default',
      entered: { label: 'Year-to-year standard deviation of the annual mean wind speed (σA), from your long-term reference', unit: '%' },
      def: { v: 4.0 },
      note: 'Divided by √N for an N-year period. The long-term correction (MCP) uses the same σA.',
      src: ['aws'],
      info: { what: 'Some years are windier than others. Over a single year this matters a lot; over ten years it largely averages out.', drives: 'Regional climate. Monsoon and trade-wind regimes differ from mid-latitude storm tracks.', reduce: 'This is natural variation and cannot be reduced, only estimated well from a long reference record.', values: 'Historical records suggest 3–5 % for annual mean wind speed; 4 % is a common assumption.' },
    },
    {
      id: 'climate_change', stage: 'future', cat: 'future_assessment_period_variability', sub: 'climate_change', domain: 'ws', time: 'horizon', reducible: false,
      name: 'Climate change', defaultMode: 'default',
      def: { v: 0.5 },
      src: ['aws'],
      info: { what: 'The future climate may differ from the historical record used.', drives: 'Length of the evaluation period, regional climate projections.', reduce: 'Cannot be reduced. Check regional studies of projected wind change.', values: 'The AWS Truepower compilation uses 0.5 % for a 10-year period, rising to 2 % for 20–25 years. The default follows that scaling; an entered value is used for every period.' },
    },

    /* ---------------- Conversion ---------------- */
    {
      id: 'pc_unc', stage: 'conversion', cat: 'turbine_performance', sub: 'other', domain: 'en',
      name: 'Power curve', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Measured power curve for this model (IEC 61400-12-1 tests)', v: 2.0 },
        { label: 'Warranted power curve, mature model', v: 2.5 },
        { label: 'Calculated curve, new or prototype model', v: 3.5 },
        { label: 'Generic curve, no manufacturer data', v: 5.0 } ] },
      def: { v: 3.0 },
      src: ['kema', 'lee', 'judge'],
      info: { what: 'Whether the turbine will deliver its stated power curve on your site.', drives: 'Maturity of the model, whether measured tests exist, how much the warranted curve has been verified.', reduce: 'Ask for independent power performance test reports for the exact model and rotor, and negotiate a power curve warranty.', values: 'A single power performance test carries 3–5 % uncertainty in flat terrain and 4–8 % in complex terrain. Lee & Fields note power curve uncertainty sits outside the IEC category list. The values here are framework judgement.' },
    },

    /* ---------------- Losses ---------------- */
    {
      id: 'wake_int', stage: 'losses', cat: 'turbine_interaction', sub: 'internal_turbine_interaction', domain: 'loss',
      name: 'Internal wakes', defaultMode: 'desc',
      calc: { fields: [{ key: 'L', label: 'Wake loss from your wake model', unit: '%', def: 8, step: 0.1 }, { key: 'f', label: 'Uncertainty as a share of the loss', unit: '%', def: 20, step: 1 }], fn: x => frac(x.L, x.f / 100), note: 's = loss × share' },
      desc: { def: 1, options: [
        { label: 'Single row or wide spacing (over 7 rotor diameters)', v: frac(4, 0.2) },
        { label: 'Typical array', v: frac(8, 0.2) },
        { label: 'Dense, several rows (under 5 rotor diameters)', v: frac(13, 0.2) } ] },
      def: { v: frac(8, 0.2) },
      src: ['vaisala', 'vamk'],
      info: { what: 'Turbines slow the wind for those behind them. Often the largest single loss.', drives: 'Spacing, number of rows, wind direction distribution, turbulence, wake model.', reduce: 'Use a wake model validated on operating plants in similar conditions and test alternative models.', values: 'Vaisala found a scatter of about 16 % of the wake loss after bias removal and uses 20 %. Consultants typically assume 20–30 %. Vaisala also found operating wakes about 21 % larger than modelled; see Results.' },
    },
    {
      id: 'wake_ext', stage: 'losses', cat: 'turbine_interaction', sub: 'external_turbine_interaction', domain: 'loss',
      name: 'Wakes from neighbouring plants', defaultMode: 'desc',
      calc: { fields: [{ key: 'L', label: 'External wake loss from your wake model', unit: '%', def: 1.5, step: 0.1 }, { key: 'f', label: 'Uncertainty as a share of the loss', unit: '%', def: 25, step: 1 }], fn: x => frac(x.L, x.f / 100), note: 's = loss × share' },
      desc: { def: 0, options: [
        { label: 'No operating neighbours within about 20 rotor diameters', v: { L: 0, s: 0.2 } },
        { label: 'Operating neighbours nearby', v: { L: 2.0, s: 0.6 } },
        { label: 'Large plant directly upwind', v: { L: 5.0, s: 1.5 } } ] },
      def: { v: { L: 1.0, s: 0.5 } },
      src: ['vaisala', 'judge'],
      info: { what: 'Losses caused by other operating wind farms.', drives: 'Distance and direction to neighbours, their size.', reduce: 'Model neighbours explicitly with their layouts and turbine types.', values: 'Framework judgement, with uncertainty slightly above the internal-wake share because neighbour data are less certain.' },
    },
    {
      id: 'wake_fut', stage: 'losses', cat: 'turbine_interaction', sub: 'future_turbine_interaction', domain: 'loss',
      name: 'Wakes from future plants', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'No further development possible nearby', v: { L: 0, s: 0 } },
        { label: 'Future neighbours possible', v: { L: 0.5, s: 0.5 } },
        { label: 'Known project planned upwind', v: { L: 2.0, s: 1.5 } } ] },
      def: { v: { L: 0.5, s: 0.5 } },
      src: ['judge'],
      info: { what: 'Plants built later can wake yours.', drives: 'Land availability, permitting pipeline, transmission plans in the area.', reduce: 'Check the planning pipeline and secure land or wake agreements upwind.', values: 'Framework judgement.' },
    },
    {
      id: 'blockage', stage: 'losses', cat: 'turbine_interaction', sub: 'internal_turbine_interaction', domain: 'loss',
      name: 'Blockage (induction slowdown upstream)', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Small plant (under 10 turbines)', v: { L: 0.5, s: 0.5 } },
        { label: 'Medium plant (10–50 turbines)', v: { L: 1.5, s: 1.0 } },
        { label: 'Large or dense plant (over 50 turbines)', v: { L: 2.5, s: 1.5 } } ] },
      def: { v: { L: 1.5, s: 1.0 } },
      src: ['lee', 'judge'],
      info: { what: 'A wind farm slows the wind slightly before it reaches the front row. Many older assessments ignored it.', drives: 'Plant size and density, atmospheric stability.', reduce: 'Model blockage explicitly and check whether your wake model already includes it.', values: 'Lee & Fields report blockage below 5 % of AEP. The values here are framework judgement.' },
    },
    {
      id: 'av_wtg', stage: 'losses', cat: 'availability', sub: 'turbine_availability', domain: 'loss', dist: 'weibull', hasIav: true,
      name: 'Turbine availability', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Mature manufacturer, availability warranty 97 % or higher', v: { L: 2.5, s: 0.8, iav: 1.0 } },
        { label: 'Standard warranty 95–97 %', v: { L: 3.5, s: 1.2, iav: 1.0 } },
        { label: 'New model, weak O&M or remote site', v: { L: 5.0, s: 2.0, iav: 1.5 } } ] },
      def: { v: { L: 3.0, s: 1.0, iav: 1.0 } },
      src: ['vamk', 'dnvmc', 'judge'],
      info: { what: 'Energy lost while turbines are stopped for faults and maintenance.', drives: 'Manufacturer track record, warranty terms, spare parts, crane access, O&M contract.', reduce: 'Negotiate an energy-based availability warranty and check the manufacturer\'s fleet data.', values: 'Published assessments average about 4.4 % (range 0.3–11 %). Monte Carlo uses a skewed (Weibull) distribution for availability, because a few projects underperform badly.' },
    },
    {
      id: 'av_bop', stage: 'losses', cat: 'availability', sub: 'bop_availability', domain: 'loss', dist: 'weibull',
      name: 'Balance of plant availability', defaultMode: 'default',
      def: { v: { L: 0.5, s: 0.3 } },
      src: ['judge'],
      info: { what: 'Losses when the collector system, substation or transformers are down.', drives: 'Redundancy in the electrical design, maintenance of the substation.', reduce: 'Design redundancy into the collector system and keep critical spares.', values: 'Framework judgement.' },
    },
    {
      id: 'av_grid', tech: 'both', stage: 'losses', cat: 'availability', sub: 'grid_availability', domain: 'loss', dist: 'weibull', hasIav: true,
      name: 'Grid availability', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Strong grid, dedicated substation', v: { L: 0.3, s: 0.3, iav: 0.3 } },
        { label: 'Shared pooling substation', v: { L: 1.0, s: 0.7, iav: 0.5 } },
        { label: 'Weak grid with frequent outages', v: { L: 2.5, s: 1.5, iav: 1.0 } } ] },
      def: { v: { L: 0.5, s: 0.5, iav: 0.5 } },
      src: ['judge'],
      info: { what: 'Energy lost when the external grid is unavailable.', drives: 'Grid strength, outage history of the connecting substation and line.', reduce: 'Collect outage records for the connecting substation.', values: 'Framework judgement.' },
    },
    {
      id: 'el_eff', stage: 'losses', cat: 'electrical', sub: 'electrical_efficiency', domain: 'loss',
      name: 'Collector system and transformers', defaultMode: 'default',
      calc: { fields: [{ key: 'L', label: 'Loss from your electrical study', unit: '%', def: 2.0, step: 0.1 }], fn: x => ({ L: x.L, s: Math.max(0.2, 0.15 * x.L) }), note: 's = 15 % of the loss, at least 0.2 points' },
      def: { v: { L: 2.0, s: 0.5 } },
      src: ['lee', 'vamk', 'judge'],
      info: { what: 'Losses in turbine transformers, cables and the substation transformer.', drives: 'Cable lengths and sizes, transformer ratings, loading.', reduce: 'Run a load-flow loss study on the final layout.', values: 'Lee & Fields find electrical losses low in magnitude and high in certainty; published values average about 1.3 %.' },
    },
    {
      id: 'el_export', tech: 'both', stage: 'losses', cat: 'electrical', sub: 'electrical_efficiency', domain: 'loss',
      name: 'Export line to the POI', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Short line (under 10 km) or metering at the plant substation', v: { L: 0.3, s: 0.1 } },
        { label: 'Line of 10–50 km', v: { L: 1.0, s: 0.3 } },
        { label: 'Line over 50 km', v: { L: 2.0, s: 0.5 } } ] },
      def: { v: { L: 0.8, s: 0.3 } },
      src: ['judge'],
      info: { what: 'Losses between the plant substation and the point of interconnection where energy is metered.', drives: 'Line length, voltage, conductor size, loading.', reduce: 'Calculate losses for the actual line and loading profile.', values: 'Framework judgement.' },
    },
    {
      id: 'el_parasitic', stage: 'losses', cat: 'electrical', sub: 'facility_parasitic_consumption', domain: 'loss',
      name: 'Plant self-consumption', defaultMode: 'default',
      def: { v: { L: 0.2, s: 0.1 } },
      src: ['judge'],
      info: { what: 'Power used by the plant itself (heating, lights, control) when it is netted from exports.', drives: 'Climate, auxiliary loads, metering arrangement.', reduce: 'Check how auxiliary consumption is metered and billed.', values: 'Framework judgement.' },
    },
    {
      id: 'tp_subopt', stage: 'losses', cat: 'turbine_performance', sub: 'sub_optimal_performance', domain: 'loss',
      name: 'Sub-optimal operation', defaultMode: 'default',
      def: { v: { L: 1.0, s: 0.7 } },
      src: ['judge'],
      info: { what: 'Yaw misalignment, control settings and other deviations from optimal operation.', drives: 'Commissioning quality, monitoring, nacelle anemometer calibration.', reduce: 'Monitor performance from the start and correct yaw misalignment early.', values: 'Framework judgement.' },
    },
    {
      id: 'tp_site_pc', stage: 'losses', cat: 'turbine_performance', sub: 'site_specific_power_curve_adjustment', domain: 'loss',
      name: 'Site effects on the power curve', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Low turbulence and shear, simple terrain', v: { L: 0.5, s: 0.5 } },
        { label: 'Moderate conditions', v: { L: 1.0, s: 1.0 } },
        { label: 'High turbulence or complex inflow', v: { L: 2.5, s: 1.5 } } ] },
      def: { v: { L: 1.0, s: 1.0 } },
      src: ['iecdef', 'judge'],
      info: { what: 'Turbulence, shear, veer and inflow angle on your site change the power curve compared with test conditions.', drives: 'Turbulence intensity, shear, terrain slope.', reduce: 'Apply a power curve adjustment method (for example turbulence normalisation) with your measured conditions.', values: 'Framework judgement.' },
    },
    {
      id: 'tp_hyst', stage: 'losses', cat: 'turbine_performance', sub: 'high_wind_hysteresis', domain: 'loss',
      name: 'High-wind shutdown and restart', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'Wind speeds above 20 m/s are rare', v: { L: 0.1, s: 0.05 } },
        { label: 'Frequent storms or cyclones', v: { L: 0.8, s: 0.4 } } ] },
      def: { v: { L: 0.2, s: 0.1 } },
      src: ['judge'],
      info: { what: 'Energy lost while turbines wait to restart after a high-wind shutdown.', drives: 'Frequency of very high winds, cut-out and restart settings.', reduce: 'Choose turbines with a soft cut-out (high-wind ride-through).', values: 'Framework judgement.' },
    },
    {
      id: 'env_icing', stage: 'losses', cat: 'environmental', sub: 'icing', domain: 'loss',
      name: 'Icing', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'No icing climate', v: { L: 0, s: 0 } },
        { label: 'Light icing', v: { L: 1.0, s: 1.0 } },
        { label: 'Moderate or severe icing', v: { L: 4.0, s: 3.0 } } ] },
      def: { v: { L: 0, s: 0 } },
      src: ['lee', 'judge'],
      info: { what: 'Ice on blades lowers output or stops turbines.', drives: 'Temperature, humidity, elevation.', reduce: 'Measure icing with heated and unheated sensors, and consider blade heating.', values: 'Lee & Fields find wide ranges for icing losses. Framework judgement.' },
    },
    {
      id: 'env_degr', stage: 'losses', cat: 'environmental', sub: 'degradation', domain: 'loss',
      name: 'Blade degradation (lifetime average)', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Leading-edge protection, low erosion', v: { L: 0.5, s: 0.4 } },
        { label: 'Typical conditions', v: { L: 0.8, s: 0.6 } },
        { label: 'High erosion (dust, heavy rain, insects)', v: { L: 1.5, s: 1.0 } } ] },
      def: { v: { L: 0.8, s: 0.6 } },
      src: ['lee', 'judge'],
      info: { what: 'Leading-edge erosion and soiling reduce blade performance over the years.', drives: 'Rain, dust, insects, tip speed, maintenance.', reduce: 'Specify leading-edge protection and inspect blades regularly.', values: 'Lee & Fields find wide ranges for degradation. Framework judgement for the lifetime average.' },
    },
    {
      id: 'env_ext', stage: 'losses', cat: 'environmental', sub: 'external_conditions', domain: 'loss',
      name: 'Temperature limits and other conditions', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'Temperatures within the turbine design range', v: { L: 0.2, s: 0.2 } },
        { label: 'Frequent heat above 35 °C or extreme cold', v: { L: 0.8, s: 0.6 } } ] },
      def: { v: { L: 0.2, s: 0.2 } },
      src: ['judge'],
      info: { what: 'Turbines derate or stop outside their temperature range, and lightning or dust storms add stops.', drives: 'Temperature extremes, hot-climate packages.', reduce: 'Specify the hot- or cold-climate package suited to the site.', values: 'Framework judgement.' },
    },
    {
      id: 'env_exposure', stage: 'losses', cat: 'environmental', sub: 'exposure_changes', domain: 'loss',
      name: 'Changes around the site', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'No change expected', v: { L: 0, s: 0.2 } },
        { label: 'Tree growth or new buildings possible', v: { L: 0.5, s: 0.5 } } ] },
      def: { v: { L: 0.2, s: 0.3 } },
      src: ['judge'],
      info: { what: 'Growing forests or new buildings raise roughness and lower wind speed over time.', drives: 'Forestry plans, land use.', reduce: 'Model future forest heights and check land use plans.', values: 'Framework judgement.' },
    },
    {
      id: 'cur_load', stage: 'losses', cat: 'curtailment', sub: 'load_curtailment', domain: 'loss',
      name: 'Sector management (loads)', defaultMode: 'default',
      calc: { fields: [{ key: 'L', label: 'Loss from the manufacturer\'s sector management', unit: '%', def: 0.5, step: 0.1 }], fn: x => ({ L: x.L, s: Math.max(0.1, 0.3 * x.L) }), note: 's = 30 % of the loss, at least 0.1 points' },
      def: { v: { L: 0.3, s: 0.2 } },
      src: ['judge'],
      info: { what: 'Turbines stopped or slowed in certain directions to limit loads when spacing is tight.', drives: 'Spacing, turbulence, manufacturer requirements.', reduce: 'Get the manufacturer\'s sector management strategy and model it in the time series.', values: 'Framework judgement.' },
    },
    {
      id: 'cur_grid', tech: 'both', stage: 'losses', cat: 'curtailment', sub: 'grid_curtailment', domain: 'loss', hasIav: true,
      name: 'Grid curtailment', defaultMode: 'desc',
      desc: { def: 0, options: [
        { label: 'Must-run contract, little curtailment expected', v: { L: 0.5, s: 0.5, iav: 0.3 } },
        { label: 'Moderate regional curtailment (history 1–5 %)', v: { L: 3.0, s: 2.0, iav: 1.5 } },
        { label: 'Congested corridor', v: { L: 8.0, s: 5.0, iav: 3.0 } } ] },
      def: { v: { L: 1.0, s: 1.0, iav: 0.5 } },
      src: ['lee', 'judge'],
      info: { what: 'Output reduced on instruction from the grid operator, for congestion or balancing.', drives: 'Grid congestion, contract terms, regional renewable growth, transmission build-out.', reduce: 'Collect curtailment history from nearby plants and check the transmission plan and contract compensation terms.', values: 'Lee & Fields find observed curtailment larger than estimated. Framework judgement.' },
    },
    {
      id: 'cur_env', stage: 'losses', cat: 'curtailment', sub: 'environmental_curtailment', domain: 'loss',
      name: 'Noise, wildlife and shadow curtailment', defaultMode: 'default',
      def: { v: { L: 0.2, s: 0.2 } },
      src: ['judge'],
      info: { what: 'Stops or reduced modes required by permits: noise, bats, birds, shadow flicker.', drives: 'Permit conditions, nearby homes, habitats.', reduce: 'Model the permit conditions in the time series.', values: 'Framework judgement.' },
    },
    {
      id: 'cur_ops', tech: 'both', stage: 'losses', cat: 'curtailment', sub: 'operational_strategies', domain: 'loss',
      name: 'Other operational strategies', defaultMode: 'none',
      def: { v: { L: 0, s: 0 } },
      src: ['iecdef'],
      info: { what: 'Any other planned reduction, such as reserve provision or market-driven curtailment.', drives: 'Market and contract strategy.', reduce: 'Agree the strategy in advance and model it explicitly.', values: 'Not included unless you add it.' },
    },

    /* ---------------- POI ---------------- */
    {
      id: 'poi_meter', tech: 'both', stage: 'poi', cat: 'other', sub: 'other', domain: 'en',
      name: 'Revenue metering', defaultMode: 'calc',
      calc: { fields: [
          { key: 'm', label: 'Meter accuracy class', unit: '%', def: 0.2, step: 0.1 },
          { key: 'ct', label: 'Current transformer class', unit: '%', def: 0.2, step: 0.1 },
          { key: 'vt', label: 'Voltage transformer class', unit: '%', def: 0.2, step: 0.1 } ],
        fn: x => Math.sqrt(x.m * x.m + x.ct * x.ct + x.vt * x.vt) / SQ3, note: 'σ = √(m² + ct² + vt²) ÷ √3 (class limits as rectangular bounds)' },
      def: { v: 0.2 },
      src: ['gum', 'judge'],
      info: { what: 'The meter at the POI defines the energy you are paid for. Its accuracy class is a limit, so it is treated as a rectangular distribution.', drives: 'Meter, current transformer and voltage transformer classes.', reduce: 'Use 0.2S class metering with matching transformers and check meter test certificates.', values: 'Accuracy classes treated as rectangular bounds per the GUM.' },
    },
  ];

  /* ---------------- Solar PV ---------------- */
  const S = 'solar';
  const clipL = r => (r <= 1.2 ? 0.3 : r <= 1.35 ? 1.0 : r <= 1.5 ? 2.5 : 4.0);
  const SOLAR_ITEMS = [
    {
      id: 'sat_model', tech: S, stage: 'irradiance', cat: 'irradiance_source', sub: 'satellite_model', domain: 'res', when: ctx => ctx.solarSource === 'satellite',
      name: 'Satellite irradiance model', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Commercial model with strong validation in the region', v: 3.0 },
        { label: 'Commercial model, little validation nearby, or monsoon and high-aerosol climate', v: 4.5 },
        { label: 'Free public database (PVGIS, NASA POWER or similar)', v: 6.0 } ] },
      def: { v: 4.0 },
      src: ['t13', 'sgpv', 'judge'],
      info: { what: 'Satellite models estimate irradiance from cloud images and atmospheric data. Their long-term mean at your site can be off.', drives: 'Model quality, how many ground stations validate it nearby, aerosols, monsoon clouds, snow and terrain.', reduce: 'Compare two or more datasets, and measure on site for at least 12 months to site-adapt the series.', values: 'IEA PVPS Task 13 reports 2–6 % annual error for satellite GHI in the literature and site-level bias from −5 % to +10 %; its worked example uses 4 %.' },
    },
    {
      id: 'ground_sensor', tech: S, stage: 'irradiance', cat: 'irradiance_source', sub: 'ground_measurement', domain: 'res', when: ctx => ctx.solarSource !== 'satellite',
      name: 'On-site irradiance sensors', defaultMode: 'desc',
      calc: { fields: [
          { key: 'cal', label: 'Calibration (standard uncertainty)', unit: '%', def: 1.38, step: 0.05 },
          { key: 'resp', label: 'Directional, temperature and non-linearity response', unit: '%', def: 1.2, step: 0.05 },
          { key: 'maint', label: 'Soiling, levelling and maintenance', unit: '%', def: 0.5, step: 0.05 } ],
        fn: x => Math.sqrt(x.cal * x.cal + x.resp * x.resp + x.maint * x.maint), note: 'σ = √(calibration² + response² + maintenance²)' },
      desc: { def: 0, options: [
        { label: 'Class A pyranometer, cleaned daily, calibrated on schedule', v: 1.9 },
        { label: 'Class A, cleaned weekly or calibration overdue', v: 2.5 },
        { label: 'Class B pyranometer', v: 3.0 },
        { label: 'Class C sensor or reference cells only', v: 5.0 } ] },
      def: { v: 2.5 },
      src: ['t13', 'sgadapt', 'judge'],
      info: { what: 'Pyranometers measure irradiance on site. Calibration, response to sun angle and temperature, and dirt on the dome all add uncertainty.', drives: 'Sensor class, cleaning, calibration interval, redundancy.', reduce: 'Use redundant ISO 9060 Class A pyranometers, clean them daily and keep calibration certificates current.', values: 'IEA PVPS Task 13 lists the components (calibration 1.38 % standard uncertainty, plus zenith, spectral, temperature and non-linearity terms), which combine to about 1.9 %. Solargis puts the practical floor after site adaptation at about 3 %, the uncertainty of a well-maintained Class A pyranometer.' },
    },
    {
      id: 'site_adapt', tech: S, stage: 'irradiance', cat: 'irradiance_source', sub: 'site_adaptation', domain: 'res', when: ctx => ctx.solarSource === 'adapted',
      name: 'Site adaptation of the satellite series', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: '24 months or more of quality-controlled data', v: 1.0 },
        { label: '12–23 months', v: 1.5 },
        { label: '9–11 months', v: 2.0 },
        { label: '3–8 months (not recommended)', v: 3.0 } ] },
      def: { v: 1.5 },
      src: ['sgadapt', 't13b', 'judge'],
      info: { what: 'The satellite series is corrected to match the on-site measurements. What remains is the error of that correction, on top of the sensors\' own uncertainty.', drives: 'Length and quality of the measurement, how well satellite and ground data correlate.', reduce: 'Measure for at least 12 months, ideally 24, with Class A sensors.', values: 'Solargis recommends 12 months or more (24 optimal) and does not recommend 3–6 months. IEA PVPS Task 13 finds site adaptation reduces long-term uncertainty when the correlation is strong. Values are framework judgement.' },
    },
    {
      id: 'irr_lt', tech: S, stage: 'solar_lt', cat: 'long_term_irradiance', sub: 'long_term_representativeness', domain: 'res',
      name: 'Long-term representativeness and trends', defaultMode: 'desc',
      calc: { fields: [{ key: 'n', label: 'Years in the irradiance record', unit: 'years', def: 3, step: 1 }], fn: (x, ctx) => ctx.sigmaA / Math.sqrt(Math.max(1, x.n)), note: 'σ = σA ÷ √(years of record), σA from the year-to-year variability below' },
      desc: { def: 0, options: [
        { label: 'Satellite record of 15 years or more, no trend', v: 1.0 },
        { label: 'Record under 10 years', v: 2.0 },
        { label: 'Trend visible (brightening, dimming or aerosol change)', v: 3.0 } ] },
      def: { v: 1.5 },
      src: ['t13', 't13b', 'judge'],
      info: { what: 'Irradiance can trend over decades with air pollution and climate. A record that is short or shifting may not stand for the next 25 years.', drives: 'Record length, regional aerosol trends.', reduce: 'Use the longest consistent record and check recent years separately for trends.', values: 'IEA PVPS Task 13 estimates about 3 % uncertainty from long-term trends for a 20-year GHI prediction, and reports German plane-of-array irradiance rising about 1.1 % a year over 2008–2018.' },
    },
    {
      id: 'ghi_iav', tech: S, stage: 'solar_lt', cat: 'long_term_irradiance', sub: 'interannual_variability', domain: 'res', time: 'annual', reducible: false,
      name: 'Year-to-year variability of irradiance', defaultMode: 'default',
      entered: { label: 'Year-to-year standard deviation of annual irradiation (σA)', unit: '%' },
      def: { v: 2.5 },
      note: 'Divided by √N for an N-year period.',
      src: ['sgvar'],
      info: { what: 'Annual irradiation varies with cloud and monsoon strength. It matters for a single year and averages out over many.', drives: 'Climate. Monsoon regions and mid-latitudes vary more than deserts.', reduce: 'Natural variation; it cannot be reduced, only estimated from a long record.', values: 'Solargis reports single-year GHI variability of 1.3–3.8 % at sample sites, 2.3 % at Kurnool, India.' },
    },
    {
      id: 'transposition', tech: S, stage: 'poa', cat: 'plane_of_array', sub: 'transposition_model', domain: 'res',
      name: 'Transposition to the module plane', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Fixed tilt, transposition model checked', v: 1.5 },
        { label: 'Single-axis tracker', v: 2.0 },
        { label: 'Model choice not checked', v: 2.5 } ] },
      def: { v: 2.5 },
      src: ['t13', 'sam', 'judge'],
      info: { what: 'Models split global irradiance into direct and diffuse parts and project them onto the module plane. Different models give different answers.', drives: 'Diffuse fraction, tilt or tracking, the decomposition and transposition models used.', reduce: 'Compare models (for example Perez and Hay), and measure plane-of-array irradiance on site.', values: 'IEA PVPS Task 13 uses 2.5 % in its worked example and finds Hay and Perez differ by up to about 2 % a year.' },
    },
    {
      id: 'horizon_far', tech: S, stage: 'poa', cat: 'plane_of_array', sub: 'horizon_shading', domain: 'loss',
      name: 'Horizon shading', defaultMode: 'desc',
      desc: { def: 0, options: [{ label: 'Open horizon', v: { L: 0.2, s: 0.1 } }, { label: 'Hills or tall obstacles on the horizon', v: { L: 1.5, s: 0.5 } }] },
      def: { v: { L: 0.3, s: 0.5 } },
      src: ['t13', 'judge'],
      info: { what: 'Distant terrain and objects block low sun.', drives: 'Surrounding terrain.', reduce: 'Use a measured horizon profile or a terrain model.', values: 'IEA PVPS Task 13 uses 0.5 % uncertainty for horizon shading.' },
    },
    {
      id: 'bifacial', tech: S, stage: 'poa', cat: 'plane_of_array', sub: 'rear_side_gain', domain: 'loss', when: ctx => ctx.bifacial,
      name: 'Bifacial rear-side gain', defaultMode: 'desc',
      calc: { fields: [{ key: 'g', label: 'Rear-side gain from your simulation', unit: '%', def: 6, step: 0.1 }, { key: 'u', label: 'Uncertainty as a share of the gain', unit: '%', def: 30, step: 1 }], fn: x => ({ L: -x.g, s: x.g * x.u / 100 }), note: 'Entered as a negative loss; s = gain × share' },
      desc: { def: 1, options: [
        { label: 'Fixed tilt, typical ground', v: { L: -4, s: 1.5 } },
        { label: 'Single-axis tracker, typical ground', v: { L: -6, s: 2.0 } },
        { label: 'Measured albedo (12 months) and validated rear-side model', v: { L: -6, s: 1.0 } } ] },
      def: { v: { L: -5, s: 1.5 } },
      src: ['albedo', 't13b', 'sam', 'judge'],
      info: { what: 'Bifacial modules collect light reflected from the ground onto their rear side. The gain depends heavily on ground reflectivity (albedo).', drives: 'Albedo and how it changes with season and construction, row height and spacing, tracker torque tubes.', reduce: 'Measure albedo on site for a year with recommended practice and validate the rear-side model.', values: 'Recommended albedo measurement practice keeps the albedo uncertainty component to at most about 1.5 %. IEA PVPS Task 13 advises assessing bifacial technology separately. Gain values are framework judgement; shown as a negative loss.' },
    },
    {
      id: 'shading_near', tech: S, stage: 'pvconv', cat: 'shading_optical', sub: 'row_shading', domain: 'loss',
      name: 'Row-to-row and near shading', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Wide row spacing or backtracking', v: { L: 0.5, s: 0.3 } },
        { label: 'Typical ground coverage', v: { L: 1.5, s: 0.7 } },
        { label: 'Dense rows or complex layout', v: { L: 3.0, s: 1.5 } } ] },
      def: { v: { L: 1.5, s: 1.0 } },
      src: ['t13', 'sam', 'judge'],
      info: { what: 'Rows shade each other at low sun angles; poles, buildings and trees cast near shade.', drives: 'Ground coverage ratio, terrain slope, tracker backtracking.', reduce: 'Model the 3D layout with terrain and check backtracking settings.', values: 'IEA PVPS Task 13 uses 2 % uncertainty for row shading and 3 % for object shading in its example.' },
    },
    {
      id: 'soiling', tech: S, stage: 'pvconv', cat: 'shading_optical', sub: 'soiling', domain: 'loss',
      name: 'Soiling', defaultMode: 'desc',
      calc: { fields: [{ key: 'rate', label: 'Soiling rate between cleanings', unit: '%/day', def: 0.3, step: 0.05 }, { key: 'days', label: 'Days between cleanings or effective rain', unit: 'days', def: 14, step: 1 }],
        fn: x => { const L = Math.min(15, x.rate * x.days / 2); return { L, s: Math.max(0.3, 0.4 * L) }; }, note: 'Average loss = rate × interval ÷ 2; s = 40 % of the loss' },
      desc: { def: 1, options: [
        { label: 'Frequent cleaning or regular rain', v: { L: 1.0, s: 0.5 } },
        { label: 'Moderate dust, cleaning every two weeks', v: { L: 2.5, s: 1.0 } },
        { label: 'Heavy dust, monthly cleaning or less', v: { L: 5.0, s: 2.0 } } ] },
      def: { v: { L: 2.0, s: 1.0 } },
      src: ['rwsoil', 't13b', 'sam', 'judge'],
      info: { what: 'Dust on the modules blocks light. Losses build up between cleanings and rain.', drives: 'Local dust, dry season length, cleaning schedule, tilt.', reduce: 'Measure soiling on site with a soiling station and set the cleaning schedule from it.', values: 'A Delhi field study found 0.3–0.6 % lost per day on uncleaned panels. IEA PVPS Task 13 names soiling as one of the main sources of disagreement between assessors.' },
    },
    {
      id: 'iam', tech: S, stage: 'pvconv', cat: 'shading_optical', sub: 'reflection', domain: 'loss',
      name: 'Reflection (angle of incidence)', defaultMode: 'default',
      def: { v: { L: 2.5, s: 0.5 } },
      src: ['t13'],
      info: { what: 'Light hitting the glass at a steep angle is partly reflected.', drives: 'Glass coating, tilt and tracking.', reduce: 'Use measured angle-of-incidence curves for the module.', values: 'The IEA PVPS Task 13 example has a reflection loss of 2.7 % with an uncertainty of 0–0.5 %.' },
    },
    {
      id: 'spectral', tech: S, stage: 'pvconv', cat: 'shading_optical', sub: 'spectral', domain: 'loss',
      name: 'Spectral effects', defaultMode: 'default',
      def: { v: { L: 1.0, s: 0.7 } },
      src: ['t13', 'sam', 'judge'],
      info: { what: 'The sunlight spectrum differs from the test spectrum, especially in humid or hazy air.', drives: 'Humidity, aerosols, cell technology.', reduce: 'Use spectral corrections suited to the climate and cell technology.', values: 'NREL\'s SAM method gives spectral response a triangular range of −5.7 to 0 % (mode −2.7 %). Framework judgement for the default.' },
    },
    {
      id: 'low_light', tech: S, stage: 'pvconv', cat: 'shading_optical', sub: 'irradiance_level', domain: 'loss',
      name: 'Low-irradiance performance', defaultMode: 'default',
      def: { v: { L: 1.0, s: 0.8 } },
      src: ['t13'],
      info: { what: 'Module efficiency changes at low light levels.', drives: 'Module technology, how often the sky is cloudy.', reduce: 'Use measured low-light efficiency data for the module.', values: 'IEA PVPS Task 13 uses 0.8 % uncertainty for irradiance-dependent losses.' },
    },
    {
      id: 'temperature', tech: S, stage: 'pvconv', cat: 'thermal', sub: 'temperature_loss', domain: 'loss',
      name: 'Module temperature', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Temperate climate', v: { L: 3.0, s: 1.0 } },
        { label: 'Warm climate', v: { L: 5.5, s: 1.2 } },
        { label: 'Hot climate (Indian plains, Middle East, deserts)', v: { L: 8.0, s: 1.5 } } ] },
      def: { v: { L: 5.5, s: 1.2 } },
      src: ['t13', 'sam', 'frontiers', 'judge'],
      info: { what: 'Modules lose output as they heat up, typically about 0.3–0.4 % per °C above 25 °C cell temperature.', drives: 'Ambient temperature, wind, mounting and airflow, module temperature coefficient.', reduce: 'Use site temperature and wind data and a thermal model validated for the mounting type.', values: 'IEA PVPS Task 13 uses 1.0 % uncertainty for temperature losses; NREL\'s SAM method gives cell temperature σ 1.0. A PVsyst study of a coastal Indian plant found a 9.7 % temperature loss.' },
    },
    {
      id: 'module_rating', tech: S, stage: 'pvconv', cat: 'module', sub: 'nameplate_rating', domain: 'en',
      name: 'Module power rating', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Independent flash tests of delivered modules', v: 1.0 },
        { label: 'Manufacturer flash data, established supplier', v: 2.0 },
        { label: 'No test data or new supplier', v: 3.0 } ] },
      def: { v: 2.0 },
      src: ['t13', 'sam'],
      info: { what: 'Whether the modules deliver their rated power at standard test conditions.', drives: 'Flash test accuracy, power tolerance, supplier quality.', reduce: 'Commission independent flash tests on a sample of delivered modules.', values: 'IEA PVPS Task 13: the best labs measure STC power to about 1.6 % (expanded), typical labs 2–4 %. NREL\'s SAM method uses σ 2.0 % for a single module\'s STC rating.' },
    },
    {
      id: 'lid', tech: S, stage: 'pvconv', cat: 'module', sub: 'light_induced_degradation', domain: 'loss',
      name: 'Light-induced degradation (LID, LeTID)', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'n-type modules, low LID', v: { L: 0.5, s: 0.3 } },
        { label: 'p-type PERC', v: { L: 1.5, s: 0.7 } },
        { label: 'Module type unknown', v: { L: 2.5, s: 1.2 } } ] },
      def: { v: { L: 1.5, s: 0.7 } },
      src: ['t13', 'judge'],
      info: { what: 'Crystalline modules lose some power in their first hours and months in the sun.', drives: 'Cell technology and wafer type.', reduce: 'Ask for LID and LeTID test results for the exact module.', values: 'IEA PVPS Task 13 reports initial losses of up to about 3 % in the first hours for crystalline silicon, and additional LID of 0.3–1 %.' },
    },
    {
      id: 'mismatch', tech: S, stage: 'pvconv', cat: 'module', sub: 'mismatch', domain: 'loss',
      name: 'Mismatch', defaultMode: 'default',
      def: { v: { L: 1.0, s: 0.5 } },
      src: ['sam'],
      info: { what: 'Small differences between modules in a string reduce the string\'s output.', drives: 'Module binning, uneven soiling and shading.', reduce: 'Sort modules by flash-test power when stringing.', values: 'NREL\'s SAM method gives mismatch a triangular range of −1.8 to 0 % (mode −0.8 %).' },
    },
    {
      id: 'dc_wiring', tech: S, stage: 'pvconv', cat: 'dc_inverter', sub: 'dc_wiring', domain: 'loss',
      name: 'DC wiring', defaultMode: 'default',
      calc: { fields: [{ key: 'L', label: 'DC loss from your design', unit: '%', def: 1.5, step: 0.1 }], fn: x => ({ L: x.L, s: Math.max(0.2, 0.3 * x.L) }), note: 's = 30 % of the loss, at least 0.2 points' },
      def: { v: { L: 1.5, s: 0.5 } },
      src: ['sam'],
      info: { what: 'Resistive losses in strings and DC cables.', drives: 'Cable length and size, current.', reduce: 'Calculate losses from the final cable schedule.', values: 'NREL\'s SAM method gives DC wiring a triangular range of −2.5 to −1 % (mode −1.5 %).' },
    },
    {
      id: 'inverter', tech: S, stage: 'pvconv', cat: 'dc_inverter', sub: 'inverter_efficiency', domain: 'loss',
      name: 'Inverter efficiency', defaultMode: 'desc',
      desc: { def: 0, options: [{ label: 'Measured efficiency curve (CEC or EU weighted)', v: { L: 1.5, s: 0.5 } }, { label: 'Generic efficiency', v: { L: 2.0, s: 1.0 } }] },
      def: { v: { L: 1.5, s: 1.0 } },
      src: ['t13', 'judge'],
      info: { what: 'Conversion losses from DC to AC.', drives: 'Inverter model, loading, temperature.', reduce: 'Use the measured efficiency curve of the chosen inverter.', values: 'IEA PVPS Task 13 uses 1.5 % uncertainty for inverter losses in its example.' },
    },
    {
      id: 'clipping', tech: S, stage: 'pvconv', cat: 'dc_inverter', sub: 'clipping', domain: 'loss',
      name: 'Inverter clipping', defaultMode: 'desc',
      calc: { fields: [{ key: 'L', label: 'Clipping loss from your simulation', unit: '%', def: 1.0, step: 0.1 }, { key: 'sub', label: 'Time step of the simulation', type: 'select', def: 'hourly', options: [['hourly', 'Hourly'], ['sub', '15 minutes or finer']] }],
        fn: x => ({ L: x.L, s: Math.max(0.2, (x.sub === 'sub' ? 0.25 : 0.5) * x.L) }), note: 's = 50 % of the loss for hourly simulations, 25 % for sub-hourly' },
      desc: { options: [{ label: 'Estimate from the DC/AC ratio', v: ctx => { const L = clipL(ctx.dcac); return { L, s: Math.max(0.2, 0.5 * L) }; } }] },
      def: { v: { L: 1.0, s: 0.5 } },
      src: ['sgsub', 'judge'],
      info: { what: 'When DC power exceeds the inverter rating, the extra is lost (unless storage captures it).', drives: 'DC/AC ratio, irradiance peaks, cloud-edge events, module degradation over time.', reduce: 'Simulate with 15-minute or finer data, especially at DC/AC ratios above about 1.3.', values: 'Solargis finds hourly data underestimates clipping, more so at higher DC/AC ratios. The estimate by DC/AC ratio is framework judgement.' },
    },
    {
      id: 'model_chain', tech: S, stage: 'pvconv', cat: 'model', sub: 'simulation_model', domain: 'en',
      name: 'Simulation model chain', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Established software, validated against operating plants', v: 0.7 },
        { label: 'Established software, not validated locally', v: 1.5 },
        { label: 'Simplified PR-based estimate', v: 3.0 } ] },
      def: { v: 1.0 },
      src: ['sgpv', 'judge'],
      info: { what: 'What the individual loss items miss: model structure, interactions and time resolution.', drives: 'Software, time step, how well the model has matched operating plants.', reduce: 'Validate the model setup against operating plants in the same region.', values: 'Solargis applies about 5 % (at P90) to the whole simulation chain. This tool counts each step separately, so only the residual is here. Framework judgement.' },
    },
    {
      id: 'ac_loss', tech: S, stage: 'losses', cat: 'electrical', sub: 'ac_wiring_transformer', domain: 'loss',
      name: 'AC cabling and transformers', defaultMode: 'default',
      def: { v: { L: 1.2, s: 0.4 } },
      src: ['sam'],
      info: { what: 'Losses in AC cables, inverter transformers and the main transformer.', drives: 'Cable lengths, transformer ratings, loading.', reduce: 'Run a loss study on the final electrical design.', values: 'NREL\'s SAM method gives transformer losses a triangular range of −2 to −0.5 % (mode −1 %).' },
    },
    {
      id: 'pv_aux', tech: S, stage: 'losses', cat: 'electrical', sub: 'auxiliary_consumption', domain: 'loss',
      name: 'Auxiliary and night consumption', defaultMode: 'default',
      def: { v: { L: 0.3, s: 0.1 } },
      src: ['judge'],
      info: { what: 'Tracker motors, inverter standby, lighting and security drawn from the plant or grid.', drives: 'Tracker type, metering arrangement.', reduce: 'Check how auxiliary consumption is metered and billed.', values: 'Framework judgement.' },
    },
    {
      id: 'pv_avail', tech: S, stage: 'losses', cat: 'availability', sub: 'plant_availability', domain: 'loss', dist: 'weibull', hasIav: true,
      name: 'Plant availability (inverters, trackers)', defaultMode: 'desc',
      desc: { def: 1, options: [
        { label: 'Strong O&M, availability warranty 99 % or higher', v: { L: 0.7, s: 0.4, iav: 0.3 } },
        { label: 'Typical', v: { L: 1.0, s: 0.5, iav: 0.5 } },
        { label: 'Weak O&M or remote site', v: { L: 2.0, s: 1.0, iav: 0.8 } } ] },
      def: { v: { L: 1.0, s: 0.5, iav: 0.5 } },
      src: ['sam', 'judge'],
      info: { what: 'Energy lost while inverters, trackers or strings are down.', drives: 'Equipment reliability, spares, response times.', reduce: 'Agree an availability guarantee and keep spare inverter parts on site.', values: 'NREL\'s SAM method uses inverter availability of −1 % with σ 0.5. Monte Carlo uses a skewed (Weibull) distribution.' },
    },
    {
      id: 'degradation', tech: S, stage: 'losses', cat: 'degradation', sub: 'module_degradation', domain: 'loss', time: 'horizon',
      name: 'Module degradation over the years', defaultMode: 'desc',
      unitL: '%/yr',
      calc: { fields: [{ key: 'r', label: 'Degradation rate', unit: '%/yr', def: 0.55, step: 0.05 }, { key: 'u', label: 'Uncertainty of the rate (σ)', unit: '%/yr', def: 0.25, step: 0.05 }], fn: x => ({ L: x.r, s: x.u }), note: 'Average loss over N years = rate × (N − 1) ÷ 2' },
      desc: { def: 1, options: [
        { label: 'n-type or premium modules, mild climate', v: { L: 0.4, s: 0.2 } },
        { label: 'Typical crystalline silicon', v: { L: 0.55, s: 0.25 } },
        { label: 'Hot or humid climate, or unproven modules', v: { L: 0.8, s: 0.35 } } ] },
      def: { v: { L: 0.55, s: 0.25 } },
      src: ['jordan', 't13b', 'judge'],
      info: { what: 'Modules lose a little power every year. The year-1 P50 excludes it; the 10-year and lifetime P50s include the average loss over the period.', drives: 'Module technology and quality, temperature, humidity, UV.', reduce: 'Choose modules with long-term field data and a strong linear power warranty, and track performance from the start.', values: 'NREL finds a median of about 0.5–0.6 % a year and a mean of about 0.8 % a year for crystalline silicon. IEA PVPS Task 13 names degradation assumptions as a main source of disagreement between assessors.' },
    },
  ];
  SOLAR_ITEMS.forEach(d => ITEMS.push(d));

  /* ---------------- Battery storage (used by the hourly simulation) ---------------- */
  const B = (id, name, o) => ITEMS.push(Object.assign({ id, tech: 'bess', stage: 'bess', cat: 'storage', sub: id.replace('bess_', ''), domain: 'bess', name }, o));
  B('bess_cap', 'Usable energy at the start (capacity test)', {
    defaultMode: 'desc', bunit: { L: '% bias', s: '%' }, labels: { L: 'Bias against nameplate usable energy', s: 'Uncertainty (σ)' },
    desc: { def: 1, options: [{ label: 'Site acceptance capacity test at commissioning', v: { L: 0, s: 1.0 } }, { label: 'Factory test only', v: { L: 0, s: 2.0 } }, { label: 'Datasheet only', v: { L: 0, s: 4.0 } }] },
    def: { v: { L: 0, s: 2.0 } }, src: ['dnvwarr', 'judge'],
    info: { what: 'Whether the battery delivers its stated usable energy on day one.', drives: 'Test method, temperature and rate during the test, how usable energy is defined in the contract.', reduce: 'Run a site acceptance capacity test at the contract conditions.', values: 'Framework judgement.' },
  });
  B('bess_rte', 'Round-trip efficiency (AC to AC)', {
    defaultMode: 'desc', bunit: { L: '%', s: 'pts' }, labels: { L: 'Round-trip efficiency', s: 'Uncertainty (σ)' },
    desc: { def: 1, options: [{ label: 'Tested system, 88 % or better', v: { L: 88, s: 1.0 } }, { label: 'Contract guarantee of about 85 %', v: { L: 85, s: 1.5 } }, { label: 'Datasheet only (DC efficiency)', v: { L: 83, s: 3.0 } }] },
    def: { v: { L: 86, s: 2.0 } }, src: ['dwt', 'furo'],
    info: { what: 'The share of charged energy that comes back out, including inverters and transformers. It falls slowly as the battery ages; the simulation takes off 0.15 points a year.', drives: 'Cell chemistry, power conversion, temperature, auxiliary loads, how hard the battery is cycled.', reduce: 'Specify RTE at the POI in the contract and test it.', values: 'Storage agreements typically set RTE requirements between 85 % and 95 %. A modelled LFP example starts at 86 % and falls to about 83 % over 20 years.' },
  });
  B('bess_fade', 'Capacity fade', {
    defaultMode: 'desc', bunit: { L: '%/yr', s: '%/yr' }, labels: { L: 'Fade rate', s: 'Uncertainty of the rate (σ)' },
    desc: { def: 0, options: [{ label: 'LFP, about one cycle a day, temperature-controlled', v: { L: 2.0, s: 0.6 } }, { label: '1.5–2 cycles a day, or a hot site', v: { L: 3.0, s: 1.0 } }, { label: 'Chemistry or duty unknown', v: { L: 3.0, s: 1.5 } }] },
    def: { v: { L: 2.0, s: 0.8 } }, src: ['esnews', 'dnvwarr', 'nrelbatt', 'judge'],
    info: { what: 'Usable energy shrinks with age and use. Fade is usually faster in the first years and then flattens; the simulation uses a straight-line average.', drives: 'Temperature, cycles per day, depth of discharge, average state of charge, charge and discharge rate.', reduce: 'Keep cells near 25 °C, stay within the warranty duty, and plan augmentation.', values: 'Warranties typically promise 70–80 % state of health at the end of 15–20 years, about 1.5–2 % a year on a straight line. DNV notes 1 cycle a day as a baseline and 1.5 as aggressive.' },
  });
  B('bess_avail', 'Battery outages', {
    defaultMode: 'desc', dist: 'weibull', bunit: { L: '% of days', s: '%' }, labels: { L: 'Unavailability', s: 'Uncertainty (σ)' },
    desc: { def: 1, options: [{ label: 'Availability guarantee of 98 % or better, spares on site', v: { L: 1.5, s: 0.7 } }, { label: 'Typical', v: { L: 2.0, s: 1.0 } }, { label: 'Weak O&M or remote site', v: { L: 4.0, s: 2.0 } }] },
    def: { v: { L: 2.0, s: 1.0 } }, src: ['dwt', 'dnvwarr', 'judge'],
    info: { what: 'Days when the battery cannot charge or discharge. The simulation takes whole days out at random, drawn from a skewed distribution.', drives: 'Spares, response times, repair logistics.', reduce: 'Agree availability liquidated damages and keep spare modules and power electronics on site.', values: 'Storage agreements often set monthly availability around 98 %. DNV notes repairs can take about a month.' },
  });
  B('bess_aux', 'Auxiliary and HVAC consumption', {
    defaultMode: 'desc', bunit: { L: '% of throughput', s: '%' }, labels: { L: 'Consumption', s: 'Uncertainty (σ)' },
    desc: { def: 1, options: [{ label: 'Mild climate', v: { L: 1.5, s: 0.5 } }, { label: 'Hot climate, cooled containers', v: { L: 3.0, s: 1.0 } }] },
    def: { v: { L: 2.0, s: 0.8 } }, src: ['judge'],
    info: { what: 'Cooling, heating and controls drawn by the battery, charged against delivered energy.', drives: 'Ambient temperature, enclosure design, cycling.', reduce: 'Use measured auxiliary data from the same product in a similar climate.', values: 'Framework judgement.' },
  });
  B('bess_dispatch', 'Dispatch and forecast imperfection', {
    defaultMode: 'desc', bunit: { L: '% of energy', s: '%' }, labels: { L: 'Energy not available when needed', s: 'Uncertainty (σ)' },
    desc: { def: 1, options: [{ label: 'Optimised day-ahead dispatch with good forecasts', v: { L: 3, s: 2 } }, { label: 'Rule-based dispatch', v: { L: 6, s: 3 } }, { label: 'Manual or poorly forecast', v: { L: 10, s: 5 } }] },
    def: { v: { L: 5, s: 3 } }, src: ['judge'],
    info: { what: 'The simulation dispatches with simple rules that know the current hour only. Real forecasts miss, so part of the battery is not charged, or is used up, when the demand comes.', drives: 'Forecast quality, scheduling rules, how much the operator reserves for peak hours.', reduce: 'Use forecast-driven dispatch and keep a reserve for the hours with the strictest targets.', values: 'Framework judgement, applied as a reduction of usable energy.' },
  });

  /* ---------------- Hybrid layer ---------------- */
  ITEMS.push({
    id: 'hy_export_limit', tech: 'hybrid', stage: 'hybrid', cat: 'curtailment', sub: 'export_limit', domain: 'loss',
    name: 'Export limit at the shared connection', defaultMode: 'desc',
    calc: { fields: [{ key: 'L', label: 'Loss from your time-series simulation', unit: '%', def: 1.0, step: 0.05 }, { key: 'sub', label: 'Time step of the simulation', type: 'select', def: 'hourly', options: [['hourly', 'Hourly'], ['sub', '15 minutes or finer']] }],
      fn: x => ({ L: x.L, s: Math.max(0.05, (x.sub === 'sub' ? 0.2 : 0.4) * x.L) }), note: 's = 40 % of the loss for hourly simulations, 20 % for sub-hourly' },
    desc: { options: [{ label: 'Estimate from the connection size and the wind–solar mix', v: ctx => {
      const c = ctx.connFrac, m = ctx.mixRatio;
      const pts = [[0.3, 14], [0.4, 6.67], [0.5, 1.98], [0.6, 0.63], [0.7, 0.18], [0.8, 0.04], [0.9, 0.005]];
      let L = 0;
      if (c < 0.95) {
        if (c <= 0.3) L = 14 * Math.pow(14 / 6.67, (0.3 - c) / 0.1);
        else { let i = 0; while (i < pts.length - 1 && pts[i + 1][0] < c) i++; const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)]; L = b[0] === a[0] ? a[1] : Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * (c - a[0]) / (b[0] - a[0])); if (c > 0.9) L *= (0.95 - c) / 0.05; }
        L = Math.min(40, L * (1 + Math.abs(Math.log(Math.max(0.05, m)))));
      }
      return { L, s: Math.max(0.05, 0.6 * L) }; } }] },
    def: { v: { L: 0.5, s: 0.5 } },
    src: ['grab', 'judge'],
    info: { what: 'When the wind and solar plants together produce more than the shared connection can export, the excess is curtailed.', drives: 'Connection size relative to combined capacity, the wind–solar mix, how often both run high at once, plant capacity factors.', reduce: 'Simulate both plants together on a common time series (15-minute or finer) with the export limit, or add storage to capture the excess.', values: 'A measured 1:1 PV–wind plant lost 0.04 % of its energy with a connection at 80 % of combined capacity, 0.63 % at 60 %, 1.98 % at 50 % and 6.67 % at 40 %. Mixes far from 1:1 behave more like a single technology and lose more; the estimate scales up for that. One site in Germany, so treat it as indicative; windier or sunnier sites curtail more.' },
  });

  const ITEM_BY_ID = Object.fromEntries(ITEMS.map(d => [d.id, d]));

  /* ---------- default and example projects ---------- */
  function itemState(def) {
    const st = { mode: def.defaultMode, inputs: {}, choice: def.desc ? (def.desc.def || 0) : 0, entered: {} };
    (def.calc && def.calc.fields || []).forEach(f => { st.inputs[f.key] = f.def; });
    (def.desc && def.desc.fields || []).forEach(f => { st.inputs[f.key] = f.def; });
    if (def.domain === 'loss') {
      const d = typeof def.def.v === 'function' ? { L: 0, s: 0 } : def.def.v;
      st.entered = { L: d.L || 0, s: d.s || 0, iav: d.iav || 0 };
    } else st.entered = { v: typeof def.def.v === 'number' ? def.def.v : 1 };
    return st;
  }
  function deviceItems(type) {
    const o = {};
    ITEMS.filter(d => d.device === type).forEach(d => { o[d.id] = itemState(d); });
    return o;
  }
  let devSeq = 0;
  function newDevice(type, opts = {}) {
    devSeq++;
    return Object.assign({ id: 'd' + Date.now().toString(36) + devSeq, type, name: type === 'lidar' ? 'Lidar' : 'Mast', height: type === 'lidar' ? 140 : 100, weight: 1, items: deviceItems(type) }, opts);
  }

  function blankProject(tech) {
    const items = {};
    ITEMS.filter(d => !d.device).forEach(d => { items[d.id] = itemState(d); });
    const solar = tech === 'solar', hybrid = tech === 'hybrid';
    return {
      schema: 'wind-uncertainty/1',
      tech: hybrid ? 'hybrid' : solar ? 'solar' : 'wind',
      meta: { id: 'p' + Date.now().toString(36), name: hybrid ? 'New hybrid project' : solar ? 'New solar project' : 'New wind project', site: '', notes: '', example: false, updated: new Date().toISOString() },
      setup: { dataSource: 'onsite', terrain: 'moderate', solarSource: 'satellite' },
      pv: { dcMWp: 130, acMW: 100, mount: 'fixed', bifacial: false, ghi: 1900, poaRatio: 1.10 },
      plant: { nTurbines: 20, ratedMW: 3.3, rotorD: 156, hubH: 140, cutIn: 3, cutOut: 25, curveMode: 'generic', curveText: '', curveRho: 1.225 },
      site: { elevation: 300, tempC: 25, rhoMode: 'calc', rho: 1.15 },
      climate: { meanWs: 7.0, k: 2.0, sigmaA: 4.0 },
      energy: { p50Mode: 'computed', p50: 0, sensMode: 'computed', sens: 1.8 },
      horizon: { life: 25 },
      energyPv: { p50Mode: 'computed', p50: 0, sensMode: 'computed', sens: 1 },
      hybrid: { gridMW: 0, rhoIav: 0, rhoRes: 0 },
      bess: { enabled: false, powerMW: 50, energyMWh: 200, augment: false, augTarget: 80, gridMW: 0 },
      supply: { preset: 'fdre4', contractMW: 50, peakHours: [0, 15, 16, 21, 22, 23], offFrac: 1, peakFrac: 1, reserve: 0, allowExcess: true, relax: true, targets: {}, tariff: 0, penaltyMult: 1.5, currency: 'INR', season: 'monsoon', latitude: 22, windPeakHour: 20, windDiurnal: 0.12, profile: { kind: 'generated' }, profileScale: true, year: 1, samples: 400 },
      vertical: { hMeas: 100, hLow: 60, alpha: 0.2, shear: 'moderate' },
      horizontal: {},
      devices: [newDevice('mast')],
      deviceCorr: 0.5,
      items,
      catCorr: {},
      view: { horizon: 10 },
      mc: { n: 50000 },
    };
  }

  function exampleProject() {
    const p = blankProject();
    p.meta.name = 'Example: 92 MW inland wind farm';
    p.meta.site = 'Illustrative values only';
    p.meta.example = true;
    p.setup.terrain = 'moderate';
    p.plant = { nTurbines: 28, ratedMW: 3.3, rotorD: 156, hubH: 140, cutIn: 3, cutOut: 25, curveMode: 'generic', curveText: '', curveRho: 1.225 };
    p.site = { elevation: 450, tempC: 27, rhoMode: 'calc', rho: 1.11 };
    p.climate = { meanWs: 6.8, k: 2.2, sigmaA: 4.0 };
    p.vertical = { hMeas: 100, hLow: 60, alpha: 0.22, shear: 'moderate' };
    const mast = newDevice('mast', { name: 'Mast M1 (100 m)', height: 100, weight: 0.7 });
    mast.items.cup_cal.mode = 'calc'; mast.items.cup_cal.inputs.calExp = 1.5;
    mast.items.cup_mount.choice = 1;
    const lidar = newDevice('lidar', { name: 'Lidar L1 (on site)', height: 140, weight: 0.3 });
    lidar.items.lid_flow.choice = 2;
    p.devices = [mast, lidar];
    p.items.mcp.inputs = { method: 'mcp', r: 0.82, nR: 20, nT: 1.5 };
    p.items.horiz_approp.inputs = { model: 'cfd', dist: '5' };
    p.items.wake_int.mode = 'calc'; p.items.wake_int.inputs = { L: 9.2, f: 20 };
    p.items.cur_grid.choice = 1;
    p.items.env_ext.choice = 1;
    return p;
  }

  function solarExampleProject() {
    const p = blankProject('solar');
    p.meta.name = 'Example: 150 MWac solar PV plant';
    p.meta.site = 'Illustrative values only';
    p.meta.example = true;
    p.setup.solarSource = 'satellite';
    p.pv = { dcMWp: 195, acMW: 150, mount: 'tracker', bifacial: true, ghi: 1950, poaRatio: 1.24 };
    p.items.sat_model.choice = 1;
    p.items.transposition.choice = 1;
    p.items.temperature.choice = 2;
    p.items.soiling.mode = 'calc'; p.items.soiling.inputs = { rate: 0.3, days: 15 };
    p.items.av_grid.choice = 1;
    p.items.cur_grid.choice = 1;
    p.items.el_export.choice = 1;
    return p;
  }

  function hybridExampleProject() {
    const p = exampleProject(), sx = solarExampleProject();
    p.tech = 'hybrid';
    p.meta.name = 'Example: 92 MW wind + 150 MWac solar hybrid';
    p.meta.site = 'Illustrative values only';
    p.meta.example = true;
    p.pv = sx.pv;
    p.setup.solarSource = sx.setup.solarSource;
    SOLAR_ITEMS.forEach(d => { p.items[d.id] = sx.items[d.id]; });
    p.energyPv = { p50Mode: 'computed', p50: 0, sensMode: 'computed', sens: 1 };
    p.hybrid = { gridMW: 150, rhoIav: 0, rhoRes: 0 };
    p.items.av_grid.choice = 1; p.items.cur_grid.choice = 1; p.items.el_export.choice = 1;
    return p;
  }

  function bessExampleProject() {
    const p = hybridExampleProject();
    p.meta.name = 'Example: wind + solar hybrid with 4-hour storage (FDRE)';
    p.bess = { enabled: true, powerMW: 60, energyMWh: 240, augment: false, augTarget: 80, gridMW: 0 };
    p.supply = Object.assign({}, p.supply, { preset: 'fdre4', contractMW: 40, peakHours: [0, 15, 16, 21, 22, 23], offFrac: 1, peakFrac: 1, reserve: 0, tariff: 5.25, penaltyMult: 1.5, currency: 'INR' });
    return p;
  }

  /* fill any missing pieces in an older or imported project */
  function normalise(p) {
    const b = blankProject(p && p.tech);
    const out = Object.assign({}, b, p);
    out.tech = p && (p.tech === 'solar' || p.tech === 'hybrid') ? p.tech : 'wind';
    ['meta', 'setup', 'pv', 'plant', 'site', 'climate', 'energy', 'energyPv', 'hybrid', 'bess', 'supply', 'horizon', 'vertical', 'horizontal', 'view', 'mc'].forEach(k => { out[k] = Object.assign({}, b[k], p && p[k]); });
    out.items = Object.assign({}, b.items);
    Object.keys((p && p.items) || {}).forEach(id => { if (ITEM_BY_ID[id]) out.items[id] = Object.assign(itemState(ITEM_BY_ID[id]), p.items[id]); });
    out.devices = ((p && p.devices) || b.devices).map(d => {
      const base = newDevice(d.type === 'lidar' ? 'lidar' : 'mast');
      const items = base.items;
      Object.keys(d.items || {}).forEach(id => { if (items[id]) items[id] = Object.assign(items[id], d.items[id]); });
      return Object.assign(base, d, { items });
    });
    out.catCorr = Object.assign({}, p && p.catCorr);
    return out;
  }

  return { SOURCES, STAGES, CHAINS, COMPONENT_OF_STAGE, LOSS_GROUPS, GROUPS, ITEMS, ITEM_BY_ID, itemState, newDevice, blankProject, exampleProject, solarExampleProject, hybridExampleProject, bessExampleProject, normalise, items: ITEMS };
})();
if (typeof module !== 'undefined') module.exports = Library;
