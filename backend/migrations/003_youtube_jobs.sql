-- A fila de importação também baixa o áudio de faixas do YouTube (yt-dlp), que viram arquivo próprio
ALTER TABLE import_jobs
  ADD COLUMN kind varchar(10) NOT NULL DEFAULT 'spotify' CHECK (kind IN ('spotify','youtube')),
  ADD COLUMN track_id uuid REFERENCES tracks(id) ON DELETE CASCADE;
CREATE INDEX import_jobs_track ON import_jobs(track_id) WHERE track_id IS NOT NULL;
CREATE INDEX tracks_youtube_id ON tracks(youtube_id) WHERE youtube_id IS NOT NULL;
