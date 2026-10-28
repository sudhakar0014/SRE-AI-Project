CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  summary TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS resolutions (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  title TEXT NOT NULL,
  resolution TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incidents_updated ON incidents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_incident ON messages(incident_id, created_at);
CREATE INDEX IF NOT EXISTS idx_resolutions_incident ON resolutions(incident_id, created_at DESC);
