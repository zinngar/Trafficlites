CREATE TABLE reports (
    report_id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('green', 'yellow', 'red'))
);

COMMENT ON TABLE reports IS 'Stores user-submitted traffic light status reports.';
COMMENT ON COLUMN reports.latitude IS 'The latitude of the reported traffic light.';
COMMENT ON COLUMN reports.longitude IS 'The longitude of the reported traffic light.';
COMMENT ON COLUMN reports.status IS 'The reported status of the traffic light (green, yellow, or red).';
