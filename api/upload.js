// api/upload.js — Vercel Serverless Function
// Upload file ke GitHub repo, return URL domain/xxxxxx (6 char acak)
//
// ENV yang harus di-set di Vercel Dashboard:
//   GITHUB_TOKEN   = ghp_xxxxxxxx (personal access token, scope: repo)
//   GITHUB_OWNER   = Alwaysnyzzz
//   GITHUB_REPO    = nyzz-uploads
//   GITHUB_BRANCH  = main  (opsional, default: main)
//   BASE_URL       = https://uploader.nyzz.my.id

import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = {
  api: { bodyParser: false }
};

const MAX_SIZE = 3 * 1024 * 1024; // 3 MB

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER  || 'Alwaysnyzzz';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'nyzz-uploads';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const BASE_URL      = (process.env.BASE_URL || '').replace(/\/$/, '');

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSlug(len = 6) {
  return Array.from({ length: len }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
}

function sanitizeName(name) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

async function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({ maxFileSize: MAX_SIZE, keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

// Ambil map.json dari GitHub (slug → file info)
async function getMap() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/map.json`;
  const res = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  });
  if (res.status === 404) return { data: {}, sha: null };
  const json = await res.json();
  const content = Buffer.from(json.content, 'base64').toString('utf-8');
  return { data: JSON.parse(content), sha: json.sha };
}

// Simpan map.json ke GitHub
async function saveMap(mapData, sha) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/map.json`;
  const body = {
    message: 'update map',
    content: Buffer.from(JSON.stringify(mapData, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;
  await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET → info API aktif
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      message: 'NyzzUploader API aktif! Silahkan lanjutkan upload.',
      endpoint: 'POST /api/upload',
      field: 'file (multipart/form-data)',
      maxSize: '3 MB',
      formats: 'Semua format didukung',
      expired: 'Tidak ada (permanen)',
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN belum dikonfigurasi' });

  try {
    const { files } = await parseForm(req);
    const file = files.file?.[0] || files.file;
    if (!file) return res.status(400).json({ error: 'Tidak ada file yang dikirim' });

    const fileSize = file.size || fs.statSync(file.filepath).size;
    if (fileSize > MAX_SIZE) return res.status(413).json({ error: 'File melebihi batas 3 MB' });

    const originalName = file.originalFilename || file.name || 'upload';
    const ext = path.extname(originalName) || '';

    // Generate slug 6 karakter
    const slug = randomSlug(6);
    const filePath = `files/${slug}${ext}`;

    // Upload file ke GitHub
    const fileBuffer = fs.readFileSync(file.filepath);
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          message: `upload: ${slug}${ext}`,
          content: fileBuffer.toString('base64'),
          branch: GITHUB_BRANCH,
        }),
      }
    );

    const ghJson = await ghRes.json();
    if (!ghRes.ok) {
      return res.status(502).json({ error: `GitHub error: ${ghJson.message || 'Unknown'}` });
    }

    // Update map.json
    const { data: mapData, sha } = await getMap();
    mapData[slug] = {
      path: filePath,
      ext,
      name: originalName,
      size: fileSize,
      uploadedAt: new Date().toISOString(),
    };
    await saveMap(mapData, sha);

    return res.status(200).json({
      success: true,
      url: `${BASE_URL}/${slug}`,
      slug,
      name: originalName,
      size: fileSize,
    });

  } catch (err) {
    console.error('Upload error:', err);
    if (err.message?.includes('maxFileSize')) {
      return res.status(413).json({ error: 'File melebihi batas 3 MB' });
    }
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
