CREATE OR REPLACE FUNCTION get_nearby_light_data(lat double precision, lon double precision)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
    light_data json;
BEGIN
    -- This is a simplified implementation. A more advanced version would
    -- calculate average durations and confidence scores based on multiple reports.
    -- For now, we find the closest light within a radius and return its latest report.

    -- Using a common table expression (CTE) to find the closest light
    WITH closest_light AS (
        SELECT
            r.latitude,
            r.longitude,
            -- Earth distance calculation (haversine formula)
            6371 * 2 * asin(sqrt(
                pow(sin(radians(lat - r.latitude) / 2), 2) +
                cos(radians(lat)) * cos(radians(r.latitude)) *
                pow(sin(radians(lon - r.longitude) / 2), 2)
            )) AS distance_km
        FROM
            reports r
        GROUP BY
            r.latitude, r.longitude
        ORDER BY
            distance_km
        LIMIT 1
    )
    -- Select the most recent report for the identified light
    SELECT
        json_build_object(
            'average_durations', json_build_object('green', 55, 'yellow', 5, 'red', 40), -- Using mock averages for now
            'last_seen_status', r.status,
            'last_seen_timestamp', r.created_at,
            'base_confidence', 'medium', -- Placeholder confidence
            'has_complete_averages', false -- Since we are using mock averages
        )
    INTO light_data
    FROM
        reports r
    JOIN
        closest_light cl ON r.latitude = cl.latitude AND r.longitude = cl.longitude
    ORDER BY
        r.created_at DESC
    LIMIT 1;

    RETURN light_data;
END;
$$;
