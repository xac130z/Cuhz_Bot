const unavailable = () => Object.assign(Error('LOUNGE_STORAGE_UNAVAILABLE'), { code: 'LOUNGE_STORAGE_UNAVAILABLE' });
/** Fixed-origin, fixed-bucket private storage. No signed URLs reach the stage. */
export function createStoragePort({ url, bucket, serviceKey, fetchImpl = globalThis.fetch, timeoutMs = 4500 }) {
  const configured = new URL(url);
  if (configured.protocol !== 'https:' || configured.origin !== url || !/^[A-Za-z0-9_-]{1,100}$/.test(bucket || '')
      || typeof serviceKey !== 'string' || !serviceKey || typeof fetchImpl !== 'function') throw Error('LOUNGE_STORAGE_CONFIG_INVALID');
  function target(path) {
    if (typeof path !== 'string' || path.length > 512 || path.split('/').some(segment => !/^[A-Za-z0-9_.-]+$/.test(segment) || ['.', '..'].includes(segment))) throw unavailable();
    return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  async function call(path, { signal, ...options }, readLimit) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw unavailable();
    signal?.addEventListener('abort', abort, { once: true });
    let timer;
    try {
      return await Promise.race([(async () => {
        const response = await fetchImpl(target(path), { ...options, redirect: 'error', cache: 'no-store',
          signal: controller.signal, headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, ...options.headers } });
        if (options.method === 'POST' && response.status === 409) { void response.body?.cancel().catch(() => {}); return { alreadyExists: true }; }
        if (!response.ok) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
        if (!readLimit) { void response.body?.cancel().catch(() => {}); return { stored: true }; }
        if (Number(response.headers.get('content-length') || 0) > readLimit) throw unavailable();
        const reader = response.body?.getReader(), chunks = []; let length = 0;
        if (!reader) throw unavailable();
        try { for (;;) { const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength; if (length > readLimit) throw unavailable(); chunks.push(value); }
        } finally { void reader.cancel().catch(() => {}); }
        return { bytes: Buffer.concat(chunks, length), contentType: response.headers.get('content-type')?.split(';')[0] };
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs); })]);
    } catch { throw unavailable(); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
  }
  return {
    readObject(path, { signal, maxBytes = 10 * 1024 * 1024 } = {}) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw unavailable();
      return call(path, { method: 'GET', signal }, maxBytes);
    },
    writeObject(path, { bytes, contentType, ifAbsent, signal } = {}) {
      if (!Buffer.isBuffer(bytes) || bytes.length > 10 * 1024 * 1024 || contentType !== 'image/png' || ifAbsent !== true) throw unavailable();
      return call(path, { method: 'POST', body: bytes, signal, headers: { 'Content-Type': contentType, 'x-upsert': 'false' } });
    },
  };
}
