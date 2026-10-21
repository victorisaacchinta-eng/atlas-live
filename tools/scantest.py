import json, time
from playwright.sync_api import sync_playwright
fake = {"object": "Pratt & Whitney JT8D turbofan (test rig)", "category": "Jet engine", "summary": "A low-bypass turbofan that powered 727s and DC-9s, mounted in a NASA altitude test chamber.",
  "object_box": [0.226, 0.22, 0.95, 0.64],
  "parts": [
    {"name": "Inlet duct", "role": "Guides air smoothly into the fan", "box": [0.23, 0.44, 0.40, 0.60]},
    {"name": "Fan case", "role": "Houses the front fan that moves most of the air", "box": [0.39, 0.43, 0.52, 0.61]},
    {"name": "Compressor and accessories", "role": "Squeezes air; gearbox drives fuel and oil pumps", "box": [0.51, 0.42, 0.66, 0.62]},
    {"name": "Combustor section", "role": "Burns fuel in the squeezed air", "box": [0.645, 0.41, 0.71, 0.62]},
    {"name": "Turbine and exhaust", "role": "Hot gas spins the turbine, then leaves as thrust", "box": [0.70, 0.40, 0.95, 0.60]},
    {"name": "Test mount", "role": "Holds the engine from above in the chamber", "box": [0.40, 0.22, 0.67, 0.42]}], "model": "test fixture (hand labelled)"}
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width":1440,"height":900}); logs=[]
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}")); pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    pg.route("**/api/scan", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(fake)))
    pg.goto("http://localhost:4173/"); pg.wait_for_timeout(4000)
    pg.click("button[data-mode=scan]"); pg.wait_for_timeout(500)
    pg.set_input_files("#scan-file", "tools/fixtures/engine.jpg")
    t0=time.time()
    for i in range(150):
        pg.wait_for_timeout(1000)
        st = pg.text_content("#scan-status")
        if "turbofan" in (pg.text_content("#model-title") or "").lower(): break
    print("took", round(time.time()-t0), "s | status:", st, "| parts:", pg.text_content("#parts-n"))
    pg.wait_for_timeout(5000)
    pg.screenshot(path="/tmp/claude-0/-home-claude/2818f404-a8d0-57da-866a-85ba3bd9e661/scratchpad/scan1.png")
    pg.evaluate("window.atlas.focusPart(4)"); pg.wait_for_timeout(2500)
    pg.screenshot(path="/tmp/claude-0/-home-claude/2818f404-a8d0-57da-866a-85ba3bd9e661/scratchpad/scan2.png")
    for l in [l for l in logs if 'error' in l.lower()][-8:]: print(l)
    b.close()
