#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Headless Chrome CDP runner: load a page, wait for a marker expression, dump results.

Usage: python tools/cdp_run.py <url> <wait_seconds> <js_expression>
Prints the JSON result of js_expression (evaluated in page).
"""
import io
import json
import subprocess
import sys
import time
import tempfile
import os

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import websocket  # websocket-client

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'


def main():
    url, wait_s, expr = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    if expr.startswith('@'):
        expr = open(expr[1:], encoding='utf-8').read()
    user_dir = tempfile.mkdtemp(prefix='wr-cdp-')
    port = 9333
    proc = subprocess.Popen([
        CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
        f'--remote-debugging-port={port}', f'--user-data-dir={user_dir}',
        '--remote-allow-origins=*',
        '--no-first-run', '--no-default-browser-check', 'about:blank'
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import requests
        targets = None
        for _ in range(50):
            try:
                r = requests.get(f'http://127.0.0.1:{port}/json', timeout=1)
                targets = r.json()
                break
            except Exception:
                time.sleep(0.2)
        if not targets:
            print(json.dumps({'error': 'cannot connect to CDP'}))
            return 1
        page = next(t for t in targets if t['type'] == 'page')
        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=30)
        ws.send(json.dumps({'id': 1, 'method': 'Page.enable'}))
        ws.send(json.dumps({'id': 2, 'method': 'Page.navigate', 'params': {'url': url}}))
        # drain events until loadEventFired or timeout
        deadline = time.time() + 15
        loaded = False
        ws.settimeout(2)
        while time.time() < deadline and not loaded:
            try:
                ws.recv()
            except Exception:
                pass
        time.sleep(wait_s)
        ws.settimeout(30)
        eval_params = {'expression': expr, 'returnByValue': True}
        if expr.lstrip().startswith(('(async', 'async')):
            eval_params['awaitPromise'] = True
        ws.send(json.dumps({'id': 3, 'method': 'Runtime.evaluate', 'params': eval_params}))
        result = None
        while result is None:
            msg = json.loads(ws.recv())
            if msg.get('id') == 3:
                result = msg
        value = result.get('result', {}).get('result', {})
        print(json.dumps(value.get('value'), ensure_ascii=False))
        ws.close()
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == '__main__':
    sys.exit(main())
