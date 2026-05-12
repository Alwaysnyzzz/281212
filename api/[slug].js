// api/[slug].js — Dynamic route akses file.
// Kalau map status pending, request ditahan tanpa HTML agar terasa seperti jaringan sedang loading.

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER  || 'Alwaysnyzzz';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'nyzz-uploads';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMap() {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/map.json?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
    {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  );

  if (res.status === 404) return {};

  if (!res.ok) {
    throw new Error('Gagal membaca map.json');
  }

  const json = await res.json();
  const content = Buffer.from(json.content || '', 'base64').toString('utf-8');
  return JSON.parse(content || '{}');
}

async function getEntry(slug) {
  const map = await getMap();
  return map[slug] || null;
}

async function waitUntilReady(slug, maxWait = 55000) {
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const entry = await getEntry(slug);

    if (entry?.status === 'ready') return entry;
    if (entry?.status === 'error') return entry;

    await delay(2500);
  }

  return null;
}

function getMime(ext = '', fallback = '') {
  if (fallback) return fallback;

  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
    '.tar': 'application/x-tar', '.gz': 'application/gzip',
    '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json',
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.xml': 'application/xml',
    '.bin': 'application/octet-stream'
  };

  return map[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

async function sendFile(res, entry, slug) {
  const rawUrl = entry.rawUrl || `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${entry.path}`;
  const upstream = await fetch(rawUrl, { cache: 'no-store' });

  if (!upstream.ok) {
    // GitHub sudah ready di map tapi raw belum kebuka. Tahan lagi sebentar, tanpa HTML.
    await delay(5000);
    const retry = await fetch(rawUrl, { cache: 'no-store' });

    if (!retry.ok) {
      return res.status(404).end();
    }

    return pipeResponse(res, retry, entry, slug);
  }

  return pipeResponse(res, upstream, entry, slug);
}

async function pipeResponse(res, upstream, entry, slug) {
  const mime = getMime(entry.ext, entry.mime || upstream.headers.get('content-type'));
  const buffer = await upstream.arrayBuffer();

  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Powered-By', 'Roxy-Uploader');
  res.setHeader('X-File-Name', entry.name || slug);
  res.status(200).send(Buffer.from(buffer));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { slug } = req.query;

  if (!slug || !/^[a-z0-9]{6}$/.test(slug)) {
    return res.status(404).end();
  }

  if (!GITHUB_TOKEN) {
    return res.status(500).end();
  }

  try {
    let entry = await getEntry(slug);

    if (!entry) {
      return res.status(404).end();
    }

    if (entry.status === 'pending') {
      // Tidak kirim HTML/teks. Request ditahan agar browser terlihat loading seperti jaringan ngeleg.
      const readyEntry = await waitUntilReady(slug, 55000);

      if (readyEntry?.status === 'ready') {
        return sendFile(res, readyEntry, slug);
      }

      if (readyEntry?.status === 'error') {
        return res.status(500).end();
      }

      // Kalau masih pending setelah ditahan, akhiri kosong supaya tidak menampilkan HTML.
      return res.status(202).end();
    }

    if (entry.status === 'error') {
      return res.status(500).end();
    }

    return sendFile(res, entry, slug);

  } catch (err) {
    console.error('[slug] error:', err);
    return res.status(502).end();
  }
}
