const COARSE_POINTER_QUERY = '(pointer: coarse)';
const LOW_CORE_COUNT = 2;

let cachedCapabilities = null;

function toBoolean(value) {
  return Boolean(value);
}

export function detectDevice() {
  if (cachedCapabilities) return cachedCapabilities;

  const coarsePointer = toBoolean(
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(COARSE_POINTER_QUERY).matches,
  );
  const touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
  const touchEvents = toBoolean(typeof window !== 'undefined' && 'ontouchstart' in window);
  const isTouch = coarsePointer || touchPoints > 0 || touchEvents;

  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 0 : 0;
  const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const lowPower = isTouch || (cores > 0 && cores <= LOW_CORE_COUNT);

  cachedCapabilities = { isTouch, lowPower, cores, pixelRatio, coarsePointer, touchPoints };
  return cachedCapabilities;
}
