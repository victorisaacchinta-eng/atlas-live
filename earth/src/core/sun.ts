/**
 * Solar elevation at a point, from the NOAA general solar position
 * approximation (accurate to a fraction of a degree, plenty for "is the sun
 * up here and how high").
 */
export function solarElevation(lat: number, lon: number, when = new Date()): number {
  const rad = Math.PI / 180;
  const start = Date.UTC(when.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((when.getTime() - start) / 86_400_000);
  const hours = when.getUTCHours() + when.getUTCMinutes() / 60 + when.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMinutes = hours * 60 + eqTime + 4 * lon;
  const hourAngle = (trueSolarMinutes / 4 - 180) * rad;
  const cosZenith = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / rad;
}

export function sunPhrase(elevation: number): string {
  if (elevation > 6) return `Sun ${Math.round(elevation)}° up`;
  if (elevation > -0.83) return 'Sun on the horizon';
  if (elevation > -6) return 'Civil twilight';
  if (elevation > -12) return 'Nautical twilight';
  if (elevation > -18) return 'Astronomical twilight';
  return 'Night';
}
