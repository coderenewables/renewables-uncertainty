import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
html = (src / 'index.html').read_text()
for tag, f in [('CSS', 'styles.css'), ('ENGINE', 'engine.js'), ('LIBRARY', 'library.js'), ('BESS', 'bess.js'), ('PLANT', 'plant.js'), ('UI', 'ui.js')]:
    body = (src / f).read_text()
    if f == 'ui.js':
        body = body.replace('/*@@PLANTVIEW@@*/', (src / 'plantview.js').read_text())
    assert '</script' not in body.lower() or f.endswith('.css'), f
    html = html.replace(f'/*@@{tag}@@*/', body)
out = root / 'dist' / 'wind-energy-uncertainty.html'
out.write_text(html)
print(out, len(html.encode()) // 1024, 'KB')
