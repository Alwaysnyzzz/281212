// api/file.js — Vercel Serverless Function
// Proxy file dari GitHub raw agar URL-nya tetap domain Vercel kamu
// Usage: /api/file?p=uploads/2026/05/foto_abc123.jpg
//
// ENV:
//   GITHUB_OWNER   = Alwaysnyzzz
//   GITHUB_REPO    = nyzz-uploads
//   GITHUB_BRANCH  = main

const GITHUB_OWNER  = process.env.GITHUB_OWNER  || 'Alwaysnyzzz';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'nyzz-uploads';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { p } = req.query;
  if (!p) return res.status(400).json({ error: 'Parameter p (path) diperlukan' });

  // Validasi path — hanya boleh folder uploads/
  const cleanPath = decodeURIComponent(p).replace(/\.\./g, '');
  if (!cleanPath.startsWith('uploads/')) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${cleanPath}`;

  try {
    const upstream = await fetch(rawUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'File tidak ditemukan' });
    }

    // Teruskan Content-Type
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // cache 1 tahun
    res.setHeader('X-Powered-By', 'NyzzAPI');

    const buffer = await upstream.arrayBuffer();
    res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    res.status(502).json({ error: 'Gagal mengambil file dari GitHub' });
  }
}
