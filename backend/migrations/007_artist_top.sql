-- As 50 músicas mais vistas de cada artista no YouTube (tela do artista no app), atualizadas toda semana
ALTER TABLE artists ADD COLUMN top_fetched_at timestamptz;
CREATE TABLE artist_top_tracks (
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  rank int NOT NULL,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (artist_id, rank)
);
