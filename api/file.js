// api/file.js — Proxy file dari GitHub raw berdasarkan path.

const GITHUB_OWNER  = process.env.GITHUB_OWNER  || 'Alwaysnyzzz';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'nyzz-uploads';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { p } = req.query;
  if (!p) return res.status(400).json({ error: 'Parameter p diperlukan' });

  const cleanPath = decodeURIComponent(p).replace(/\.\./g, '');

  if (!cleanPath.startsWith('files/') && !cleanPath.startsWith('uploads/')) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${cleanPath}`;

  try {
    const upstream = await fetch(rawUrl, { cache: 'no-store' });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'File tidak ditemukan' });
    }

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Powered-By', 'Roxy-Uploader');

    const buffer = await upstream.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    console.error('[file] error:', err);
    return res.status(502).json({ error: 'Gagal mengambil file dari GitHub' });
  }
}
