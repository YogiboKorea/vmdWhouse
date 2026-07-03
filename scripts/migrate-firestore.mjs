// Firestore(yogibo-outbound) → MongoDB 이관 + base64 썸네일 → Cafe24 FTP(web/vmd/wHouse) 업로드
// 실행: node --env-file=.env.local scripts/migrate-firestore.mjs
// firestoreId 기준으로 중복 삽입을 건너뛰므로 여러 번 실행해도 안전합니다.

import { MongoClient } from 'mongodb';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'node:stream';

const FIREBASE_PROJECT = 'yogibo-outbound';
const FIREBASE_KEY = 'AIzaSyBWUipDWjGktUoSatmttFVYxJW02gKppLI';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const FTP_DIR = process.env.FTP_DIR || 'vmd/wHouse';

/* ---------- Firestore REST 값 파서 ---------- */
function fsValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(fsValue);
  if (v.mapValue !== undefined) return fsFields(v.mapValue.fields || {});
  return null;
}
const fsFields = (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsValue(v)]));

async function fetchCollection(name) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${FS_BASE}/${name}?pageSize=300&key=${FIREBASE_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore ${name} 읽기 실패: ${res.status} ${await res.text()}`);
    const json = await res.json();
    for (const d of json.documents || []) {
      docs.push({ firestoreId: d.name.split('/').pop(), ...fsFields(d.fields || {}) });
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return docs;
}

/* ---------- main ---------- */
async function main() {
  console.log('1) Firestore에서 데이터 읽는 중...');
  const [fsItems, fsPopups] = await Promise.all([fetchCollection('items'), fetchCollection('popups')]);
  console.log(`   items ${fsItems.length}건, popups ${fsPopups.length}건`);

  const mongo = await new MongoClient(process.env.MONGODB_URI).connect();
  const db = mongo.db(process.env.VMD_DB_NAME || 'vmdWhouse');
  const itemsCol = db.collection('items');
  const popupsCol = db.collection('popups');

  // 이미 이관된 firestoreId는 건너뛰기
  const doneItemIds = new Set((await itemsCol.find({ firestoreId: { $exists: true } }).project({ firestoreId: 1 }).toArray()).map((d) => d.firestoreId));
  const donePopupIds = new Set((await popupsCol.find({ firestoreId: { $exists: true } }).project({ firestoreId: 1 }).toArray()).map((d) => d.firestoreId));

  const newItems = fsItems.filter((d) => !doneItemIds.has(d.firestoreId));
  const newPopups = fsPopups.filter((d) => !donePopupIds.has(d.firestoreId));
  console.log(`2) 신규 이관 대상: items ${newItems.length}건, popups ${newPopups.length}건`);

  // FTP 연결 1회로 모든 썸네일 업로드
  const withThumb = newItems.filter((it) => typeof it.thumbnail === 'string' && it.thumbnail.startsWith('data:'));
  console.log(`3) base64 썸네일 ${withThumb.length}건 → FTP ${FTP_DIR} 업로드 중...`);
  if (withThumb.length) {
    const ftp = new FtpClient(30000);
    const host = (process.env.YOGIBO_FTP || '').replace(/^(http:\/\/|https:\/\/|ftp:\/\/)/, '').replace(/\/$/, '');
    await ftp.access({ host, user: process.env.YOGIBO_FTP_ID, password: process.env.YOGIBO_FTP_PW, secure: false });
    let webRoot = 'web';
    try { await ftp.ensureDir('web'); await ftp.ensureDir(FTP_DIR); }
    catch { await ftp.cd('/'); await ftp.ensureDir('www'); await ftp.ensureDir(FTP_DIR); webRoot = 'www'; }
    const base = (process.env.FTP_PUBLIC_BASE || `http://${host}`).replace(/\/+$/, '');

    let n = 0;
    for (const it of withThumb) {
      const m = it.thumbnail.match(/^data:image\/(\w+);base64,(.+)$/s);
      if (!m) { it.thumbnail = null; continue; }
      const ext = m[1] === 'png' ? 'png' : 'jpg';
      const buffer = Buffer.from(m[2], 'base64');
      const filename = `fs_${it.firestoreId}.${ext}`;
      await ftp.uploadFrom(Readable.from(buffer), filename);
      it.thumbnail = `${base}/${webRoot}/${FTP_DIR}/${filename}`.replace(/([^:]\/)\/+/g, '$1');
      n++;
      if (n % 10 === 0 || n === withThumb.length) console.log(`   ${n}/${withThumb.length} 업로드`);
    }
    ftp.close();
  }

  console.log('4) MongoDB에 저장 중...');
  if (newItems.length) {
    await itemsCol.insertMany(newItems.map((it) => ({
      firestoreId: it.firestoreId,
      name: it.name || '이름없음',
      category: it.category || '진열집기',
      status: it.status || '사용가능',
      color: it.color || '',
      size: it.size || '',
      note: it.note || '',
      totalStock: parseInt(it.totalStock) || 0,
      thumbnail: typeof it.thumbnail === 'string' && it.thumbnail.startsWith('http') ? it.thumbnail : null,
      outbound: Array.isArray(it.outbound) ? it.outbound : [],
      history: Array.isArray(it.history) ? it.history : [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })));
  }
  if (newPopups.length) {
    await popupsCol.insertMany(newPopups.map((p) => ({
      firestoreId: p.firestoreId,
      name: p.name || '이름없음',
      place: p.place || '',
      status: p.status || '진행중',
      start: p.start || '',
      end: p.end || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    })));
  }

  const totalItems = await itemsCol.countDocuments();
  const totalPopups = await popupsCol.countDocuments();
  console.log(`완료 ✓ 이번에 items ${newItems.length}건 / popups ${newPopups.length}건 이관 (DB 총 items ${totalItems}, popups ${totalPopups})`);
  await mongo.close();
}

main().catch((e) => { console.error('이관 실패:', e); process.exit(1); });
