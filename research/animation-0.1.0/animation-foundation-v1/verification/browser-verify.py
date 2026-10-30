"""Real Chromium WebGL/input check, with separate software/hardware evidence.
Run with an installed Chromium and Python Playwright; no browser download needed.
"""
import argparse
import asyncio
import functools
import hashlib
import http.server
import json
import platform
import threading
from importlib.metadata import version
from pathlib import Path
from playwright.async_api import async_playwright
from json_evidence import encode_evidence

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MODULE = '/animation-foundation-v1/verification/browser-probe.mjs'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

async def run(args):
    output = args.output.resolve()
    if output.is_relative_to(ROOT):
        raise ValueError('Evidence must be outside research sources')
    output.mkdir(parents=True, exist_ok=False)
    report = {'status': 'running', 'productionAccepted': False,
              'environment': {'platform': platform.platform(), 'playwright': version('playwright'),
                              'browserExecutable': args.browser, 'softwareRequested': args.software},
              'runs': [], 'errors': [],
              'scope': 'Real Chromium pointer events with an injected replay clock, foundation body owner and WebGL; not Electron desktop windows or physical GPU bytes',
              'serialization': 'Non-finite observations use explicit Infinity/-Infinity/NaN strings; finite metrics retain number types.'}
    def save():
        (output/'browser-report.json').write_text(encode_evidence(report))
    save()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        async with async_playwright() as p:
            flags = ['--no-sandbox']
            if args.software:
                flags += ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
            browser = await p.chromium.launch(executable_path=args.browser, headless=not args.headed, args=flags)
            report['environment']['chromium'] = browser.version
            for dpr in [1, 1.25, 2]:
                context = await browser.new_context(viewport={'width': 500, 'height': 440}, device_scale_factor=dpr)
                page = await context.new_page()
                page.on('pageerror', lambda e: report['errors'].append(str(e)))
                page.on('console', lambda m: report['errors'].append(m.text) if m.type == 'error' else None)
                page.on('response', lambda r: report['errors'].append(f'HTTP {r.status}: {r.url}') if r.status >= 400 else None)
                await page.goto(f'http://127.0.0.1:{server.server_port}/animation-foundation-v1/verification/browser-probe.html')
                await page.wait_for_function("document.documentElement.dataset.ready === 'true'", timeout=60000)
                async def call(name, argument=None):
                    return await page.evaluate('async ([path, name, arg]) => (await import(path))[name](arg)', [MODULE, name, argument]) if argument is not None else await page.evaluate('async ([path, name]) => (await import(path))[name]()', [MODULE, name])
                row = {'dpr': dpr, 'cold': await call('snapshot')}
                report['runs'].append(row)
                point = await call('point')
                await call('inputTime')
                await page.mouse.move(point['x'], point['y'])
                await page.mouse.down()
                await call('step', 0.01)
                row['down'] = await call('snapshot')
                assert row['down']['state']['captured'], 'Actual DOM pointer capture failed'
                await call('inputTime')
                await page.mouse.move(point['x']+45, point['y']-35, steps=4)
                await call('step', 0.1)
                row['drag'] = await call('snapshot')
                assert row['drag']['state']['mode'] == 'drag'
                await page.screenshot(path=str(output/f'drag-dpr-{dpr}.png'))
                await call('inputTime')
                await page.mouse.up()
                for _ in range(90):
                    await call('step', 1/60)
                row['released'] = await call('snapshot')
                assert not row['released']['state']['captured']
                assert row['released']['state']['mode'] == 'idle'
                # Cold/recreate resource counts must recover without GC or a new renderer.
                row['cycles'] = []
                for cycle in range(3):
                    before = await call('snapshot')
                    after = await call('release')
                    cycle_result = {'before': before, 'released': after}
                    row['cycles'].append(cycle_result)
                    assert after['pendingSchedulers'] == 0
                    assert after['memory']['geometries'] == 0, 'GPU geometry object leak'
                    # Pinned Three 0.186.1 creates one renderer-owned fallback
                    # sampler texture (WebGLUniforms.setValueT1). All 9 actor
                    # bone textures and all 8 morph textures must be released.
                    # Compare repeated cycles too; never allow growing residue.
                    assert after['memory']['textures'] == 1, 'Unexpected texture residue'
                    assert len(after['releasedResources']) == 9
                    assert all(r['geometryDisposed'] and r['boneTextureDisposed']
                               for r in after['releasedResources'])
                    assert after['programs'] == 0, 'Shader program leak'
                    restored = await call('create')
                    assert restored['memory'] == row['cold']['memory'], 'Recreation resource growth'
                    cycle_result['recreated'] = restored
                await call('contextLoss')
                await page.wait_for_function("document.querySelector('canvas').getContext('webgl2').isContextLost()")
                await call('contextRestore')
                await page.wait_for_function("!document.querySelector('canvas').getContext('webgl2').isContextLost()")
                await call('step', 1/60)
                row['contextRestored'] = await call('snapshot')
                assert row['contextRestored']['glError'] == 0
                assert not row['contextRestored']['shaderErrors']
                await page.screenshot(path=str(output/f'restored-dpr-{dpr}.png'))
                if dpr == 1:
                    row['timing'] = await call('frames', 120)
                    values = sorted(r['intervalMs'] for r in row['timing']['rows'])
                    row['timing']['intervalSummaryMs'] = {'p50': values[len(values)//2], 'p95': values[int(len(values)*.95)], 'max': max(values)}
                await call('dispose')
                save()
                await context.close()
            await browser.close()
        assert not report['errors'], 'Browser errors occurred'
        report['status'] = 'passed'
        report['hardwareGpuAccepted'] = False  # Object counts are not GPU byte recovery or target-device acceptance.
        report['sources'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                             for p in [Path(__file__), HERE/'json_evidence.py', HERE/'browser-probe.html', HERE/'browser-probe.mjs',
                                       HERE.parent/'body-runtime/browser-host.mjs', HERE.parent/'body-runtime/pointer-host.mjs']}
    except Exception as error:
        report['status'] = 'failed'
        report['failure'] = repr(error)
        raise
    finally:
        save()
        server.shutdown()
    print(json.dumps({'report': str(output/'browser-report.json'), 'status': report['status']}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser', default='/usr/bin/chromium')
    parser.add_argument('--software', action='store_true')
    parser.add_argument('--headed', action='store_true')
    asyncio.run(run(parser.parse_args()))
