// api/[slug].js — Vercel Dynamic Route
// Akses file via: https://uploader.nyzz.my.id/a1b2c3
// Baca map.json dari GitHub → resolve ke file → proxy ke user
//
// ENV:
//   GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER  || 'Alwaysnyzzz';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'nyzz-uploads';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// Cache map di memori per-instance (bersih tiap cold start)
let cachedMap = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000; // 60 detik

async function getMap() {
  const now = Date.now();
  if (cachedMap && now - cacheTime < CACHE_TTL) return cachedMap;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/map.json`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
    }
  );

  if (res.status === 404) return {};
  const json = await res.json();
  const content = Buffer.from(json.content, 'base64').toString('utf-8');
  cachedMap = JSON.parse(content);
  cacheTime = now;
  return cachedMap;
}

// Deteksi MIME type dari ekstensi
function getMime(ext) {
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
    '.tar': 'application/x-tar', '.gz': 'application/gzip',
    '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json',
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  };
  return map[ext?.toLowerCase()] || 'application/octet-stream';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { slug } = req.query;

  // Validasi slug: hanya huruf & angka, 6 karakter
  if (!slug || !/^[a-z0-9]{6}$/.test(slug)) {
    return res.status(404).send('Not Found');
  }

  try {
    const map = await getMap();
    const entry = map[slug];

    if (!entry) {
      return res.status(404).send('File tidak ditemukan');
    }

    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${entry.path}`;
    const upstream = await fetch(rawUrl);

    if (!upstream.ok) {
      return res.status(404).send('File tidak ditemukan di storage');
    }

    const mime = getMime(entry.ext);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Powered-By', 'NyzzAPI');
    res.setHeader('X-File-Name', entry.name || slug);

    const buffer = await upstream.arrayBuffer();
    res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    console.error('[slug] error:', err);
    res.status(502).send('Gagal mengambil file');
  }
}
