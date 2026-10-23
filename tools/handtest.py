import pathlib
from playwright.sync_api import sync_playwright
SHOTS = pathlib.Path(__file__).resolve().parent / "shots"
SHOTS.mkdir(exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"])
    ctx = b.new_context(viewport={"width":1440,"height":900}, permissions=["camera"])
    pg = ctx.new_page(); logs=[]
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}")); pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    pg.goto("http://localhost:4173/"); pg.wait_for_timeout(5000)
    pg.click("#hands-btn"); pg.wait_for_timeout(12000)
    print("caption:", pg.text_content("#cam-caption"), "| btn:", pg.text_content("#hands-label"))
    pg.screenshot(path=str(SHOTS / "hands.png"))
    for l in logs[-12:]: print(l)
    b.close()
