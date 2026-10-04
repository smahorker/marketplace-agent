CREATE TABLE IF NOT EXISTS accounts (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('craigslist', 'mercari')),
  kernel_profile text NOT NULL,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'needs_reconnect')),
  UNIQUE (user_id, platform)
);

CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  photo_keys text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id serial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES products(id),
  account_id integer NOT NULL REFERENCES accounts(id),
  title text NOT NULL,
  fields jsonb NOT NULL, -- full per-site form values (MercariListing / CraigslistListing)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posting', 'live', 'failed')),
  url text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS threads (
  id serial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  listing_id integer REFERENCES listings(id),
  external_key text NOT NULL,
  buyer_name text,
  listing_title text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  unread boolean NOT NULL DEFAULT true,
  UNIQUE (account_id, external_key)
);

CREATE TABLE IF NOT EXISTS messages (
  id serial PRIMARY KEY,
  thread_id integer NOT NULL REFERENCES threads(id),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  body text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('received', 'draft', 'sending', 'sent', 'failed')),
  error text,
  external_key text,
  email_message_id text,
  UNIQUE (thread_id, external_key)
);

CREATE TABLE IF NOT EXISTS jobs (
  id serial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK (kind IN ('post_listing', 'sync_inbox', 'send_reply')),
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_running_per_account ON jobs (account_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS inbound_emails (
  agentmail_message_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO accounts (user_id, platform, kernel_profile) VALUES
  ('demo', 'mercari', 'seller-mercari'),
  ('demo', 'craigslist', 'seller-craigslist')
ON CONFLICT (user_id, platform) DO NOTHING;
