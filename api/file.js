// api/file.js — proxy URL eksternal secara aman lewat domain sendiri
// Usage: /api/file?url=https%3A%2F%2Ffiles.catbox.moe%2Fxxxx.jpg

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url } = req.query;

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ success: false, error: 'Parameter url diperlukan' });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'NyzzUploader/1.0'
      }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ success: false, error: 'File tidak ditemukan' });
    }

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Powered-By', 'NyzzUploader');

    const buffer = await upstream.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    return res.status(502).json({ success: false, error: 'Gagal mengambil file' });
  }
}
