// api/upload.js — Vercel Serverless Function
// Upload file ke Catbox, simpan slug mapping di GitHub map.json,
// lalu return URL domain sendiri: https://domain-kamu/xxxxxx
//
// ENV Vercel:
//   GITHUB_TOKEN   = token GitHub untuk update map.json
//   GITHUB_OWNER   = Alwaysnyzzz
//   GITHUB_REPO    = repo penyimpan map.json
//   GITHUB_BRANCH  = main
//   BASE_URL       = https://roxy-upload.nyzz.my.id (opsional, bisa auto dari host)

import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = {
  api: { bodyParser: false }
};

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER  || 'Alwaysnyzzz';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'nyzz-uploads';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const BASE_URL_ENV  = (process.env.BASE_URL || '').replace(/\/$/, '');

const CATBOX_UPLOAD_URL = 'https://catbox.moe/user/api.php';
const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function getBaseUrl(req) {
  if (BASE_URL_ENV) return BASE_URL_ENV;

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${proto}://${host}`;
}

function randomSlug(len = 6) {
  return Array.from({ length: len }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

function sanitizeName(name = 'upload') {
  return String(name)
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
  if (clean.includes('mpeg')) return '.mp3';
  if (clean.includes('mp3')) return '.mp3';
  if (clean.includes('ogg')) return '.ogg';
  if (clean.includes('pdf')) return '.pdf';
  if (clean.includes('zip')) return '.zip';
  if (clean.includes('json')) return '.json';
  if (clean.includes('plain')) return '.txt';

  return '';
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

async function uploadToCatbox(buffer, filename, mimetype) {
  const safeFileName = sanitizeName(filename || `upload-${Date.now()}`);
  const blob = new Blob([buffer], {
    type: mimetype || 'application/octet-stream'
  });

  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', blob, safeFileName);

  const res = await fetch(CATBOX_UPLOAD_URL, {
    method: 'POST',
    body: form,
    headers: {
      'User-Agent': 'NyzzUploader/1.0'
    }
  });

  const text = (await res.text()).trim();

  if (!res.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(text || 'Catbox upload gagal');
  }

  return text;
}

async function githubFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
}

async function getMap() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/map.json?ref=${GITHUB_BRANCH}`;
  const res = await githubFetch(apiUrl);

  if (res.status === 404) {
    return { data: {}, sha: null };
  }

  const json = await res.json();

  if (!res.ok) {
    throw new Error(`GitHub map error: ${json.message || 'Unknown'}`);
  }

  const content = Buffer.from(json.content || '', 'base64').toString('utf-8') || '{}';

  return {
    data: JSON.parse(content),
    sha: json.sha
  };
}

async function saveMap(mapData, sha) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/map.json`;

  const body = {
    message: 'update uploader map',
    content: Buffer.from(JSON.stringify(mapData, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  };

  if (sha) body.sha = sha;

  const res = await githubFetch(apiUrl, {
    method: 'PUT',
    body: JSON.stringify(body)
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(`GitHub save map error: ${json.message || 'Unknown'}`);
  }

  return json;
}

async function saveMapWithRetry(slug, entry, maxRetry = 3) {
  let lastError = null;

  for (let i = 0; i < maxRetry; i++) {
    try {
      const { data, sha } = await getMap();
      data[slug] = entry;
      await saveMap(data, sha);
      return;
    } catch (err) {
      lastError = err;
      await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)));
    }
  }

  throw lastError || new Error('Gagal menyimpan map');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      status: 'ok',
      message: 'NyzzUploader API aktif.',
      endpoint: 'POST /api/upload',
      field: 'file',
      storage: 'Catbox + domain proxy',
      maxSize: '10 MB',
      example: 'curl -X POST https://roxy-upload.nyzz.my.id/api/upload -F "file=@foto.jpg"'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ success: false, error: 'GITHUB_TOKEN belum dikonfigurasi' });
  }

  try {
    const { files } = await parseForm(req);
    const file = files.file?.[0] || files.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'Tidak ada file yang dikirim' });
    }

    const filePath = file.filepath;
    const fileSize = file.size || fs.statSync(filePath).size;

    if (fileSize > MAX_SIZE) {
      return res.status(413).json({ success: false, error: 'File melebihi batas 10 MB' });
    }

    const originalName = sanitizeName(file.originalFilename || file.name || 'upload');
    const mimetype = file.mimetype || 'application/octet-stream';
    const ext = path.extname(originalName) || getExtFromMime(mimetype);
    const buffer = fs.readFileSync(filePath);

    const catboxUrl = await uploadToCatbox(buffer, originalName, mimetype);

    const slug = randomSlug(6);
    const entry = {
      url: catboxUrl,
      ext,
      name: originalName,
      size: fileSize,
      storage: 'catbox',
      uploadedAt: new Date().toISOString()
    };

    await saveMapWithRetry(slug, entry);

    const baseUrl = getBaseUrl(req);

    return res.status(200).json({
      success: true,
      url: `${baseUrl}/${slug}`
    });
  } catch (err) {
    console.error('Upload error:', err);

    if (err.message?.includes('maxFileSize')) {
      return res.status(413).json({ success: false, error: 'File melebihi batas 10 MB' });
    }

    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  }
}
