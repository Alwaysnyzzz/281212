// api/upload.js — Vercel Serverless Function
// Upload semua format file ke GitHub repo dan return URL domain/slug.
// Sistem map.json menyimpan status: pending → ready/error.
// Saat URL dibuka ketika masih pending, api/[slug].js akan menahan request seperti jaringan sedang loading.

import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = {
  api: { bodyParser: false }
};

// Catatan:
// GitHub Contents API tidak cocok untuk file sangat besar.
// Batas ini dibuat lebih lega, tapi tetap sesuaikan dengan limit Vercel plan kamu.
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER  || 'Alwaysnyzzz';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'nyzz-uploads';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const BASE_URL      = (process.env.BASE_URL || 'https://roxy-upload.nyzz.my.id').replace(/\/$/, '');

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomSlug(len = 6) {
  return Array.from({ length: len }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

function sanitizeName(name = '') {
  return String(name || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\.\./g, '')
    .toLowerCase();
}

function getExtFromMime(mime = '') {
  const clean = String(mime).toLowerCase();

  if (clean.includes('png')) return '.png';
  if (clean.includes('webp')) return '.webp';
  if (clean.includes('gif')) return '.gif';
  if (clean.includes('jpeg')) return '.jpg';
  if (clean.includes('jpg')) return '.jpg';
  if (clean.includes('mp4')) return '.mp4';
  if (clean.includes('quicktime')) return '.mov';
  if (clean.includes('webm')) return '.webm';
  if (clean.includes('mpeg')) return '.mp3';
  if (clean.includes('mp3')) return '.mp3';
  if (clean.includes('ogg')) return '.ogg';
  if (clean.includes('opus')) return '.opus';
  if (clean.includes('wav')) return '.wav';
  if (clean.includes('pdf')) return '.pdf';
  if (clean.includes('zip')) return '.zip';
  if (clean.includes('rar')) return '.rar';
  if (clean.includes('json')) return '.json';
  if (clean.includes('javascript')) return '.js';
  if (clean.includes('plain')) return '.txt';
  if (clean.includes('html')) return '.html';
  if (clean.includes('css')) return '.css';
  if (clean.includes('xml')) return '.xml';

  return '.bin';
}

async function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      maxFileSize: MAX_SIZE,
      keepExtensions: true,
      multiples: false
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function githubJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });

  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function getMap() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/map.json?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const { res, json } = await githubJson(apiUrl, { method: 'GET' });

  if (res.status === 404) return { data: {}, sha: null };

  if (!res.ok) {
    throw new Error(`GitHub get map error: ${json.message || 'Unknown'}`);
  }

  const content = Buffer.from(json.content || '', 'base64').toString('utf-8');
  return { data: JSON.parse(content || '{}'), sha: json.sha };
}

async function saveMap(mapData, sha, message = 'update map') {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/map.json`;
  const body = {
    message,
    content: Buffer.from(JSON.stringify(mapData, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  };

  if (sha) body.sha = sha;

  const { res, json } = await githubJson(apiUrl, {
    method: 'PUT',
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`GitHub save map error: ${json.message || 'Unknown'}`);
  }

  return json.content?.sha || json.commit?.sha || null;
}

async function setMapEntry(slug, entry, message) {
  // Retry sederhana untuk mengurangi bentrok sha saat upload barengan.
  let lastError = null;

  for (let i = 0; i < 3; i++) {
    try {
      const { data, sha } = await getMap();
      data[slug] = {
        ...(data[slug] || {}),
        ...entry,
        updatedAt: new Date().toISOString()
      };
      await saveMap(data, sha, message);
      return data[slug];
    } catch (err) {
      lastError = err;
      await delay(800 * (i + 1));
    }
  }

  throw lastError || new Error('Gagal update map.json');
}

async function uploadFileToGithub(fileBuffer, filePath, slug, ext) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const { res, json } = await githubJson(apiUrl, {
    method: 'PUT',
    body: JSON.stringify({
      message: `upload: ${slug}${ext}`,
      content: fileBuffer.toString('base64'),
      branch: GITHUB_BRANCH
    })
  });

  if (!res.ok) {
    throw new Error(`GitHub upload error: ${json.message || 'Unknown'}`);
  }

  return json;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'Roxy Uploader API aktif.',
      endpoint: 'POST /api/upload',
      field: 'file (multipart/form-data)',
      maxSize: '25 MB',
      formats: 'Semua format didukung',
      storage: 'GitHub',
      pendingMode: 'URL ditahan/loading sampai file ready'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ success: false, error: 'GITHUB_TOKEN belum dikonfigurasi' });
  }

  let slug = null;

  try {
    const { files } = await parseForm(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'Tidak ada file yang dikirim' });
    }

    const fileSize = file.size || fs.statSync(file.filepath).size;
    if (fileSize > MAX_SIZE) {
      return res.status(413).json({ success: false, error: 'File melebihi batas 25 MB' });
    }

    const originalName = sanitizeName(file.originalFilename || file.name || 'upload');
    const mime = file.mimetype || 'application/octet-stream';
    const ext = path.extname(originalName) || getExtFromMime(mime);
    slug = randomSlug(6);

    const safeBaseName = originalName.replace(/\.[^.]+$/, '') || 'file';
    const fileName = `${slug}-${safeBaseName}${ext}`;
    const filePath = `files/${fileName}`;
    const publicUrl = `${BASE_URL}/${slug}`;
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`;

    // 1. Simpan status pending dulu.
    await setMapEntry(slug, {
      status: 'pending',
      path: filePath,
      rawUrl,
      ext,
      mime,
      name: originalName,
      size: fileSize,
      uploadedAt: new Date().toISOString(),
      message: 'File sedang diproses'
    }, `pending: ${slug}`);

    // 2. Upload file ke GitHub.
    const fileBuffer = fs.readFileSync(file.filepath);
    const ghJson = await uploadFileToGithub(fileBuffer, filePath, slug, ext);

    // 3. Tandai ready setelah upload sukses.
    await setMapEntry(slug, {
      status: 'ready',
      path: filePath,
      rawUrl: ghJson?.content?.download_url || rawUrl,
      ext,
      mime,
      name: originalName,
      size: fileSize,
      readyAt: new Date().toISOString(),
      message: 'File siap dibuka'
    }, `ready: ${slug}`);

    return res.status(200).json({
      success: true,
      url: publicUrl
    });

  } catch (err) {
    console.error('Upload error:', err);

    if (slug) {
      try {
        await setMapEntry(slug, {
          status: 'error',
          error: err.message || 'Upload gagal',
          errorAt: new Date().toISOString()
        }, `error: ${slug}`);
      } catch (mapErr) {
        console.error('Map error update failed:', mapErr);
      }
    }

    if (err.message?.includes('maxFileSize')) {
      return res.status(413).json({ success: false, error: 'File melebihi batas 25 MB' });
    }

    return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
