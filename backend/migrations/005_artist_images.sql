-- Fotos de artista buscadas automaticamente (avatar do canal no YouTube); evita tentar de novo o tempo todo
ALTER TABLE artists ADD COLUMN image_checked_at timestamptz;
