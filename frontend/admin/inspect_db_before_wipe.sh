#!/usr/bin/env bash
# شغّله من جوه /opt/lms-project/backend
# ده سكريبت فحص بس - مش بيمسح ولا يعدّل أي حاجة خالص.

set -e

if [ -f .env ]; then
  export $(grep -E '^(DATABASE_URL|PGHOST|PGUSER|PGPASSWORD|PGDATABASE|PGPORT)=' .env | xargs) 2>/dev/null || true
fi

echo "================ كل الجداول + عدد الصفوف في كل واحد ================"
psql "${DATABASE_URL}" -c "
SELECT
  t.table_name,
  (xpath('/row/cnt/text()', xml_count))[1]::text::int AS row_count
FROM information_schema.tables t
CROSS JOIN LATERAL (
  SELECT query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I', t.table_schema, t.table_name), false, true, '') AS xml_count
) x
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;
"

echo ""
echo "================ كل حسابات الأدمن (role = 'admin') ================"
psql "${DATABASE_URL}" -c "
SELECT id, name, phone, email, role, created_at FROM users WHERE role = 'admin';
"

echo ""
echo "================ عينة من جدول users (كل الرولز الموجودة) ================"
psql "${DATABASE_URL}" -c "
SELECT role, count(*) FROM users GROUP BY role;
"
