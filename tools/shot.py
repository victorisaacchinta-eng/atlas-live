import sys, time
from playwright.sync_api import sync_playwright
url = sys.argv[1]; out = sys.argv[2]; script = sys.argv[3] if len(sys.argv) > 3 else ''
w = int(sys.argv[4]) if len(sys.argv) > 4 else 1440; h = int(sys.argv[5]) if len(sys.argv) > 5 else 900
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs = []
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    pg.goto(url); pg.wait_for_timeout(7000)
    if script:
        pg.evaluate(script); pg.wait_for_timeout(3500)
    pg.screenshot(path=out)
    for l in logs[-15:]: print(l)
    b.close()
