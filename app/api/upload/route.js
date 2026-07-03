import { uploadBufferToFtp } from '@/lib/ftp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 이미지 업로드 → Cafe24 FTP → 공개 URL 반환
export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return Response.json({ error: '파일이 없습니다.' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) {
      return Response.json({ error: '파일이 너무 큽니다. (최대 8MB)' }, { status: 400 });
    }
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
    const url = await uploadBufferToFtp(buffer, filename);
    return Response.json({ url });
  } catch (e) {
    console.error('FTP 업로드 실패:', e);
    return Response.json({ error: 'FTP 업로드 실패: ' + e.message }, { status: 500 });
  }
}
