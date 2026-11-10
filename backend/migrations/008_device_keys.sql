-- Chave de aparelho: um aparelho fixo (ex.: a multimídia do carro) entra sozinho numa conta, sem tela de login.
-- Só o SHA-256 da chave fica no banco; a chave em si vai embutida no APK daquele aparelho (fora do git).
CREATE TABLE device_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
