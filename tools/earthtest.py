import json, urllib.parse
from playwright.sync_api import sync_playwright
T="https://raw.githubusercontent.com/NASA-AMMOS/3DTilesSampleData/master/msl-dingo-gap/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_colorize/0528_0260184_to_s64o256_colorize_tileset.json"
facts={"facts":[{"name":"Charminar","fact":"(test fixture) Facts would appear here, each cited.","source":{"title":"test fixture","url":"https://example.org"}}]}
D="/tmp/claude-0/-home-claude/2818f404-a8d0-57da-866a-85ba3bd9e661/scratchpad/"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width":1440,"height":900}); logs=[]
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error","warning") else None); pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    pg.route("**/api/facts", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(facts)))
    pg.goto("http://localhost:4173/?tileset="+urllib.parse.quote(T,safe='')); pg.wait_for_timeout(3500)
    pg.click("button[data-mode=places]")
    pg.wait_for_timeout(16000)
    print("ground:", pg.evaluate("window.atlas.stage.earth.ground"), "tiles group children:", pg.evaluate("window.atlas.stage.earth.tiles ? window.atlas.stage.earth.tiles.group.children.length : -1"))
    pg.screenshot(path=D+"earth-photo.png")
    pg.click("button[data-look=hologram]"); pg.wait_for_timeout(2500)
    pg.screenshot(path=D+"earth-holo.png")
    for l in logs[-10:]: print(l)
    b.close()
