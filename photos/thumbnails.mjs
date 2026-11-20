import { thumbnailPath } from './storage.mjs';

/**
 * Creates missing gallery thumbnails one at a time, at most once per photo per
 * page load. Used when the signed-in owner's gallery finds a card saved before
 * thumbnails existed.
 * @param {{ fetchPhoto: (path: string) => Promise<Blob>, makeThumbnail: (blob: Blob) => Promise<Blob | null>, upload: (path: string, blob: Blob) => Promise<void> }} deps
 */
export function createThumbnailBackfill({ fetchPhoto, makeThumbnail, upload }) {
  const requested = new Set();
  let queue = Promise.resolve();
  return function backfill(frontPath) {
    const path = thumbnailPath(frontPath);
    if (!path || requested.has(path)) return queue;
    requested.add(path);
    queue = queue.then(async () => {
      try {
        const thumbnail = await makeThumbnail(await fetchPhoto(frontPath));
        if (thumbnail) await upload(path, thumbnail);
      } catch {
        // Best effort: the gallery keeps showing the full photo.
      }
    });
    return queue;
  };
}
