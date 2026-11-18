// A front under pairs/<revision>/ has a sibling back. Other paths, including
// older cards, are front-only and do not need a storage lookup.
export function backPhotoPath(frontPath) {
  const match = /^([\w-]+\/pairs\/[\da-f-]{36})\/front\.(?:jpg|jpeg|png|webp)$/i.exec(frontPath || '');
  return match ? match[1] + '/back' : '';
}

function photoPaths(frontPath) {
  return [frontPath, backPhotoPath(frontPath)].filter(Boolean);
}

async function removeCardPhotos(bucket, paths) {
  if (!paths.length) return true;
  try {
    const { error } = await bucket.remove(paths);
    return !error;
  } catch {
    return false;
  }
}

export function removeStoredCard(bucket, frontPath) {
  return removeCardPhotos(bucket, photoPaths(frontPath));
}

function frontExtension(front, oldPath) {
  if (front) return front.type === 'image/webp' ? 'webp' : 'jpg';
  return /\.(jpeg|jpg|png|webp)$/i.exec(oldPath)?.[1].toLowerCase() || 'jpg';
}

// An undefined back keeps it, null removes it, and a Blob replaces it.
async function stageCardPhotos(bucket, { owner, previousFront = '', front, back }) {
  const previousBack = backPhotoPath(previousFront);
  if (!front && !previousFront) throw new Error('A front photo is required.');
  if (!front && (back === undefined || (!back && !previousBack))) {
    return { frontPath: previousFront, created: [], replaced: [] };
  }
  const paired = Boolean(back || (back === undefined && previousBack));
  const id = crypto.randomUUID();
  const filename = paired ? 'pairs/' + id + '/front' : id;
  const frontPath = owner + '/' + filename + '.' + frontExtension(front, previousFront);
  const created = [];
  async function write(path, blob, source) {
    const response = blob
      ? await bucket.upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false })
      : await bucket.copy(source, path);
    if (response.error) throw response.error;
    created.push(path);
  }
  try {
    await write(frontPath, front, previousFront);
    if (paired) await write(backPhotoPath(frontPath), back, previousBack);
  } catch (error) {
    await removeCardPhotos(bucket, created);
    throw error;
  }
  return { frontPath, created, replaced: photoPaths(previousFront) };
}

// Only retire the old objects after the row points to the staged revision.
// An ambiguous commit can still reference the new objects after a network
// failure. Check the row before deciding what is safe to remove.
export async function savePhotoRevision(client, { id, owner, previousFront, fields, front, back }) {
  const bucket = client.storage.from('card-images');
  const change = await stageCardPhotos(bucket, { owner, previousFront, front, back });
  const row = { ...fields, owner, image_path: change.frontPath };
  let response;
  try {
    const table = client.from('cards');
    const write = previousFront
      ? table.update(row).eq('id', id).eq('image_path', previousFront)
      : table.insert({ ...row, id });
    response = await write.select().single();
  } catch { /* A transport failure leaves the outcome unknown. */ }
  if (response?.error && response.status >= 400 && response.status < 500) {
    await removeCardPhotos(bucket, change.created);
    if (response.error.code === 'PGRST116' || response.error.code === '23505') {
      throw new Error('This card changed since you opened it. Reload the vault before editing it again.');
    }
    throw response.error;
  }
  let saved = response?.error ? null : response?.data;
  if (!saved) {
    try {
      const result = await client.from('cards').select('*').eq('id', id).maybeSingle();
      if (!result.error && result.data && Object.entries(row).every(([key, value]) => result.data[key] === value)) {
        saved = result.data;
      }
    } catch { /* Keep staged objects if the connection is still down. */ }
    if (!saved) throw new Error('Could not confirm the save. Reconnect and reload the vault to check the card before trying again.');
  }
  const cleaned = await removeCardPhotos(bucket, change.replaced);
  return { saved, cleaned };
}
