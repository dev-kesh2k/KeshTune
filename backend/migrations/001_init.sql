-- Spotify X — esquema inicial (seção 7 da especificação)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() não é IMMUTABLE; o wrapper permite índices de busca.
CREATE OR REPLACE FUNCTION f_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email varchar(254) NOT NULL,
  password_hash text NOT NULL,
  display_name varchar(80) NOT NULL,
  role varchar(10) NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  created_by uuid REFERENCES users(id),
  must_change_password boolean NOT NULL DEFAULT true,
  locale varchar(10) NOT NULL DEFAULT 'pt-BR',
  avatar_url text,
  bio varchar(300),
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  personalization boolean NOT NULL DEFAULT true,
  explicit_allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX users_name_trgm ON users USING gin (f_norm(display_name) gin_trgm_ops);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash text NOT NULL,
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform varchar(20) NOT NULL DEFAULT 'web',
  model varchar(120),
  name varchar(80) NOT NULL,
  offline_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX devices_user ON devices(user_id);

CREATE TABLE artists (
  id uuid PRIMARY KEY,
  name varchar(200) NOT NULL,
  bio text,
  image_url text,
  verified boolean NOT NULL DEFAULT false,
  country varchar(2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artists_name_trgm ON artists USING gin (f_norm(name) gin_trgm_ops);

CREATE TABLE albums (
  id uuid PRIMARY KEY,
  title varchar(200) NOT NULL,
  type varchar(12) NOT NULL DEFAULT 'album' CHECK (type IN ('album','single','ep','compilation')),
  release_date date,
  label varchar(200),
  upc varchar(20),
  cover_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX albums_title_trgm ON albums USING gin (f_norm(title) gin_trgm_ops);

CREATE TABLE album_artists (
  album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, artist_id)
);

CREATE TABLE tracks (
  id uuid PRIMARY KEY,
  album_id uuid REFERENCES albums(id) ON DELETE SET NULL,
  title varchar(200) NOT NULL,
  duration_ms int NOT NULL DEFAULT 0,
  isrc varchar(15),
  explicit boolean NOT NULL DEFAULT false,
  track_number int,
  disc_number int NOT NULL DEFAULT 1,
  lyrics text,
  popularity int NOT NULL DEFAULT 0,
  source varchar(10) NOT NULL CHECK (source IN ('file','youtube')),
  youtube_id varchar(20),
  audio_path text,
  audio_mime varchar(60),
  audio_size bigint,
  checksum varchar(64),
  bitrate_kbps int,
  cover_url text,
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','takedown')),
  takedown_reason text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tracks_isrc_uq ON tracks(isrc) WHERE isrc IS NOT NULL;
CREATE INDEX tracks_album ON tracks(album_id);
CREATE INDEX tracks_title_trgm ON tracks USING gin (f_norm(title) gin_trgm_ops);

CREATE TABLE track_artists (
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  role varchar(12) NOT NULL DEFAULT 'main' CHECK (role IN ('main','featured','composer','producer')),
  position int NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, artist_id, role)
);
CREATE INDEX track_artists_artist ON track_artists(artist_id);

CREATE TABLE genres (
  id serial PRIMARY KEY,
  name varchar(60) NOT NULL,
  kind varchar(6) NOT NULL DEFAULT 'genre' CHECK (kind IN ('genre','mood')),
  color varchar(9) NOT NULL DEFAULT '#7c5cff',
  UNIQUE (kind, name)
);

CREATE TABLE track_genres (
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  genre_id int NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (track_id, genre_id)
);
CREATE INDEX track_genres_genre ON track_genres(genre_id);

CREATE TABLE folders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES folders(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE playlists (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  name varchar(100) NOT NULL,
  description varchar(300),
  cover_url text,
  visibility varchar(10) NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public','link')),
  is_collaborative boolean NOT NULL DEFAULT false,
  share_token varchar(32) NOT NULL,
  invite_token varchar(32),
  snapshot_id bigint NOT NULL DEFAULT 1,
  ops_since_renumber int NOT NULL DEFAULT 0,
  hidden_by_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX playlists_share_uq ON playlists(share_token);
CREATE UNIQUE INDEX playlists_invite_uq ON playlists(invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX idx_playlists_owner ON playlists(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX playlists_name_trgm ON playlists USING gin (f_norm(name) gin_trgm_ops);

CREATE TABLE playlist_items (
  id uuid PRIMARY KEY,
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position numeric(30,10) NOT NULL,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, position)
);
CREATE INDEX idx_playlist_items_track ON playlist_items(track_id);

CREATE TABLE playlist_collaborators (
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(8) NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, user_id)
);

CREATE TABLE library_items (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type varchar(10) NOT NULL CHECK (item_type IN ('track','album','artist','playlist')),
  item_id uuid NOT NULL,
  folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX library_items_item ON library_items(item_type, item_id);

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_type varchar(10) NOT NULL CHECK (followee_type IN ('user')),
  followee_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_type, followee_id)
);

CREATE TABLE play_history (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  device_id uuid,
  ms_played int NOT NULL DEFAULT 0,
  event varchar(8) NOT NULL DEFAULT 'end',
  context_type varchar(12),
  context_id text,
  offline boolean NOT NULL DEFAULT false,
  played_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX play_history_user ON play_history(user_id, played_at DESC);
CREATE INDEX play_history_track ON play_history(track_id, played_at);

CREATE TABLE play_counts (
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  day date NOT NULL,
  plays int NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, day)
);

CREATE TABLE search_history (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query varchar(200),
  item_type varchar(10),
  item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_history_user ON search_history(user_id, created_at DESC);

CREATE TABLE offline_licenses (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  key_wrapped text NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX offline_licenses_device ON offline_licenses(device_id);
CREATE INDEX offline_licenses_user ON offline_licenses(user_id) WHERE revoked_at IS NULL;

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(60) NOT NULL,
  target_type varchar(20),
  target_id text,
  details jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created ON audit_log(created_at DESC);

CREATE TABLE app_settings (
  key varchar(60) PRIMARY KEY,
  value jsonb NOT NULL
);
