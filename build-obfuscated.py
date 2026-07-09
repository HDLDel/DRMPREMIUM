#!/usr/bin/env python3
import os
import sys
import shutil
import subprocess
from pathlib import Path

SRC = os.getcwd()
PROJECT = os.path.basename(SRC)
DST = os.path.join(SRC, PROJECT)

OBFUSCATE = ['server.js']

STATIC = [
    'index.html', 'login.html', 'script.js', 'style.css',
    'package.json', 'package-lock.json',
    'channels.json', 'nginx_iptv.conf',
    'readme.md', 'README.md',
]

COPY_DIRS = ['node_modules']

EXCLUDE = {
    '.git', '.agents', 'logs', '24HORAS', 'canais',
    'doc', 'clear', 'skills',
    '.aiexclude', '.gitignore', PROJECT,
    'session-ses_0cda.md', 'session-ses_0d03.md', 'session-ses_0e62.md',
    'listagem.md', 'skills',
    'ajuste.sh', 'install_ubuntu.sh', 'update_nginx.sh',
    'setup_crons.sh', 'sync_nginx_config.sh',
    'deploy.py', 'build-obfuscated.py',
}

OPS = [
    '--compact', 'true',
    '--control-flow-flattening', 'true',
    '--control-flow-flattening-threshold', '0.75',
    '--dead-code-injection', 'true',
    '--dead-code-injection-threshold', '0.4',
    '--identifier-names-generator', 'mangled',
    '--ignore-imports', 'true',
    '--numbers-to-expressions', 'true',
    '--rename-globals', 'false',
    '--self-defending', 'true',
    '--simplify', 'false',
    '--split-strings', 'true',
    '--split-strings-chunk-length', '80',
    '--string-array', 'true',
    '--string-array-encoding', 'base64',
    '--string-array-index-shift', 'true',
    '--string-array-rotate', 'true',
    '--string-array-shuffle', 'true',
    '--string-array-threshold', '0.8',
    '--string-array-wrappers-chained-calls', 'true',
    '--string-array-wrappers-count', '5',
    '--string-array-wrappers-parameters-max-count', '4',
    '--target', 'node',
    '--transform-object-keys', 'true',
    '--unicode-escape-sequence', 'false',
]

def log(msg):
    print(f'[BUILD] {msg}')

def check_tool(name):
    if not shutil.which(name):
        log(f'ERROR: {name} not found. Install: npm install -g {name}')
        sys.exit(1)

def clean_dst():
    if os.path.exists(DST):
        log(f'Removing existing {DST}/')
        shutil.rmtree(DST)

def copy_static():
    for f in STATIC:
        src = os.path.join(SRC, f)
        dst = os.path.join(DST, f)
        if os.path.exists(src):
            shutil.copy2(src, dst)
            log(f'Copied: {f}')

def copy_dirs():
    for d in COPY_DIRS:
        src = os.path.join(SRC, d)
        dst = os.path.join(DST, d)
        if os.path.exists(src):
            shutil.copytree(src, dst, symlinks=True)
            log(f'Copied: {d}/')

def create_env_example():
    content = '''# Example environment variables
# Copy this to .env and fill in your values

# Server port
PORT=8080

# Session secret (optional, auto-generated if empty)
SESSION_SECRET=

# Admin credentials (use bcrypt hashes)
# ADMIN_USER=admin@example.com
# ADMIN_HASH=$2a$10$...
'''
    path = os.path.join(DST, '.env.example')
    with open(path, 'w') as f:
        f.write(content)
    log('Created: .env.example')

def obfuscate_files():
    obfuscator = shutil.which('javascript-obfuscator')
    for f in OBFUSCATE:
        src = os.path.join(SRC, f)
        dst = os.path.join(DST, f)
        if not os.path.exists(src):
            log(f'SKIP (not found): {f}')
            continue
        log(f'Obfuscating: {f}...')
        cmd = [obfuscator, src, '--output', dst] + OPS
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            log(f'FAILED: {f}')
            log(r.stderr)
            sys.exit(1)

def main():
    check_tool('javascript-obfuscator')

    log(f'Source: {SRC}')
    log(f'Project: {PROJECT}')
    log(f'Output: {DST}/')

    clean_dst()
    os.makedirs(DST)

    copy_static()
    copy_dirs()
    create_env_example()
    obfuscate_files()

    log('')
    log('=' * 50)
    log(f'Build complete: {DST}/')
    log(f'Copy the {PROJECT}/ folder to the client and run:')
    log(f'  cd {PROJECT}')
    log(f'  npm install --production')
    log(f'  node server.js')
    log('=' * 50)

if __name__ == '__main__':
    main()
