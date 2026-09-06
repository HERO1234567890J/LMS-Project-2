const schemaSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','student')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  level_id INTEGER,
  student_number TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  governorate TEXT,
  birth_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS levels (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS terms (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES levels(id),
  term_id INTEGER NOT NULL REFERENCES terms(id),
  name_ar TEXT NOT NULL,
  doctor_name TEXT NOT NULL,
  price_egp NUMERIC(10,2) NOT NULL DEFAULT 0,
  cover_url TEXT,
  description TEXT,
  badge TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lectures (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  youtube_url TEXT,
  video_url TEXT,
  publish_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- عمود فيديو Bunny Stream: بيتخزن فيه guid الفيديو لما يترفع على Bunny بدل التخزين المحلي.
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS bunny_video_id TEXT;

CREATE TABLE IF NOT EXISTS lecture_files (
  id SERIAL PRIMARY KEY,
  lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- أعمدة تخزين PDF على Cloudflare R2 (بدل التخزين المحلي).
ALTER TABLE lecture_files ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'local' CHECK (storage IN ('local','r2'));
ALTER TABLE lecture_files ADD COLUMN IF NOT EXISTS r2_object_key TEXT;
ALTER TABLE lecture_files ALTER COLUMN url DROP NOT NULL;

CREATE TABLE IF NOT EXISTS document_access_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  document_id INTEGER REFERENCES lecture_files(id) ON DELETE SET NULL,
  course_id INTEGER,
  ip_address TEXT,
  result TEXT NOT NULL CHECK (result IN ('granted','denied')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_access_logs_user ON document_access_logs(user_id);

CREATE TABLE IF NOT EXISTS activation_codes (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  price_egp NUMERIC(10,2) NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  used_by INTEGER REFERENCES users(id),
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  activation_code_id INTEGER REFERENCES activation_codes(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, subject_id)
);

CREATE TABLE IF NOT EXISTS exams (
  id SERIAL PRIMARY KEY,
  lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  pass_percent INTEGER NOT NULL DEFAULT 60,
  duration_minutes INTEGER,
  allow_retry BOOLEAN NOT NULL DEFAULT TRUE,
  max_attempts INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN ('mcq','true_false','essay')),
  question_text TEXT NOT NULL,
  points NUMERIC(10,2) NOT NULL DEFAULT 1,
  options JSONB,
  correct_index INTEGER,
  correct_answer TEXT,
  position INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','graded')),
  score NUMERIC(10,2),
  total_points NUMERIC(10,2),
  passed BOOLEAN,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS exam_answers (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  selected_option_id INTEGER,
  answer_text TEXT,
  is_correct BOOLEAN,
  points_awarded NUMERIC(10,2),
  scoring_method TEXT,
  graded_at TIMESTAMPTZ,
  UNIQUE(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(student_id, lecture_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('all','level','user')),
  level_id INTEGER REFERENCES levels(id),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(notification_id, user_id)
);

INSERT INTO levels (code, name_ar, sort_order) VALUES
('year1','الفرقة الأولى',1),
('year2','الفرقة الثانية',2),
('year3','الفرقة الثالثة',3),
('year4','الفرقة الرابعة',4),
('diploma','دبلومات الدراسات العليا',5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO terms (code, name_ar, sort_order) VALUES
('term1','الترم الأول',1),
('term2','الترم الثاني',2)
ON CONFLICT (code) DO NOTHING;
`;

module.exports = { schemaSql };
