// api/[slug].js — resolve slug ke file URL lalu proxy/redirect lewat domain sendiri
// Support data lama:
// - entry.url  = URL Catbox / storage eksternal
// - entry.path = path GitHub raw lama

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER  || 'Alwaysnyzzz';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'nyzz-uploads';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const REDIRECT_MODE = String(process.env.REDIRECT_MODE || '').toLowerCase() === 'true';

let cachedMap = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000;

async function getMap() {
  const now = Date.now();
  if (cachedMap && now - cacheTime < CACHE_TTL) return cachedMap;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/map.json?ref=${GITHUB_BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  );

  if (res.status === 404) return {};

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.message || 'Gagal membaca map');
  }

  const content = Buffer.from(json.content || '', 'base64').toString('utf-8') || '{}';
  cachedMap = JSON.parse(content);
  cacheTime = now;
  return cachedMap;
}

function getMime(ext = '') {
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript'
  };

  return map[String(ext).toLowerCase()] || 'application/octet-stream';
}

function getTargetUrl(entry) {
  if (entry?.url) return entry.url;

  if (entry?.path) {
    return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${entry.path}`;
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { slug } = req.query;

  if (!slug || !/^[a-z0-9]{6}$/.test(slug)) {
    return res.status(404).send('Not Found');
  }

  try {
    const map = await getMap();
    const entry = map[slug];

    if (!entry) {
      return res.status(404).send('File tidak ditemukan');
    }

    const targetUrl = getTargetUrl(entry);

    if (!targetUrl) {
      return res.status(404).send('Target file tidak valid');
    }

    if (REDIRECT_MODE) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.redirect(302, targetUrl);
    }

    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'NyzzUploader/1.0'
      }
    });

    if (!upstream.ok) {
      return res.status(404).send('File tidak ditemukan di storage');
    }

    const mime = upstream.headers.get('content-type') || getMime(entry.ext);

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Powered-By', 'NyzzUploader');
    res.setHeader('X-File-Name', entry.name || slug);

    const buffer = await upstream.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('[slug] error:', err);
    return res.status(502).send('Gagal mengambil file');
  }
}
