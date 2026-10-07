"""Build the Windows setup package: dist/CrunchSim-Setup.zip.

Usage:  python tools/package.py

Unzip it anywhere on a Windows PC and double-click install.cmd: the game installs to %LOCALAPPDATA%\\CrunchSim with Desktop and
Start Menu shortcuts and an entry in Settings > Apps. The package carries three.js and the fonts in cache\\ (taken from this PC's
install cache, made by tools/install.ps1), so it installs with no network; without them the installer downloads them.
"""
import datetime, io, os, shutil, subprocess, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
NAME = 'CrunchSim-Setup'
GAME = ['index.html', 'plant3d.html', 'gallery.html', 'css', 'js']
CACHE = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'CrunchSim', 'cache')

README = """CrunchSim for Windows
=====================

Install:   double-click install.cmd
           (the game opens in its own window; Desktop and Start Menu shortcuts are made)
Update:    unzip a newer CrunchSim-Setup.zip and double-click its install.cmd. Your saves are kept.
Uninstall: Settings > Apps > CrunchSim > Uninstall (your saves are kept),
           or run install.cmd -Uninstall -Purge to delete the saves too.

Needs Microsoft Edge (part of Windows) or Google Chrome. Saves from the website do not carry over by themselves:
on the website use Settings > EXPORT SAVE, then IMPORT in the installed game.

Version: {version}
"""


def version():
    try:
        h = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except OSError:
        h = ''
    d = datetime.date.today()
    return '%d.%d.%d%s' % (d.year, d.month, d.day, ('-' + h) if h else '')


def main():
    os.makedirs(DIST, exist_ok=True)
    zpath = os.path.join(DIST, NAME + '.zip')
    ver = version()
    files = []   # (path on disk, path in the zip)
    for g in GAME:
        src = os.path.join(ROOT, g)
        if os.path.isdir(src):
            for d, _, fs in os.walk(src):
                for f in fs:
                    p = os.path.join(d, f)
                    files.append((p, os.path.relpath(p, ROOT)))
        else:
            files.append((src, g))
    files.append((os.path.join(ROOT, 'install.cmd'), 'install.cmd'))
    files.append((os.path.join(ROOT, 'tools', 'install.ps1'), os.path.join('tools', 'install.ps1')))
    bundled = 0
    if os.path.isdir(CACHE):
        for f in sorted(os.listdir(CACHE)):
            p = os.path.join(CACHE, f)
            if os.path.isfile(p):
                files.append((p, os.path.join('cache', f))); bundled += 1
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for src, arc in files:
            z.write(src, os.path.join(NAME, arc))
        z.writestr(os.path.join(NAME, 'version.txt'), ver + '\n')
        z.writestr(os.path.join(NAME, 'README.txt'), README.format(version=ver).replace('\n', '\r\n'))
    kb = os.path.getsize(zpath) // 1024
    print('wrote %s (%d KB, version %s, %d cached files bundled%s)' % (zpath, kb, ver, bundled,
          '' if bundled else ': run install.cmd once on this PC first to fill the cache, or the package downloads them at install'))


if __name__ == '__main__':
    main()
