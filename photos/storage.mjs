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
    if (!blob) {
      // Preserve the saved side byte-for-byte using the same owner-scoped upload as a new photo.
      const { data, error } = await bucket.download(source);
      if (error) throw error;
      blob = data;
    }
    const { error } = await bucket.upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (error) throw error;
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
export async function savePhotoRevision(client, { id, owner, previousFront, previousCard, fields, front, back, purchase }) {
  const bucket = client.storage.from('card-images');
  const change = await stageCardPhotos(bucket, { owner, previousFront, front, back });
  const row = { ...fields, owner, image_path: change.frontPath };
  async function writeRow() {
    if (purchase) {
      return client.rpc('vault_save_card_purchase', {
        card_data: {...row, id}, previous_card: previousCard || (previousFront ? {image_path:previousFront} : null), purchase,
      }).single();
    }
    const table = client.from('cards');
    const write = previousFront
      ? table.update(row).eq('id', id).eq('image_path', previousFront)
      : table.insert({...row, id});
    return write.select().single();
  }

  async function readCommitted() {
    const result = await client.from('cards').select('*').eq('id', id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return null;
    if (!Object.entries(row).every(([key,value]) => result.data[key] === value)) return null;
    if (purchase) {
      const receipt = await client.from('vault_card_purchases').select('revision').eq('card_id', id).maybeSingle();
      if (receipt.error) throw receipt.error;
      if (receipt.data?.revision !== purchase.revision) return null;
    }
    return result.data;
  }

  async function commit(retry = false) {
    // A retry uses the original row ID, private revision and uploaded paths.
    // It can acknowledge a lost reply or submit the very same insert again.
    let saved = retry ? await readCommitted() : null;
    if (!saved) {
      let response;
      try { response = await writeRow(); } catch { /* The server may have committed. */ }
      const duplicate = response?.error?.code === '23505';
      if (response?.error && response.status >= 400 && response.status < 500 && !(retry && duplicate)) {
        if (!retry) await removeCardPhotos(bucket, change.created);
        if (response.error.code === 'PGRST116' || duplicate) {
          throw new Error('This card changed since you opened it. Reload the vault before editing it again.');
        }
        throw response.error;
      }
      saved = response?.error ? null : response?.data;
      if (!saved) {
        try { saved = await readCommitted(); } catch { /* Retain staged files while the result is unknown. */ }
      }
      if (!saved) {
        /** @type {Error & { retrySave?: () => Promise<{ saved: any, cleaned: boolean }> }} */
        const error = new Error('Could not confirm the save. Reconnect and check the card before trying again.');
        if (!previousFront) error.retrySave = () => commit(true);
        throw error;
      }
    }
    const cleaned = await removeCardPhotos(bucket, change.replaced);
    return {saved, cleaned};
  }
  return commit();
}
