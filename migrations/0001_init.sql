-- 包级汇总元数据（每个包 id 一行）
CREATE TABLE packages (
  id TEXT NOT NULL,
  id_lower TEXT NOT NULL UNIQUE,
  title TEXT,
  description TEXT,
  authors TEXT,
  tags TEXT NOT NULL DEFAULT '',
  latest_version TEXT NOT NULL,
  listed INTEGER NOT NULL DEFAULT 1,
  downloads INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id_lower)
);

-- 具体版本行；content_key 指向 R2 对象
CREATE TABLE package_versions (
  id_lower TEXT NOT NULL,
  version TEXT NOT NULL,
  version_lower TEXT NOT NULL,
  nuspec_json TEXT NOT NULL,
  content_key TEXT NOT NULL,
  listed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id_lower, version_lower),
  FOREIGN KEY (id_lower) REFERENCES packages(id_lower)
);

CREATE INDEX idx_packages_updated ON packages(updated_at);
CREATE INDEX idx_packages_tags ON packages(tags);
CREATE INDEX idx_versions_created ON package_versions(created_at);
