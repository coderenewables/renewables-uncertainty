const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = process.argv[2], XL = process.argv[3];
const body = fs.readFileSync(path.join(__dirname, '../dist/wind-energy-uncertainty.html'), 'utf8');
const stub = `<script>${fs.readFileSync(XL, 'utf8')}</script>`;
const page = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>${stub}${body}</body></html>`;
const file = path.join(OUT, 'export.html'); fs.writeFileSync(file, page);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ acceptDownloads: true })).newPage();
  const saved = [];
  p.on('download', async d => { const f = await d.path(); saved.push({ filename: d.suggestedFilename(), size: fs.statSync(f).size }); });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + file); await p.waitForTimeout(400);
  if (process.argv[4] === 'bess') {
    await p.click('button[data-act="projects"]'); await p.waitForTimeout(80); await p.click('button[data-act="example"][data-tech="bess"]'); await p.waitForTimeout(60); await p.click('button[data-act="replaceyes"]'); await p.waitForTimeout(100); await p.click('button[data-act="close"]');
    await p.click('button[data-act="mode"][data-val="steps"]'); await p.waitForTimeout(100);
    await p.click('.stage-btn[data-stage="supply"]'); await p.waitForTimeout(60); await p.click('button[data-act="firmrun"]'); await p.waitForFunction(() => document.querySelector('.tile.key'), null, { timeout: 30000 });
  } else if (process.argv[4]) { await p.click(`button[data-set="tech"][data-val="${process.argv[4]}"]`); await p.waitForTimeout(150); }
  await p.click('button[data-act="export"]'); await p.waitForTimeout(200);
  await p.click('button[data-act="xlsx"]'); await p.waitForTimeout(800);
  await p.click('button[data-act="json"]'); await p.waitForTimeout(300);
  // saved projects (this browser): save, then reopen
  await p.click('button[data-act="save"]'); await p.waitForTimeout(100);
  const listed = await p.$$eval('.prow', r => r.length);
  await p.click('.prow button[data-act="open"]'); await p.waitForTimeout(150);
  const tag = await p.textContent('#projTags');
  console.log('saved projects listed:', listed, '| tag after reopen:', tag.trim());
  await p.click('button[data-act="export"]'); await p.waitForTimeout(100);
  const status = await p.textContent('#ovStatus');
  console.log(JSON.stringify(saved), '| status:', status, '| errors:', errs.join('; ') || 'none');
  await b.close();
})();
