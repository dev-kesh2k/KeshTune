-- Playlists criadas pelo sistema para cada usuário (ex.: 'my_music' = "Minhas músicas", recebe o que ele baixa)
ALTER TABLE playlists ADD COLUMN system_key varchar(20);
CREATE INDEX playlists_system ON playlists(owner_id, system_key) WHERE system_key IS NOT NULL;
