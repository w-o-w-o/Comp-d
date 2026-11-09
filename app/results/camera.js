// Camera helpers for the results map (requires a vector map for smooth,
// fractional zoom).

const METERS_PER_PIXEL_AT_ZOOM_0 = 156543.03;

function metersPerPixel(lat, zoom) {
  return (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

// Camera that fits a circle inside the part of the map not covered by floating
// panels. `inset` is the covered space on each side, in pixels.
export function cameraForCircle(map, position, radiusMeters, inset) {
  const { width, height } = map.getDiv().getBoundingClientRect();
  const freeWidth = Math.max(120, width - inset.left - inset.right);
  const freeHeight = Math.max(120, height - inset.top - inset.bottom);
  const fitPixels = Math.min(freeWidth, freeHeight);

  // 10% breathing room around the circle.
  const zoom = Math.log2(
    (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((position.lat * Math.PI) / 180) * fitPixels) /
      (2 * radiusMeters * 1.1)
  );
  const clampedZoom = Math.min(18, Math.max(3, zoom));

  // Shift the map center so the property sits in the middle of the free area.
  const mpp = metersPerPixel(position.lat, clampedZoom);
  const dx = (inset.left - inset.right) / 2;
  const dy = (inset.top - inset.bottom) / 2;
  return {
    center: {
      lat: position.lat + (dy * mpp) / 111320,
      lng: position.lng - (dx * mpp) / (111320 * Math.cos((position.lat * Math.PI) / 180)),
    },
    zoom: clampedZoom,
  };
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Smoothly moves the camera to `target` ({center, zoom}). Returns a cancel function.
export function animateCamera(map, target, durationMs, onDone) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const start = { center: map.getCenter().toJSON(), zoom: map.getZoom() };

  if (reduceMotion || durationMs <= 0) {
    map.moveCamera(target);
    onDone?.();
    return () => {};
  }

  let frame;
  const startTime = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - startTime) / durationMs);
    const e = easeInOutCubic(t);
    map.moveCamera({
      center: {
        lat: start.center.lat + (target.center.lat - start.center.lat) * e,
        lng: start.center.lng + (target.center.lng - start.center.lng) * e,
      },
      zoom: start.zoom + (target.zoom - start.zoom) * e,
    });
    if (t < 1) frame = requestAnimationFrame(step);
    else onDone?.();
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
