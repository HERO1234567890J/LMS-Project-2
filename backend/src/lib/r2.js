const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { query } = require('../db');

function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME,
  );
}

let cachedClient = null;
function getClient() {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return cachedClient;
}

// بيبني مسار الملف جوه الـ bucket، مثال:
// courses/12/lessons/45/documents/<uuid>.pdf
function buildDocumentKey(courseId, lessonId) {
  const id = crypto.randomUUID();
  return { key: `courses/${courseId}/lessons/${lessonId}/documents/${id}.pdf`, id };
}

async function currentStorageUsageBytes() {
  const { rows } = await query(
    "SELECT COALESCE(SUM(file_size),0)::bigint AS total FROM lecture_files WHERE storage = 'r2'",
  );
  return Number(rows[0].total);
}

// بيتأكد إن رفع الملف الجديد مش هيعدي الحد الأقصى المسموح به (افتراضي 9GB،
// قابل للتعديل من R2_STORAGE_CAP_BYTES في .env). لو هيعدي، بيرفض قبل الرفع.
async function ensureStorageCap(additionalBytes) {
  const cap = Number(process.env.R2_STORAGE_CAP_BYTES || 9 * 1024 * 1024 * 1024);
  const used = await currentStorageUsageBytes();
  if (used + additionalBytes > cap) {
    const err = new Error('تم الوصول للحد الأقصى المسموح به لتخزين الملفات. تواصل مع المسؤول لزيادة المساحة المتاحة.');
    err.status = 507;
    throw err;
  }
}

async function uploadPdfBuffer(buffer, key) {
  await getClient().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'application/pdf',
  }));
}

async function getSignedDownloadUrl(key) {
  const expiresIn = Number(process.env.PDF_SIGNED_URL_EXPIRY_SECONDS || 300);
  const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key });
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

async function deleteObject(key) {
  await getClient().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
}

module.exports = {
  isR2Configured,
  buildDocumentKey,
  currentStorageUsageBytes,
  ensureStorageCap,
  uploadPdfBuffer,
  getSignedDownloadUrl,
  deleteObject,
};
