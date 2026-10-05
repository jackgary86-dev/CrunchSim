"""Bundle CrunchSim into one self-contained page for hosts that only accept inline styles and scripts.

Usage:  python tools/build.py        -> writes dist/artifact.html and re-stamps index.html
The bundle has no <html>/<head>/<body> wrapper because the host adds its own skeleton.

GitHub Pages serves index.html and its css/js straight from main, and browsers keep old copies after a release.
stamp_index() appends ?v=<content hash> to every local stylesheet and script URL in index.html, so a changed file
gets a new URL and loads fresh (#39). Commit index.html after building.
"""
import hashlib, io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = ['data.js', 'sim.js', 'audio.js', 'cam.js', 'scenes-a.js', 'scenes-b.js', 'score.js', 'app.js']
MODULES = ['market', 'inventory', 'auction', 'missions', 'floor', 'onboarding', 'blueprints', 'playbooks', 'economics', 'intake', 'facility', 'rivals', 'endgame', 'layout']   # load order matters: later modules may use earlier ones

def rd(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8').read()

ASSET = re.compile(r'(<link rel="stylesheet" href="|<script src=")((?:css|js)/[^"?]+)(?:\?v=[0-9a-f]*)?(")')

def stamp(html):
    """Give every local css/js URL a ?v= query from a hash of the file's contents."""
    def sub(m):
        digest = hashlib.sha1(io.open(os.path.join(ROOT, m.group(2)), 'rb').read()).hexdigest()[:10]
        return m.group(1) + m.group(2) + '?v=' + digest + m.group(3)
    return ASSET.sub(sub, html)

def stamp_index():
    path = os.path.join(ROOT, 'index.html')
    html = rd('index.html')
    out = stamp(html)
    if out != html:
        with io.open(path, 'w', encoding='utf-8', newline='') as fh:
            fh.write(out)
        print('index.html asset URLs re-stamped')
    return out

def main():
    html = stamp_index()
    body = html[html.index('<body>') + len('<body>'):html.index('<script src="js/data.js')]
    css = rd('css/style.css').replace(':root {', ':root {\n  color-scheme: dark;', 1)
    fonts = re.search(r'<link href="https://fonts\.googleapis\.com[^"]*" rel="stylesheet">', html).group(0)
    js = ''
    for f in SCRIPTS + ['modules/' + m + '.js' for m in MODULES]:
        src = rd('js/' + f)
        assert '</script' not in src, f + ' contains a script terminator'
        js += '<script>\n' + src + '\n</script>\n'
    out = '<title>CrunchSim</title>\n' + fonts + '\n<style>\n' + css + '\n</style>\n' + body + js
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    with io.open(os.path.join(ROOT, 'dist', 'artifact.html'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(out)
    print('dist/artifact.html', len(out.encode('utf-8')), 'bytes')

if __name__ == '__main__':
    main()
