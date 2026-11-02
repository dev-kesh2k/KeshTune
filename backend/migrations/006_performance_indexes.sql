-- Índices para as listagens mais frequentes (início, gêneros, rádio, relatórios) e para checar áudio duplicado
CREATE INDEX IF NOT EXISTS tracks_active_popularity ON tracks(popularity DESC, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS tracks_active_created ON tracks(created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS tracks_checksum ON tracks(checksum) WHERE checksum IS NOT NULL;
CREATE INDEX IF NOT EXISTS play_counts_day ON play_counts(day, track_id);
