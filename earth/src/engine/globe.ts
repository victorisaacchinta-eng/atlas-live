import {
  CesiumWidget,
  Color,
  EllipsoidTerrainProvider,
  JulianDate,
  SkyAtmosphere,
  SkyBox,
  ScreenSpaceEventType,
  type TerrainProvider,
} from 'cesium';

export interface GlobeOptions {
  container: HTMLElement;
  creditContainer: HTMLElement;
  terrain: TerrainProvider | null;
  reducedMotion: boolean;
  onFatal?: (message: string) => void;
  /** Start in the low-cost profile (no MSAA, lower resolution). */
  lowQuality?: boolean;
}

/**
 * Creates the Cesium scene with the planetary look the brief asks for:
 * real sun position from the clock, day/night terminator, atmospheric
 * scattering on the limb and the ground, the Tycho-2 star catalogue skybox,
 * and no default Cesium chrome (the app draws its own controls).
 */
export function createGlobe(opts: GlobeOptions): CesiumWidget {
  const widget = new CesiumWidget(opts.container, {
    baseLayer: false,
    terrainProvider: opts.terrain ?? new EllipsoidTerrainProvider(),
    creditContainer: opts.creditContainer,
    skyBox: SkyBox.createEarthSkyBox(),
    skyAtmosphere: new SkyAtmosphere(),
    useBrowserRecommendedResolution: true,
    msaaSamples: opts.lowQuality ? 1 : 4,
    requestRenderMode: false,
    showRenderLoopErrors: false,
  });

  const { scene, clock } = widget;
  const globe = scene.globe;

  // Real time, real sun. The terminator on screen is the actual one.
  clock.currentTime = JulianDate.now();
  clock.shouldAnimate = true;
  clock.multiplier = 1;

  globe.enableLighting = true;
  globe.dynamicAtmosphereLighting = true;
  globe.dynamicAtmosphereLightingFromSun = true;
  globe.showGroundAtmosphere = true;
  // Keep the sun's shading (and so the night-side city lights) on from orbit.
  // Cesium's defaults fade lighting out beyond about 20,000 km.
  globe.lightingFadeOutDistance = 6.5e7;
  globe.lightingFadeInDistance = 9e7;
  globe.nightFadeOutDistance = 6.5e7;
  globe.nightFadeInDistance = 9e7;
  globe.atmosphereLightIntensity = 12;
  globe.baseColor = Color.fromCssColorString('#0b1a2a');
  globe.depthTestAgainstTerrain = true;
  globe.maximumScreenSpaceError = 1.6;
  globe.tileCacheSize = 300;
  globe.preloadSiblings = false;
  globe.showWaterEffect = false;

  scene.fog.enabled = true;
  scene.fog.density = 2.0e-4;
  if (scene.skyAtmosphere) {
    scene.skyAtmosphere.atmosphereLightIntensity = 14;
  }
  scene.highDynamicRange = false;
  scene.backgroundColor = Color.fromCssColorString('#04060a');
  if (scene.sun) scene.sun.glowFactor = 0.6;
  if (scene.moon) scene.moon.show = true;

  const ctl = scene.screenSpaceCameraController;
  ctl.minimumZoomDistance = 80;
  ctl.maximumZoomDistance = 60_000_000;
  ctl.inertiaSpin = opts.reducedMotion ? 0 : 0.9;
  ctl.inertiaTranslate = opts.reducedMotion ? 0 : 0.9;
  ctl.inertiaZoom = opts.reducedMotion ? 0 : 0.8;
  ctl.enableCollisionDetection = true;

  // Cesium's default double-click tracks entities; the app handles it.
  widget.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  // Cesium stops its render loop on any error. Restart it a few times, so a
  // single bad tile or texture cannot freeze the globe, then give up loudly.
  let restarts = 0;
  scene.renderError.addEventListener((_scene, error) => {
    console.error('Render error', error);
    if (restarts++ < 3) {
      setTimeout(() => {
        widget.useDefaultRenderLoop = true;
      }, 500);
    } else {
      opts.onFatal?.(error instanceof Error ? error.message : String(error));
    }
  });

  if (opts.lowQuality) applyLowQuality(widget);
  else watchFrameRate(widget);

  return widget;
}

function applyLowQuality(widget: CesiumWidget): void {
  widget.resolutionScale = 0.75;
  widget.scene.globe.maximumScreenSpaceError = 2.6;
  widget.scene.fog.screenSpaceErrorFactor = 4;
  widget.scene.postProcessStages.fxaa.enabled = false;
}

/**
 * Adaptive quality: if the first few seconds after load render slower than
 * about 22 frames a second, drop to the low-cost profile once. Laptops with
 * integrated graphics and phones keep a responsive globe this way.
 */
function watchFrameRate(widget: CesiumWidget): void {
  const samples: number[] = [];
  let last = 0;
  let started = 0;
  const remove = widget.scene.postRender.addEventListener(() => {
    const now = performance.now();
    if (!started) started = now + 4000; // let the first tiles arrive
    if (now < started) {
      last = now;
      return;
    }
    if (last) samples.push(now - last);
    last = now;
    if (samples.length >= 90) {
      remove();
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median > 45) applyLowQuality(widget);
    }
  });
}
