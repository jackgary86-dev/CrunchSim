"""Bundle CrunchSim into one self-contained page for hosts that only accept inline styles and scripts.

Usage:  python tools/build.py        -> writes dist/artifact.html
The bundle has no <html>/<head>/<body> wrapper because the host adds its own skeleton.
"""
import io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = ['data.js', 'sim.js', 'audio.js', 'cam.js', 'scenes-a.js', 'scenes-b.js', 'score.js', 'app.js']

def rd(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8').read()

def main():
    html = rd('index.html')
    body = html[html.index('<body>') + len('<body>'):html.index('<script src="js/data.js">')]
    css = rd('css/style.css').replace(':root {', ':root {\n  color-scheme: dark;', 1)
    fonts = re.search(r'<link href="https://fonts\.googleapis\.com[^"]*" rel="stylesheet">', html).group(0)
    js = ''
    for f in SCRIPTS:
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
