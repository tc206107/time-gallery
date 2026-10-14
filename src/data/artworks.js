import manifest from '../../manifest.json';

export const periods = manifest.periods;
export const artists = manifest.artists;
export const artworks = manifest.artworks;
export const periodsById = new Map(periods.map((period) => [period.id, period]));
export const artistsById = new Map(artists.map((artist) => [artist.id, artist]));

export default manifest;
