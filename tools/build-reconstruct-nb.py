"""Builds tools/reconstruct.ipynb from the cells below (keeps the notebook diffable as Python)."""
import json, pathlib

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md(r"""
# ATLAS reconstruct: a landmark from public photos

Turns a few hundred Wikimedia Commons photos of a landmark into a Gaussian splat that ATLAS shows in Places
(the **Reconstruction** button), for landmarks where Google's 3D is coarse.

**Pipeline:** Commons photos → Structure from Motion (hloc: NetVLAD retrieval, SuperPoint + LightGlue, COLMAP mapper)
→ undistort → Gaussian splat training (gsplat, with a per-photo colour correction so different cameras, seasons and
times of day agree) → crop to the monument → `.splat` file.

**How to run:** Runtime → Change runtime type → **T4 GPU**. Pick the landmark in the settings cell, then Runtime → **Run all**.
About 40 minutes. The last cell downloads `<landmark>.splat` and `<landmark>.credits.json`.
""")

code(r"""
#@title Install (about 3 minutes; skipped if already done)
import os, sys, subprocess
if not os.path.exists('/content/.atlas_ready'):
    subprocess.run('nvidia-smi -L', shell=True)
    subprocess.run('git clone --recursive -q https://github.com/cvg/Hierarchical-Localization /content/hloc', shell=True, check=True)
    subprocess.run('pip install -q -e /content/hloc', shell=True, check=True)
    import torch
    pt = ''.join(torch.__version__.split('+')[0].split('.')[:2])
    cu = (torch.version.cuda or '').replace('.', '')
    # Prebuilt gsplat for this torch/CUDA if there is one, otherwise it compiles on first use (about 8 minutes).
    subprocess.run(f'pip install -q ninja gsplat==1.5.3 --extra-index-url https://docs.gsplat.studio/whl/pt{pt}cu{cu}', shell=True, check=True)
    open('/content/.atlas_ready', 'w').close()
sys.path.insert(0, '/content/hloc')
print('ready')
""")

code(r"""
#@title Settings
LANDMARK = 'taj'  #@param ['taj', 'charminar', 'india-gate', 'gateway']
MAX_PHOTOS = 220  #@param {type:'integer'}
STEPS = 25000     #@param {type:'integer'}
MAX_SPLATS = 500000  #@param {type:'integer'}
# Keep photo matching in Google Drive so a retrain skips the slow part (about an hour).
USE_DRIVE = True  #@param {type:'boolean'}
# Crop: keep everything within this many "camera distances" of the monument's centre (1.0 = a typical photo's distance).
CROP = 0.55       #@param {type:'number'}

PRESETS = {
    'taj': dict(queries=['Taj Mahal', 'Taj Mahal Agra', 'Taj Mahal exterior', 'Taj Mahal view', 'Taj Mahal from'],
                drop=r'bibi|trump|mumbai|palace hotel|taj hotel|lake palace|tajmahal hotel|mehtab bagh garden|agra fort|itimad'),
    'charminar': dict(queries=['Charminar', 'Charminar Hyderabad', 'Char Minar'],
                      drop=r'golconda|chowmahalla|mecca masjid|qutb|falaknuma|laad|bazaar interior'),
    'india-gate': dict(queries=['India Gate', 'India Gate New Delhi', 'India Gate Delhi'],
                       drop=r'gateway of india|amar jawan jyoti flame|war memorial museum'),
    'gateway': dict(queries=['Gateway of India', 'Gateway of India Mumbai'], drop=r'india gate|delhi|taj mahal palace interior'),
}
# Shots that never help a whole-building reconstruction: interiors, close details, artwork, panoramas, night, old prints.
DROP_ALWAYS = (r'interior|inside|cenotaph|calligraph|inlay|detail|close[- ]?up|flowers|marble work|carving|map|plan\b|drawing|'
               r'painting|sketch|engraving|lithograph|stamp|coin|logo|replica|model|miniature|night|ceiling|door|jali|museum|'
               r'ticket|selfie|wedding|poster|panorama|360|\b1[89]\d\d\b|\b19[0-6]\d\b|album|postcard|souvenir|svg')
P = PRESETS[LANDMARK]

import os, shutil, pathlib
WORK = pathlib.Path(f'/content/work/{LANDMARK}'); IMAGES = WORK / 'images'
SFM = WORK / 'sfm'
SAVED = None
if USE_DRIVE:
    from google.colab import drive
    drive.mount('/content/drive')
    SAVED = pathlib.Path(f'/content/drive/MyDrive/atlas-reconstruct/{LANDMARK}')
    if (SAVED / 'sfm' / 'images.bin').exists() and not SFM.exists():
        print('Restoring photos and matching from Drive: steps 1 and 2 will be skipped')
        shutil.copytree(SAVED, WORK, dirs_exist_ok=True)
CACHED = (SFM / 'images.bin').exists()
""")

code(r"""
#@title 1 · Photos from Wikimedia Commons (skipped when restored from Drive)
import re, json, time, html, requests
from io import BytesIO
from PIL import Image, ImageOps

def fetch_photos():
    IMAGES.mkdir(parents=True, exist_ok=True)
    S = requests.Session()
    S.headers['User-Agent'] = 'ATLAS-Live-reconstruction/1.0 (https://github.com/victorisaacchinta-eng/atlas-live)'
    def get(url, **kw):
        for attempt in range(6):
            r = S.get(url, timeout=60, **kw)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(2 + attempt * 4); continue
            r.raise_for_status(); return r
        r.raise_for_status()
    drop = re.compile(DROP_ALWAYS + '|' + P['drop'], re.I)
    found = {}
    for term in P['queries']:
        cont = {}
        for _ in range(6):
            q = dict(action='query', format='json', generator='search', gsrsearch=term + ' filetype:bitmap', gsrnamespace=6,
                     gsrlimit=50, prop='imageinfo', iiprop='url|size|mime|extmetadata', iiurlwidth=1600, **cont)
            j = get('https://commons.wikimedia.org/w/api.php', params=q).json()
            for pg in (j.get('query', {}).get('pages', {}) or {}).values():
                ii = (pg.get('imageinfo') or [{}])[0]; meta = ii.get('extmetadata', {})
                lic = meta.get('LicenseShortName', {}).get('value', '')
                title = pg['title']
                if ii.get('mime') != 'image/jpeg' or min(ii.get('width', 0), ii.get('height', 0)) < 900: continue
                if drop.search(title) or not re.search(r'CC|Public domain|PD', lic, re.I): continue
                artist = re.sub('<[^>]+>', '', html.unescape(meta.get('Artist', {}).get('value', 'unknown'))).strip()
                found[title] = dict(title=title, url=ii.get('thumburl') or ii['url'], page=ii.get('descriptionurl'),
                                    author=artist[:120], license=lic, licenseUrl=meta.get('LicenseUrl', {}).get('value', ''),
                                    pixels=ii['width'] * ii['height'])
            if 'continue' not in j: break
            cont = j['continue']; time.sleep(0.5)
    print(len(found), 'candidate photos')
    # Larger originals first: they are usually deliberate photographs rather than snapshots.
    picked = sorted(found.values(), key=lambda f: -f['pixels'])[:MAX_PHOTOS]
    out = []
    for i, f in enumerate(picked):
        name = f'{i:04d}.jpg'
        if not (IMAGES / name).exists():
            try:
                im = ImageOps.exif_transpose(Image.open(BytesIO(get(f['url']).content))).convert('RGB')
            except Exception as e:
                print('skip', f['title'], e); continue
            im.thumbnail((1600, 1600)); im.save(IMAGES / name, quality=93)
            time.sleep(0.3)
        out.append({**{k: f[k] for k in ('title', 'page', 'author', 'license', 'licenseUrl')}, 'file': name})
    (WORK / 'credits_all.json').write_text(json.dumps(out, indent=1))
    return out

if CACHED and (WORK / 'credits_all.json').exists():
    credits = json.loads((WORK / 'credits_all.json').read_text())
    print(len(credits), 'photos restored from Drive')
else:
    credits = fetch_photos()
    print(len(credits), 'photos downloaded')
""")

code(r"""
#@title 2 · Structure from Motion (hloc · about an hour; skipped when restored from Drive)
import pycolmap
if not CACHED:
    from hloc import extract_features, match_features, pairs_from_retrieval, reconstruction
    OUT = WORK / 'hloc'
    pairs = OUT / 'pairs-netvlad.txt'
    retrieval = extract_features.main(extract_features.confs['netvlad'], IMAGES, OUT)
    pairs_from_retrieval.main(retrieval, pairs, num_matched=min(30, len(credits) - 1))
    fconf = extract_features.confs['superpoint_max']
    features = extract_features.main(fconf, IMAGES, OUT)
    matches = match_features.main(match_features.confs['superpoint+lightglue'], pairs, fconf['output'], OUT)
    model = reconstruction.main(SFM, IMAGES, pairs, features, matches, camera_mode=pycolmap.CameraMode.PER_IMAGE)
    print(model.summary())
    if SAVED:   # keep the slow part: photos, credits and the matched cameras (not the big feature files)
        for sub in ('images', 'sfm'):
            shutil.copytree(WORK / sub, SAVED / sub, dirs_exist_ok=True)
        shutil.copy(WORK / 'credits_all.json', SAVED / 'credits_all.json')
        print('Saved to Drive: a retrain will skip steps 1 and 2')
nreg = len(pycolmap.Reconstruction(str(SFM)).images)
print(nreg, 'photos placed in 3D')
assert nreg >= 25, 'Too few photos registered: try more photos or different search terms.'
""")

code(r"""
#@title 3 · Undistort, align (up = up, monument at the centre), load
import numpy as np, torch, torch.nn.functional as F
UND = WORK / 'undistorted'
if not (UND / 'sparse').exists():
    pycolmap.undistort_images(str(UND), str(SFM), str(IMAGES))
rec = pycolmap.Reconstruction(str(UND / 'sparse'))

def pose(im):
    c = im.cam_from_world() if callable(im.cam_from_world) else im.cam_from_world
    m = np.asarray(c.matrix()); return m[:, :3], m[:, 3]

ims = sorted(rec.images.values(), key=lambda im: im.name)
Rs, ts = zip(*[pose(im) for im in ims]); Rs, ts = np.array(Rs), np.array(ts)
centres = np.einsum('nji,nj->ni', Rs, -ts)          # camera centres  C = -R^T t
fwd = Rs[:, 2, :]                                    # optical axes (OpenCV +z) in world
up = -Rs[:, 1, :].mean(0); up /= np.linalg.norm(up)  # cameras are held roughly level: their mean "up"

# The monument is what the photos look at: the point closest to every optical axis.
A = np.zeros((3, 3)); b = np.zeros(3)
for c, d in zip(centres, fwd):
    M = np.eye(3) - np.outer(d, d); A += M; b += M @ c
target = np.linalg.solve(A, b)
dist = np.linalg.norm(centres - target, axis=1)
scale = 1.0 / np.median(dist)

# Rotate world "up" onto -y (OpenCV-style, which is what ATLAS's splat loader expects), keep it a proper rotation.
y = -up; x = np.cross(y, [0, 0, 1.0]) if abs(y[2]) < 0.9 else np.cross(y, [1.0, 0, 0]); x /= np.linalg.norm(x)
z = np.cross(x, y); R0 = np.stack([x, y, z])          # rows: new axes expressed in old coordinates
def to_new(p): return scale * (np.asarray(p) - target) @ R0.T

pts = np.array([p.xyz for p in rec.points3D.values()]); cols = np.array([p.color for p in rec.points3D.values()]) / 255.0
pts = to_new(pts)

LONG = 1280
dev = 'cuda'
images, viewmats, Ks = [], [], []
for im, R, t in zip(ims, Rs, ts):
    cam = rec.cameras[im.camera_id]
    Rn = R @ R0.T; tn = scale * (R @ target + t)     # world→camera in the new frame
    V = np.eye(4); V[:3, :3] = Rn; V[:3, 3] = tn
    img = Image.open(UND / 'images' / im.name).convert('RGB')
    f = min(1.0, LONG / max(img.size)); w, h = round(img.width * f), round(img.height * f)
    K = np.asarray(cam.calibration_matrix()).copy(); K[0] *= w / img.width; K[1] *= h / img.height
    images.append(torch.from_numpy(np.asarray(img.resize((w, h), Image.LANCZOS))).to(dev))
    viewmats.append(torch.tensor(V, dtype=torch.float32, device=dev)); Ks.append(torch.tensor(K, dtype=torch.float32, device=dev))
used = {im.name for im in ims}
print(len(images), 'posed photos,', len(pts), 'sparse points')

import matplotlib.pyplot as plt
cn = to_new(centres)
plt.figure(figsize=(6, 6)); plt.scatter(pts[:, 0], pts[:, 2], s=0.3, c=cols); plt.scatter(cn[:, 0], cn[:, 2], s=8, c='r', marker='^')
plt.gca().add_patch(plt.Circle((0, 0), CROP, fill=False, ls='--')); plt.axis('equal'); plt.xlim(-2, 2); plt.ylim(-2, 2)
plt.title('Top view: points, cameras (red), crop (dashed)'); plt.show()
""")

code(r"""
#@title 4 · Train the splat (about 45 minutes)
import math, random
from tqdm.auto import tqdm
from gsplat import rasterization, DefaultStrategy
from gsplat.strategy.ops import reset_opa

N0 = len(pts)
means = torch.tensor(pts, dtype=torch.float32, device=dev)
d2 = torch.cat([torch.cdist(means[i:i + 2048], means).topk(4, largest=False).values[:, 1:] for i in range(0, N0, 2048)])
scales0 = torch.log(d2.mean(1).clamp_min(1e-4)).unsqueeze(1).repeat(1, 3)
C0 = 0.28209479177387814
params = torch.nn.ParameterDict({
    'means': torch.nn.Parameter(means),
    'scales': torch.nn.Parameter(scales0),
    'quats': torch.nn.Parameter(torch.tensor([[1.0, 0, 0, 0]], device=dev).repeat(N0, 1)),
    'opacities': torch.nn.Parameter(torch.logit(torch.full((N0,), 0.1, device=dev))),
    'sh0': torch.nn.Parameter(((torch.tensor(cols, dtype=torch.float32, device=dev) - 0.5) / C0).unsqueeze(1)),
})
scene_scale = 1.1 * float(np.percentile(np.linalg.norm(cn, axis=1), 90))
lrs = dict(means=1.6e-4 * scene_scale, scales=5e-3, quats=1e-3, opacities=5e-2, sh0=2.5e-3)
opts = {k: torch.optim.Adam([{'params': params[k], 'lr': lr, 'name': k}], eps=1e-15) for k, lr in lrs.items()}
sched = torch.optim.lr_scheduler.ExponentialLR(opts['means'], gamma=0.01 ** (1.0 / STEPS))
# Per-photo colour correction (3x3 + offset): absorbs exposure, white balance, season and time of day.
appear = torch.nn.Parameter(torch.cat([torch.eye(3), torch.zeros(3, 1)], 1).repeat(len(images), 1, 1).to(dev))
opt_app = torch.optim.Adam([appear], lr=5e-4)

# A lower growth threshold than the default gives more, smaller splats: sharper marble, fewer blobs.
strategy = DefaultStrategy(refine_stop_iter=int(STEPS * 0.5), refine_every=100, grow_grad2d=0.00012, verbose=False)
strategy.check_sanity(params, opts)
state = strategy.initialize_state(scene_scale=scene_scale)

def ssim(a, b):
    g = torch.exp(-(torch.arange(11, device=dev) - 5.0) ** 2 / 4.5); g = (g / g.sum()); w = (g[:, None] * g[None]).expand(3, 1, 11, 11)
    f = lambda x: F.conv2d(x, w, padding=5, groups=3)
    ma, mb = f(a), f(b); va, vb, cov = f(a * a) - ma ** 2, f(b * b) - mb ** 2, f(a * b) - ma * mb
    return (((2 * ma * mb + 1e-4) * (2 * cov + 9e-4)) / ((ma ** 2 + mb ** 2 + 1e-4) * (va + vb + 9e-4))).mean()

def render(V, K, w, h):
    return rasterization(params['means'], F.normalize(params['quats'], dim=-1), torch.exp(params['scales']),
                         torch.sigmoid(params['opacities']), params['sh0'], V[None], K[None], w, h, sh_degree=0, packed=False)

MAX_TRAIN = 1_500_000
bar = tqdm(range(STEPS))
for step in bar:
    i = random.randrange(len(images)); gt = images[i].float() / 255; h, w = gt.shape[:2]
    out, alpha, info = render(viewmats[i], Ks[i], w, h)
    strategy.step_pre_backward(params, opts, state, step, info)
    img = out[0] @ appear[i][:, :3].T + appear[i][:, 3]
    err = (img - gt).abs()
    if step > 2000:   # people, scaffolding, cars: ignore the worst-explained 8% of pixels in each photo
        e = err.mean(-1); err = err * (e < torch.quantile(e.flatten()[::7], 0.92)).unsqueeze(-1)
    loss = 0.8 * err.mean() + 0.2 * (1 - ssim(img.permute(2, 0, 1)[None], gt.permute(2, 0, 1)[None]))
    loss = loss + 1e-2 * (appear[i][:, :3] - torch.eye(3, device=dev)).abs().mean()
    # No needles: a splat's longest axis may be at most 4x its second axis (flat discs are fine).
    sv = torch.exp(params['scales']).sort(dim=1, descending=True).values
    loss = loss + 0.02 * torch.relu(sv[:, 0] / sv[:, 1].clamp_min(1e-8) - 4).mean()
    loss.backward()
    for o in opts.values(): o.step(); o.zero_grad(set_to_none=True)
    opt_app.step(); opt_app.zero_grad(set_to_none=True); sched.step()
    strategy.step_post_backward(params, opts, state, step, info, packed=False)
    if len(params['means']) > MAX_TRAIN: strategy.refine_stop_iter = step
    # gsplat 1.5.3 never resets opacity (an operator precedence slip), so do it here: this is what clears floaters.
    if 0 < step < strategy.refine_stop_iter and step % 3000 == 0:
        reset_opa(params=params, optimizers=opts, state=state, value=0.01)
    if step % 200 == 0: bar.set_postfix(loss=f'{loss.item():.3f}', splats=len(params['means']))
print(len(params['means']), 'splats')
""")

code(r"""
#@title 5 · Crop to the monument, preview, export .splat
with torch.no_grad():
    m = params['means']; op = torch.sigmoid(params['opacities']); sc = torch.exp(params['scales']).max(1).values
    horiz = torch.linalg.norm(m[:, [0, 2]], dim=1)
    keep = (horiz < CROP) & (op > 0.04) & (sc < CROP * 0.15)
    hy = m[keep, 1]
    lo, hi = torch.quantile(hy[::max(1, len(hy) // 200000)], torch.tensor([0.001, 0.999], device=dev))  # y is down
    keep &= (m[:, 1] > lo) & (m[:, 1] < hi)
    # Splats under the platform are the reflecting pool's mirror image: cut below the ground.
    ground = torch.quantile(m[keep, 1][::max(1, int(keep.sum()) // 200000)], 0.97)
    keep &= m[:, 1] < ground + 0.02
    # Sky-coloured specks and near-invisible haze.
    rgb = (0.5 + C0 * params['sh0'][:, 0]).clamp(0, 1)
    keep &= ~((rgb[:, 2] - rgb[:, 0] > 0.07) & (rgb[:, 2] >= rgb[:, 1])) & (op > 0.1)
    idx = keep.nonzero().squeeze(1)
    vol = torch.exp(params['scales'][idx]).prod(1) * op[idx]
    idx = idx[vol.argsort(descending=True)][:MAX_SPLATS]
print(len(idx), 'splats kept')

def look(az, el, d=1.0, w=800, h=600, fov=50):
    upw = np.array([0, -1.0, 0]); c = d * np.array([math.cos(el) * math.cos(az), 0, math.cos(el) * math.sin(az)]) + d * math.sin(el) * upw
    f = -c / np.linalg.norm(c); r = np.cross(f, upw); r /= np.linalg.norm(r); dn = np.cross(f, r)
    R = np.stack([r, dn, f]); V = np.eye(4); V[:3, :3] = R; V[:3, 3] = -R @ c
    fl = 0.5 * w / math.tan(math.radians(fov) / 2); K = np.array([[fl, 0, w / 2], [0, fl, h / 2], [0, 0, 1]])
    return torch.tensor(V, dtype=torch.float32, device=dev), torch.tensor(K, dtype=torch.float32, device=dev)

with torch.no_grad():
    sel = {k: v[idx] for k, v in params.items()}
    fig, axs = plt.subplots(2, 3, figsize=(18, 9))
    for ax, az in zip(axs.flat, np.linspace(0, 2 * math.pi, 6, endpoint=False)):
        V, K = look(az, math.radians(18), d=CROP * 2.4)
        o, _, _ = rasterization(sel['means'], F.normalize(sel['quats'], dim=-1), torch.exp(sel['scales']), torch.sigmoid(sel['opacities']),
                                sel['sh0'], V[None], K[None], 800, 600, sh_degree=0, packed=False, backgrounds=torch.ones(1, 3, device=dev))
        ax.imshow(o[0].clamp(0, 1).cpu().numpy()); ax.axis('off')
    plt.tight_layout(); plt.show()

    # .splat: per splat 32 bytes: position f32x3, scale f32x3, RGBA u8x4, rotation u8x4 (w,x,y,z).
    pos = sel['means'].cpu().numpy().astype(np.float32)
    sv = torch.exp(sel['scales'])
    # Clamp what survived: no needles longer than 4x their second axis, no soft blobs.
    order = sv.argsort(dim=1, descending=True); srt = sv.gather(1, order)
    srt[:, 0] = torch.minimum(srt[:, 0], 4 * srt[:, 1]); srt = srt.clamp_max(CROP * 0.022)
    sv = torch.empty_like(sv).scatter_(1, order, srt)
    scl = sv.cpu().numpy().astype(np.float32)
    rgb = (0.5 + C0 * sel['sh0'][:, 0]).clamp(0, 1)
    rgba = (torch.cat([rgb, torch.sigmoid(sel['opacities'])[:, None]], 1) * 255).round().byte().cpu().numpy()
    q = F.normalize(sel['quats'], dim=-1)
    rot = (q * 128 + 128).clamp(0, 255).byte().cpu().numpy()
    rec_t = np.zeros(len(pos), dtype=[('p', '<f4', 3), ('s', '<f4', 3), ('c', 'u1', 4), ('r', 'u1', 4)])
    rec_t['p'], rec_t['s'], rec_t['c'], rec_t['r'] = pos, scl, rgba, rot
    out = WORK / f'{LANDMARK}.splat'; out.write_bytes(rec_t.tobytes())
    cred = [c for c in credits if c['file'] in used]
    (WORK / f'{LANDMARK}.credits.json').write_text(json.dumps({'landmark': LANDMARK, 'photos': len(cred), 'splats': len(pos), 'sources': cred}, indent=1))
print(out, round(out.stat().st_size / 1e6, 1), 'MB from', len(cred), 'photos')
""")

md(r"""
If the previews show sky blobs or neighbouring buildings, lower `CROP` in the settings cell and re-run **only cell 5**.
If the monument is cut off, raise it. Then download:
""")

code(r"""
#@title 6 · Download
from google.colab import files
files.download(str(WORK / f'{LANDMARK}.splat'))
files.download(str(WORK / f'{LANDMARK}.credits.json'))
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"gpuType": "T4", "provenance": []},
      "kernelspec": {"display_name": "Python 3", "name": "python3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}
for c in nb["cells"]:
    c["source"] = c["source"].splitlines(keepends=True)
pathlib.Path(__file__).with_name('reconstruct.ipynb').write_text(json.dumps(nb, indent=1))
print('wrote reconstruct.ipynb with', len(cells), 'cells')
