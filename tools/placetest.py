import json, pathlib
from playwright.sync_api import sync_playwright
SHOTS = pathlib.Path(__file__).resolve().parent / "shots"
SHOTS.mkdir(exist_ok=True)
fx=open('tools/fixtures/place-charminar.json').read()
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width":1440,"height":900}); logs=[]
    pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    pg.route("**/api/place", lambda r: r.fulfill(status=200, content_type="application/json", body=fx))
    pg.goto("http://localhost:4173/"); pg.wait_for_timeout(3500)
    pg.click("button[data-mode=places]"); pg.wait_for_timeout(600)
    pg.screenshot(path=str(SHOTS / "place0.png"))
    pg.click("#place-picks button >> nth=0"); pg.wait_for_timeout(5000)
    pg.fill("#sun-time","16.5"); pg.dispatch_event("#sun-time","input"); pg.wait_for_timeout(500)
    pg.evaluate("window.atlas.setExplode(0.6)"); pg.wait_for_timeout(2500)
    pg.evaluate("window.atlas.focusPart(1)"); pg.wait_for_timeout(2000)
    pg.screenshot(path=str(SHOTS / "place1.png"))
    print(pg.text_content("#parts-n"), pg.text_content("#card-title"), logs)
    b.close()
