-- Importação de links do Spotify pelo spotDL (fila processada pelo backend)
CREATE TABLE import_jobs (
  id uuid PRIMARY KEY,
  url text NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','canceled')),
  imported int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]',
  log text NOT NULL DEFAULT '',
  error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX import_jobs_status ON import_jobs(status, created_at);
