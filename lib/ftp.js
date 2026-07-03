import { Client } from 'basic-ftp';
import { Readable } from 'node:stream';

const FTP_DIR = process.env.FTP_DIR || 'vmd/wHouse';

export function ftpConfig() {
  const host = (process.env.YOGIBO_FTP || '')
    .replace(/^(http:\/\/|https:\/\/|ftp:\/\/)/, '')
    .replace(/\/$/, '');
  return {
    host,
    user: process.env.YOGIBO_FTP_ID,
    password: process.env.YOGIBO_FTP_PW,
    secure: false,
  };
}

export function publicUrlFor(filename, webRoot = 'web') {
  const base = (process.env.FTP_PUBLIC_BASE || `http://${ftpConfig().host}`).replace(/\/+$/, '');
  return `${base}/${webRoot}/${FTP_DIR}/${filename}`.replace(/([^:]\/)\/+/g, '$1');
}

// 접속 후 web/vmd/wHouse(FTP_DIR)까지 이동. ensureDir는 중첩 경로를 순서대로 생성/진입.
export async function enterUploadDir(client) {
  try {
    await client.ensureDir('web');
    await client.ensureDir(FTP_DIR);
    return 'web';
  } catch (dirErr) {
    await client.cd('/');
    await client.ensureDir('www');
    await client.ensureDir(FTP_DIR);
    return 'www';
  }
}

// yogiChat과 동일한 Cafe24 FTP 업로드 패턴: web/<dir>/<file> → FTP_PUBLIC_BASE/web/<dir>/<file>
export async function uploadBufferToFtp(buffer, filename) {
  const client = new Client(30000);
  let webRoot = 'web';
  try {
    await client.access(ftpConfig());
    webRoot = await enterUploadDir(client);
    await client.uploadFrom(Readable.from(buffer), filename);
  } finally {
    client.close();
  }
  return publicUrlFor(filename, webRoot);
}
