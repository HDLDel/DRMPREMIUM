#!/usr/bin/env python3
import os
import sys
import shutil
import subprocess
from pathlib import Path

SRC = os.getcwd()
PROJECT = os.path.basename(SRC)
DST = os.path.join(SRC, PROJECT)

OBFUSCATE = ['server.js', 'script.js']

MINIFY = ['index.html', 'login.html', 'style.css']

STATIC = [
    'package.json', 'package-lock.json',
    'nginx_iptv.conf',
]

COPY_DIRS = ['fonts']

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
    if not shutil.which(name) and not shutil.which('npx'):
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
    use_npx = False
    if not obfuscator:
        obfuscator = shutil.which('npx')
        use_npx = True
    
    for f in OBFUSCATE:
        src = os.path.join(SRC, f)
        dst = os.path.join(DST, f)
        if not os.path.exists(src):
            log(f'SKIP (not found): {f}')
            continue
        log(f'Obfuscating: {f}...')
        
        # Adjust options dynamically depending on file target
        ops = OPS.copy()
        if f == 'script.js':
            try:
                target_idx = ops.index('--target')
                ops[target_idx + 1] = 'browser'
            except ValueError:
                pass
                
        if use_npx:
            cmd = [obfuscator, 'javascript-obfuscator', src, '--output', dst] + ops
        else:
            cmd = [obfuscator, src, '--output', dst] + ops
            
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            log(f'FAILED: {f}')
            log(r.stderr)
            sys.exit(1)

import re

def minify_css(content):
    # Remove CSS comments
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
    # Remove excessive whitespaces
    content = re.sub(r'\s+', ' ', content)
    # Remove spaces around selectors and braces
    content = re.sub(r'\s*([\{\}:;,])\s*', r'\1', content)
    return content.strip()

import base64

def minify_html(content):
    # Remove HTML comments
    content = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
    # Remove excessive whitespaces
    content = re.sub(r'\s+', ' ', content)
    # Remove spaces between tags
    content = re.sub(r'>\s+<', '><', content)
    minified = content.strip()
    
    # Base64 encode to completely obfuscate HTML structure from view source
    encoded = base64.b64encode(minified.encode('utf-8')).decode('utf-8')
    return f'<!DOCTYPE html><html><head><meta charset="utf-8"><script>document.write(decodeURIComponent(escape(atob("{encoded}"))));</script></head><body></body></html>'

def minify_files():
    for f in MINIFY:
        src = os.path.join(SRC, f)
        dst = os.path.join(DST, f)
        if not os.path.exists(src):
            log(f'SKIP (not found): {f}')
            continue
        log(f'Minifying/Obfuscating: {f}...')
        with open(src, 'r', encoding='utf-8') as file:
            content = file.read()
        
        ext = os.path.splitext(f)[1]
        if ext == '.css':
            minified = minify_css(content)
        elif ext == '.html':
            minified = minify_html(content)
        else:
            minified = content
            
        with open(dst, 'w', encoding='utf-8') as file:
            file.write(minified)

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
    minify_files()

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
