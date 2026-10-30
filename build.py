import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
dist = root / 'dist'

# 1. The app as one self-contained page fragment (no document skeleton; step 2
#    wraps it for the website).
html = (src / 'index.html').read_text()
for tag, f in [('CSS', 'styles.css'), ('ENGINE', 'engine.js'), ('LIBRARY', 'library.js'), ('BESS', 'bess.js'), ('PLANT', 'plant.js'), ('UI', 'ui.js')]:
    body = (src / f).read_text()
    if f == 'ui.js':
        body = body.replace('/*@@PLANTVIEW@@*/', (src / 'plantview.js').read_text())
    assert '</script' not in body.lower() or f.endswith('.css'), f
    html = html.replace(f'/*@@{tag}@@*/', body)
out = dist / 'wind-energy-uncertainty.html'
out.write_text(html)
print(out, len(html.encode()) // 1024, 'KB')

# 2. The website (coderenewables.com): landing page at /, app at /app/.
#    Each page gets the same document skeleton the artifact viewer adds:
#    doctype, charset, viewport and a small reset, with the page's own title,
#    meta, links and styles (everything up to the first </style>) in <head>.
RESET = (':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);'
         'padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}'
         'body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}'
         'img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}')


def document(fragment):
    cut = fragment.index('</style>') + len('</style>')
    head, body = fragment[:cut], fragment[cut:]
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            f'<style>{RESET}</style>\n{head}\n</head>\n<body>{body}\n</body>\n</html>\n')


site = dist / 'site'
(site / 'app').mkdir(parents=True, exist_ok=True)
for path, fragment in [(site / 'index.html', (src / 'landing.html').read_text()), (site / 'app' / 'index.html', html)]:
    path.write_text(document(fragment))
    print(path, len(path.read_bytes()) // 1024, 'KB')
