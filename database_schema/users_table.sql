CREATE TABLE Users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    auth_provider VARCHAR(50),
    auth_provider_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    reputation_score INTEGER DEFAULT 0,
    CONSTRAINT uq_auth_provider_id UNIQUE (auth_provider, auth_provider_id)
);

COMMENT ON COLUMN Users.username IS 'Optional username for display';
COMMENT ON COLUMN Users.email IS 'User''s email, unique if provided';
COMMENT ON COLUMN Users.password_hash IS 'Hashed password if using email/password auth';
COMMENT ON COLUMN Users.auth_provider IS 'Authentication provider, e.g., ''google'', ''apple'', ''email''';
COMMENT ON COLUMN Users.auth_provider_id IS 'User ID from the authentication provider';
COMMENT ON COLUMN Users.reputation_score IS 'Score based on 
