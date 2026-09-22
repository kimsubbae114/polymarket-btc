import os, sys, pathlib, subprocess, shutil, re
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(pathlib.Path.home() / 'Desktop' / 'coding' / 'jarvis'))
import cf_token
env = cf_token.env() or dict(os.environ)
w = shutil.which('wrangler')
PROJECT = 'polymarket-btc'
if '--create' in sys.argv:
    subprocess.run([w, 'pages', 'project', 'create', PROJECT, '--production-branch', 'main'], env=env, cwd=ROOT)
r = subprocess.run([w, 'pages', 'deploy', 'public', '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true'],
                   env=env, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
out = r.stdout + r.stderr
urls = re.findall(r'https://[\w.-]+\.pages\.dev', out)
print('exit', r.returncode, '| urls:', sorted(set(urls)))
if r.returncode != 0: print(out[-1500:])
