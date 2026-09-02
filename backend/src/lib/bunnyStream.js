// تكامل Bunny Stream لرفع فيديوهات المحاضرات واسترجاع رابط التشغيل (embed).
// يعتمد على متغيرات البيئة التالية (راجع backend/.env.example):
//   BUNNY_STREAM_LIBRARY_ID  -> معرّف مكتبة الفيديو على Bunny
//   BUNNY_STREAM_API_KEY     -> الـ Access Key الخاص بمكتبة الفيديو (وليس مفتاح الحساب العام)
//
// طالما المتغيرين مش متظبطين، isBunnyConfigured() بترجع false والسيرفر يرجع
// تلقائيًا لطريقة الرفع المحلي (uploads/) الموجودة أصلاً — يعني مفيش أي كسر
// في الوظيفة الحالية لحد ما تتضاف المفاتيح.

const LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID;
const API_KEY = process.env.BUNNY_STREAM_API_KEY;
const BASE_URL = LIBRARY_ID ? `https://video.bunnycdn.com/library/${LIBRARY_ID}` : null;

function isBunnyConfigured() {
  return Boolean(LIBRARY_ID && API_KEY);
}

async function bunnyFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Bunny API error (${res.status}): ${body || res.statusText}`);
    err.status = 502;
    throw err;
  }
  return res;
}

// 1) إنشاء سجل فيديو فاضي على Bunny والحصول على videoId (guid)
async function createVideo(title) {
  const res = await bunnyFetch(`${BASE_URL}/videos`, {
    method: 'POST',
    headers: { AccessKey: API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const data = await res.json();
  return data.guid;
}

// 2) رفع بيانات الفيديو الفعلية (binary) لسجل الفيديو اللي اتعمل
async function uploadVideoFile(videoId, fileBuffer) {
  await bunnyFetch(`${BASE_URL}/videos/${videoId}`, {
    method: 'PUT',
    headers: { AccessKey: API_KEY, 'Content-Type': 'application/octet-stream' },
    body: fileBuffer,
  });
}

// الدالة الرئيسية: تاخد اسم المحاضرة وملف الفيديو (Buffer) وترجع videoId
async function uploadLectureVideo(title, fileBuffer) {
  if (!isBunnyConfigured()) {
    const err = new Error('إعدادات Bunny Stream غير مكتملة (BUNNY_STREAM_LIBRARY_ID / BUNNY_STREAM_API_KEY)');
    err.status = 500;
    throw err;
  }
  const videoId = await createVideo(title);
  await uploadVideoFile(videoId, fileBuffer);
  return videoId;
}

async function deleteLectureVideo(videoId) {
  if (!videoId || !isBunnyConfigured()) return;
  try {
    await bunnyFetch(`${BASE_URL}/videos/${videoId}`, {
      method: 'DELETE',
      headers: { AccessKey: API_KEY },
    });
  } catch (e) {
    console.error('[bunny] فشل حذف الفيديو:', e.message);
  }
}

function bunnyEmbedUrl(videoId) {
  if (!videoId || !LIBRARY_ID) return null;
  return `https://iframe.mediadelivery.net/embed/${LIBRARY_ID}/${videoId}`;
}

module.exports = { isBunnyConfigured, uploadLectureVideo, deleteLectureVideo, bunnyEmbedUrl };
