// Trafficlites Backend - Node.js + Express + PostgreSQL

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Still need Pool constructor
require('dotenv').config();
const axios = require('axios'); // Dependency: npm install axios

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Test route app.get('/', (req, res) => { res.send('Trafficlites API with PostgreSQL is running'); });

// POST: User submits traffic light report
app.post('/report', async (req, res) => {
  const { latitude, longitude, status } = req.body;
  const dbPool = req.app.locals.dbPool;

  if (latitude == null || longitude == null || !status) { // Check for null or undefined for coords
    return res.status(400).json({ error: 'Missing required fields: latitude, longitude, status' });
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'Invalid data type: latitude and longitude must be numbers.' });
  }
  // Basic status validation (example: ensure it's one of the expected values)
  const validStatuses = ['green', 'yellow', 'red', 'malfunctioning'];
  if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const result = await dbPool.query(
      'INSERT INTO reports (latitude, longitude, status, timestamp) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [latitude, longitude, status]
    );
    const newReport = result.rows[0];

    // Process the report for timing analysis (fire and forget, errors logged within)
    processReportForTiming(dbPool, newReport).catch(err => {
      console.error('Error in processReportForTiming:', err);
      // Decide if this error should be surfaced to the client,
      // for now, it's a background process, so we just log it.
    });

    res.status(201).json(newReport); // Return the newly created report
  } catch (err) {
    console.error('Database error in POST /report:', err);
    res.status(500).json({ error: 'Database error while saving report' });
  }
});

const CLUSTERING_RADIUS_METERS = 50; // 50 meters for clustering

// Haversine distance calculation
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

async function processReportForTiming(dbPool, report) {
  const { latitude, longitude, status, timestamp: reportTimestamp } = report;
  let clusterId;

  // 1. Find or Create Cluster
  const nearbyClusters = await dbPool.query(
    'SELECT *, (6371000 * acos(cos(radians($1)) * cos(radians(center_latitude)) * cos(radians(center_longitude) - radians($2)) + sin(radians($1)) * sin(radians(center_latitude)))) AS distance FROM traffic_light_clusters ORDER BY distance ASC LIMIT 1',
    [latitude, longitude]
  );

  let targetCluster = null;
  if (nearbyClusters.rows.length > 0) {
    const closestCluster = nearbyClusters.rows[0];
    if (closestCluster.distance <= CLUSTERING_RADIUS_METERS) {
      targetCluster = closestCluster;
    }
  }

  if (targetCluster) {
    clusterId = targetCluster.cluster_id;
    // Update cluster (weighted average for center, increment count)
    const newReportCount = targetCluster.report_count + 1;
    const oldWeight = targetCluster.report_count / newReportCount;
    const newWeight = 1 / newReportCount;
    const newCenterLatitude = (targetCluster.center_latitude * oldWeight) + (latitude * newWeight);
    const newCenterLongitude = (targetCluster.center_longitude * oldWeight) + (longitude * newWeight);

    await dbPool.query(
      'UPDATE traffic_light_clusters SET center_latitude = $1, center_longitude = $2, report_count = $3, updated_at = NOW() WHERE cluster_id = $4',
      [newCenterLatitude, newCenterLongitude, newReportCount, clusterId]
    );
    console.log(`[processReportForTiming] Updated cluster ${clusterId}`);
  } else {
    // Create new cluster
    const newClusterResult = await dbPool.query(
      'INSERT INTO traffic_light_clusters (center_latitude, center_longitude, report_count) VALUES ($1, $2, 1) RETURNING cluster_id',
      [latitude, longitude]
    );
    clusterId = newClusterResult.rows[0].cluster_id;
    console.log(`[processReportForTiming] Created new cluster ${clusterId}`);
  }

  // 2. Update Cycle Segments
  // Find the most recent segment for this cluster
  const lastSegmentResult = await dbPool.query(
    'SELECT * FROM traffic_light_cycle_segments WHERE cluster_id = $1 ORDER BY start_timestamp DESC, segment_id DESC LIMIT 1',
    [clusterId]
  );
  const lastSegment = lastSegmentResult.rows.length > 0 ? lastSegmentResult.rows[0] : null;

  if (lastSegment) {
    const newReportTime = new Date(reportTimestamp);
    const lastSegmentStartTime = new Date(lastSegment.start_timestamp);

    if (lastSegment.current_status !== status && lastSegment.end_timestamp === null) {
      // State change, finalize previous segment
      const durationSeconds = Math.round((newReportTime - lastSegmentStartTime) / 1000);
      await dbPool.query(
        'UPDATE traffic_light_cycle_segments SET end_timestamp = $1, duration_seconds = $2, is_estimated_end = FALSE WHERE segment_id = $3',
        [reportTimestamp, durationSeconds, lastSegment.segment_id]
      );
      console.log(`[processReportForTiming] Finalized segment ${lastSegment.segment_id} for cluster ${clusterId} with duration ${durationSeconds}s`);

      // Insert new segment
      await dbPool.query(
        'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())',
        [clusterId, lastSegment.current_status, status, reportTimestamp]
      );
      console.log(`[processReportForTiming] Started new segment for cluster ${clusterId} with status ${status}`);
    } else if (lastSegment.current_status === status && lastSegment.end_timestamp === null) {
      // Same status, could mean the light is still in this state.
      // We can choose to update the 'reported_at' of the current segment or simply ignore for duration calculation until state changes.
      // For simplicity, we'll assume a new report of the same status confirms the light is still in that state
      // but doesn't end the segment. We could update an "last_confirmed_at" type field if needed.
      // Or, if we want each report to generate a segment:
      // For now, let's assume a report of the same status doesn't create a new segment unless the previous one was closed.
      // This might need refinement based on how we want to interpret consecutive same-status reports.
      // A simpler approach: if the status is the same, and the previous segment is open, we just log it.
      // If the previous segment was closed (e.g. by timeout logic not yet implemented), then start a new one.
      console.log(`[processReportForTiming] Received report with same status '${status}' for open segment ${lastSegment.segment_id}. No new segment created, no old segment closed.`);
      // If we wanted every report to effectively "re-affirm" the start of its state,
      // potentially closing an old one with an estimated end:
      // This is more complex. For now, we only act on state changes.
    } else if (lastSegment.current_status !== status && lastSegment.end_timestamp !== null) {
      // Previous segment was already closed, this is a new state sequence.
      await dbPool.query(
        'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())',
        [clusterId, lastSegment.current_status, status, reportTimestamp]
      );
       console.log(`[processReportForTiming] Started new segment (after a closed one) for cluster ${clusterId} with status ${status}`);
    } else if (lastSegment.current_status === status && lastSegment.end_timestamp !== null) {
        // Previous segment of same status was closed (e.g. timed out). This new report starts a new segment of that same status.
         await dbPool.query(
            'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())',
            [clusterId, lastSegment.current_status, status, reportTimestamp]
        );
        console.log(`[processReportForTiming] Started new segment (same status as last, but last was closed) for cluster ${clusterId} with status ${status}`);
    }

  } else {
    // No previous segment for this cluster, first report.
    await dbPool.query(
      'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())',
      [clusterId, null, status, reportTimestamp] // previous_status is null for the very first segment
    );
    console.log(`[processReportForTiming] Started first segment for cluster ${clusterId} with status ${status}`);
  }
}


// GET: Return all reports
app.get('/reports', async (req, res) => {
  const dbPool = req.app.locals.dbPool;
  try {
    const result = await dbPool.query('SELECT * FROM reports ORDER BY timestamp DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Database error in GET /reports:', err);
    res.status(500).json({ error: 'Database error while fetching reports' });
  }
});


app.listen(PORT, async () => {
  // Define pool directly inside app.listen
  const localPool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/trafficlites' });

  // Define initDb directly inside app.listen
  const localInitDb = async (dbPool) => {
    console.log('[localInitDb] Attempting to connect and create table...');
    try {
      const startTime = Date.now();
      // Ensure 'reports' table exists
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS reports (
          id SERIAL PRIMARY KEY,
          latitude FLOAT NOT NULL,
          longitude FLOAT NOT NULL,
          status TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log(`[localInitDb] Table 'reports' ensured/created.`);

      // Ensure 'traffic_light_clusters' table exists
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS traffic_light_clusters (
          cluster_id SERIAL PRIMARY KEY,
          center_latitude FLOAT NOT NULL,
          center_longitude FLOAT NOT NULL,
          report_count INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log(`[localInitDb] Table 'traffic_light_clusters' ensured/created.`);

      // Ensure 'traffic_light_cycle_segments' table exists
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS traffic_light_cycle_segments (
          segment_id SERIAL PRIMARY KEY,
          cluster_id INTEGER REFERENCES traffic_light_clusters(cluster_id) ON DELETE CASCADE,
          previous_status TEXT,
          current_status TEXT NOT NULL,
          start_timestamp TIMESTAMP NOT NULL,
          end_timestamp TIMESTAMP,
          duration_seconds INTEGER,
          is_estimated_end BOOLEAN DEFAULT FALSE,
          reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log(`[localInitDb] Table 'traffic_light_cycle_segments' ensured/created.`);

      const duration = Date.now() - startTime;
      console.log(`[localInitDb] All tables ensured/created successfully in ${duration}ms.`);
    } catch (dbError) {
      console.error('[localInitDb] !!! Database query failed during initialization !!!');
      console.error(`[localInitDb] Error Code: ${dbError.code}`);
      console.error(`[localInitDb] Error Message: ${dbError.message}`);
      console.error(`[localInitDb] Full Error:`, dbError);
      // Re-throw the error so it can be caught by the app.listen catch block,
      // which should then trigger process.exit(1)
      throw dbError;
    }
  };

  try {
    app.locals.dbPool = localPool; // Make pool available to routes via req.app.locals.dbPool
    await localInitDb(localPool); // Re-enable DB initialization
    console.log(`Trafficlites backend listening on port ${PORT}`);
    // Routes will now use app.locals.dbPool
  } catch (err) {
    console.error('Error during startup in app.listen:', err);
    if (localPool) { // Attempt to close pool if it was created before error
        localPool.end().catch(poolEndErr => console.error('Error ending localPool during startup error', poolEndErr));
    }
    process.exit(1); // Exit if startup fails
  }
  // Pool should remain active while server is running.
  // Consider graceful shutdown for closing pool on server exit (e.g. process.on('SIGINT', ...))
});

function getNextStatus(currentStatus) {
  if (currentStatus === 'green') return 'yellow';
  if (currentStatus === 'yellow') return 'red';
  if (currentStatus === 'red') return 'green';
  return 'unknown';
}

// --- Simulation Helper Functions ---

// lightData: { average_durations: { green, yellow, red }, last_seen_status, last_seen_timestamp (Date object) }
// arrivalTimeInMs: time in milliseconds (e.g., Date.getTime())
function predictLightStateAtFutureTime(lightData, arrivalTimeInMs) {
  const { average_durations, last_seen_status, last_seen_timestamp } = lightData;

  // Use a larger default if specific averages are missing, to make simulation proceed.
  // Consider impact on accuracy - 'unknown' might be better if critical averages are missing.
  const G_AVG = (average_durations && average_durations.green != null) ? average_durations.green : 60;
  const Y_AVG = (average_durations && average_durations.yellow != null) ? average_durations.yellow : 5;
  const R_AVG = (average_durations && average_durations.red != null) ? average_durations.red : 45;

  const effective_averages = {
      green: G_AVG,
      yellow: Y_AVG,
      red: R_AVG,
      unknown: 60 // Default for unknown state if it somehow occurs
  };

  if (!last_seen_status || !last_seen_timestamp) {
    return { predicted_status: 'unknown', wait_time_seconds: 0 }; // Default high wait for unknown?
  }

  let currentSimTimeMs = last_seen_timestamp.getTime();
  let currentSimStatus = last_seen_status;

  if (arrivalTimeInMs < currentSimTimeMs) {
    // Trying to predict for a time before our last known state - this is tricky / usually an error in caller.
    // For now, assume it's still in last_seen_status, no wait.
    // Or, if arrivalTime is very close to last_seen_timestamp, this might be fine.
    if ((currentSimTimeMs - arrivalTimeInMs) < 1000 ) { // within 1 sec
        return { predicted_status: last_seen_status, wait_time_seconds: 0 };
    }
    // If significantly in the past, it's an unknown.
    return { predicted_status: 'unknown', wait_time_seconds: 0 };
  }


  while (currentSimTimeMs < arrivalTimeInMs) {
    const avgDurationForCurrentSimStatusMs = (effective_averages[currentSimStatus.toLowerCase()] || 60) * 1000;

    if (currentSimTimeMs + avgDurationForCurrentSimStatusMs > arrivalTimeInMs) {
      // Arrival happens within this currentSimStatus
      let timeRemainingInCurrentSimStatusMs = (currentSimTimeMs + avgDurationForCurrentSimStatusMs) - arrivalTimeInMs;
      let wait_time_seconds = 0;
      if (currentSimStatus === 'red') {
        wait_time_seconds = Math.max(0, Math.round(timeRemainingInCurrentSimStatusMs / 1000));
      } else if (currentSimStatus === 'yellow') {
        const avgRedDurationMs = (effective_averages.red || 45) * 1000;
        wait_time_seconds = Math.max(0, Math.round((timeRemainingInCurrentSimStatusMs + avgRedDurationMs) / 1000));
      }
      return { predicted_status: currentSimStatus, wait_time_seconds: wait_time_seconds };
    } else {
      currentSimTimeMs += avgDurationForCurrentSimStatusMs;
      currentSimStatus = getNextStatus(currentSimStatus);
    }
  }

  // Arrival is exactly at a transition point. currentSimStatus is the state it JUST turned TO.
  let wait_time_seconds = 0;
  if (currentSimStatus === 'red') {
    wait_time_seconds = Math.round(effective_averages.red);
  } else if (currentSimStatus === 'yellow') {
    wait_time_seconds = Math.round(effective_averages.yellow + effective_averages.red);
  }
  return { predicted_status: currentSimStatus, wait_time_seconds: wait_time_seconds };
}

async function simulateRouteForDeparture(simulatableRoute, departureTimeMs, lightPredictionsMap, dbPool) {
  let totalWaitTimeSeconds = 0;
  let accumulatedTravelTimeMs = 0; // Time from departure, not including waits yet

  for (const segment of simulatableRoute.segments) {
    // Travel time for this segment (from Google Directions)
    const segmentTravelTimeMs = segment.duration_seconds * 1000;

    // Arrival time at the END of this segment, BEFORE considering the light (if any)
    const arrivalAtSegmentEndWithoutLightMs = departureTimeMs + accumulatedTravelTimeMs + segmentTravelTimeMs;

    accumulatedTravelTimeMs += segmentTravelTimeMs; // Add this segment's travel to overall travel

    if (segment.ends_at_traffic_light_cluster_id) {
      const lightData = lightPredictionsMap.get(segment.ends_at_traffic_light_cluster_id);

      if (lightData) {
        // Ensure last_seen_timestamp is a Date object
        const lightDataForSim = {
            ...lightData,
            last_seen_timestamp: new Date(lightData.last_seen_timestamp) // Convert if string
        };

        const predictionAtArrival = predictLightStateAtFutureTime(lightDataForSim, arrivalAtSegmentEndWithoutLightMs);
        totalWaitTimeSeconds += predictionAtArrival.wait_time_seconds;
        // This wait time effectively extends the time spent before starting the next segment
        accumulatedTravelTimeMs += (predictionAtArrival.wait_time_seconds * 1000);
      } else {
        console.warn(`Sim: No prediction data for light cluster ${segment.ends_at_traffic_light_cluster_id}. Assuming 0 wait.`);
      }
    }
  }
  return totalWaitTimeSeconds;
}

async function getDepartureAdvice(simulatableRoute, lightPredictionsMap, dbPool) {
  if (!simulatableRoute || !simulatableRoute.segments || simulatableRoute.segments.length === 0) {
    return {
      advice: "Route data is insufficient for departure advice.",
      optimal_departure_offset_seconds: 0,
      baseline_wait_time_seconds: null,
      optimal_wait_time_seconds: null,
      wait_time_savings_seconds: 0,
    };
  }

  const currentTimeMs = new Date().getTime();
  let bestOffsetSeconds = 0;

  const baselineWaitTimeSeconds = await simulateRouteForDeparture(simulatableRoute, currentTimeMs, lightPredictionsMap, dbPool);
  let minWaitTimeSeconds = baselineWaitTimeSeconds;

  const offsetsToTest = [-60, -30, 30, 60, 90, 120, 150, 180];

  for (const offset of offsetsToTest) {
    const departureTimeMs = currentTimeMs + (offset * 1000);
    const currentWaitTimeSeconds = await simulateRouteForDeparture(simulatableRoute, departureTimeMs, lightPredictionsMap, dbPool);

    if (currentWaitTimeSeconds < minWaitTimeSeconds) {
      minWaitTimeSeconds = currentWaitTimeSeconds;
      bestOffsetSeconds = offset;
    }
  }

  const waitTimeSavingsSeconds = baselineWaitTimeSeconds - minWaitTimeSeconds;

  let adviceMessage = "Current departure time seems reasonable based on predictions.";
  if (bestOffsetSeconds > 0 && waitTimeSavingsSeconds > 10) {
    adviceMessage = `Consider departing in ${bestOffsetSeconds} seconds to potentially save ~${Math.round(waitTimeSavingsSeconds)}s at lights.`;
  } else if (bestOffsetSeconds < 0 && waitTimeSavingsSeconds > 10) {
     adviceMessage = `If you had left ${-bestOffsetSeconds} seconds ago, you might have saved ~${Math.round(waitTimeSavingsSeconds)}s. For current departure, timing seems reasonable.`;
  } else if (waitTimeSavingsSeconds <= 0 && bestOffsetSeconds === 0 && baselineWaitTimeSeconds !== null) {
     adviceMessage = "Departing now appears to be optimal based on current predictions.";
  } else if (baselineWaitTimeSeconds === null) {
    adviceMessage = "Could not determine baseline wait time; advice unavailable.";
  }


  return {
    advice: adviceMessage,
    optimal_departure_offset_seconds: bestOffsetSeconds,
    baseline_wait_time_seconds: baselineWaitTimeSeconds !== null ? Math.round(baselineWaitTimeSeconds) : null,
    optimal_wait_time_seconds: minWaitTimeSeconds !== null ? Math.round(minWaitTimeSeconds) : null,
    wait_time_savings_seconds: waitTimeSavingsSeconds !== null ? Math.round(waitTimeSavingsSeconds) : 0,
  };
}

// --- End Simulation Helper Functions ---

// Helper to decode Google's encoded polyline format
function decodeGooglePolyline(encoded) {
    if (!encoded) return [];
    let points = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
    return points;
}

// Helper function to fetch light timing and base prediction data for a specific cluster_id
async function fetchLightTimingAndPredictionDataForCluster(dbPool, clusterId) {
    try {
        const avgDurationsResult = await dbPool.query(
            `SELECT current_status, AVG(duration_seconds) as avg_duration
             FROM traffic_light_cycle_segments
             WHERE cluster_id = $1 AND duration_seconds IS NOT NULL AND current_status IN ('green', 'yellow', 'red')
             GROUP BY current_status`,
            [clusterId]
        );
        const average_durations = { green: null, yellow: null, red: null };
        avgDurationsResult.rows.forEach(row => {
            average_durations[row.current_status.toLowerCase()] = Math.round(row.avg_duration);
        });

        const lastSegmentResult = await dbPool.query(
           `SELECT current_status, start_timestamp
            FROM traffic_light_cycle_segments
            WHERE cluster_id = $1 ORDER BY start_timestamp DESC LIMIT 1`,
            [clusterId]
        );

        if (lastSegmentResult.rows.length === 0 && avgDurationsResult.rows.length === 0) return null;

        const lastSegment = lastSegmentResult.rows.length > 0 ? lastSegmentResult.rows[0] : null;

        return {
            cluster_id: clusterId, // Good to have for mapping
            average_durations,
            // Data needed by predictLightStateAtFutureTime
            last_seen_status: lastSegment ? lastSegment.current_status : null,
            last_seen_timestamp: lastSegment ? new Date(lastSegment.start_timestamp) : null
        };
    } catch(e) {
        console.error(`Error fetching light data for cluster ${clusterId}:`, e);
        return null;
    }
}


app.post('/route_departure_advice', async (req, res) => {
  const dbPool = req.app.locals.dbPool;
  const { origin, destination } = req.body; // Expects { origin: {lat, lon}, destination: {lat, lon} }

  if (!origin || typeof origin.lat !== 'number' || typeof origin.lon !== 'number' ||
      !destination || typeof destination.lat !== 'number' || typeof destination.lon !== 'number') {
    return res.status(400).json({ error: 'Invalid origin or destination format. Expected {lat: number, lon: number}.' });
  }

  const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY_BACKEND;
  if (!GOOGLE_API_KEY) {
    console.error('Google Maps API Key (GOOGLE_MAPS_API_KEY_BACKEND) for backend is not configured in .env');
    return res.status(500).json({ error: 'Routing service API key not configured on server.' });
  }

  try {
    // 1. Fetch route from Google Directions API
    const googleDirectionsURL = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lon}&destination=${destination.lat},${destination.lon}&key=${GOOGLE_API_KEY}`;
    let googleRouteData;
    try {
      const directionsResponse = await axios.get(googleDirectionsURL);
      if (directionsResponse.data.routes && directionsResponse.data.routes.length > 0) {
        googleRouteData = directionsResponse.data.routes[0];
      } else {
        return res.status(404).json({ error: 'Route not found by Google Directions API.', details: directionsResponse.data.status });
      }
    } catch (e) {
      console.error('Error fetching from Google Directions API:', e.message);
      return res.status(502).json({ error: 'Failed to fetch route from external routing service.' });
    }

    // 2. Construct SimulatableRoute
    const simulatableRoute = {
      origin: { latitude: googleRouteData.legs[0].start_location.lat, longitude: googleRouteData.legs[0].start_location.lng },
      destination: { latitude: googleRouteData.legs[0].end_location.lat, longitude: googleRouteData.legs[0].end_location.lng },
      total_initial_duration_seconds: googleRouteData.legs[0].duration.value,
      total_distance_meters: googleRouteData.legs[0].distance.value,
      segments: [], // This will be populated based on Google steps and our lights
    };

    const lightPredictionsMap = new Map(); // cluster_id -> lightData for simulation
    const allRoutePolylinePoints = decodeGooglePolyline(googleRouteData.overview_polyline.points);
    let accumulatedDurationSeconds = 0;

    // More robust light identification and segment creation:
    // Iterate through Google's route steps. For each step, check for lights along its path.
    for (const step of googleRouteData.legs[0].steps) {
        const stepStartLat = step.start_location.lat;
        const stepStartLon = step.start_location.lng;
        const stepEndLat = step.end_location.lat;
        const stepEndLon = step.end_location.lng;
        const stepDurationSeconds = step.duration.value;

        // Simplified: Check midpoint of the step for a nearby light cluster
        // A production system would sample along the step's polyline or use spatial queries.
        const midLat = (stepStartLat + stepEndLat) / 2;
        const midLon = (stepStartLon + stepEndLon) / 2;

        const nearbyClusterResult = await dbPool.query(
           `SELECT cluster_id
            FROM traffic_light_clusters,
                 (SELECT $1::float AS lat, $2::float AS lon) AS search_point
            ORDER BY ST_Distance(
                ST_SetSRID(ST_MakePoint(center_longitude, center_latitude), 4326)::geography,
                ST_SetSRID(ST_MakePoint(search_point.lon, search_point.lat), 4326)::geography
            ) ASC
            LIMIT 1`, // This query requires PostGIS ST_Distance, ST_MakePoint, ST_SetSRID.
                      // If PostGIS is not available, fallback to Haversine in app or simpler DB query.
                      // For now, using Haversine-like logic as before for consistency:
        // [midLat, midLon] // Parameters for the PostGIS version
        );
        // Fallback to Haversine if PostGIS not used:
        const fallbackNearbyCluster = await dbPool.query(
             `SELECT cluster_id, (6371000 * acos(cos(radians($1)) * cos(radians(center_latitude)) * cos(radians(center_longitude) - radians($2)) + sin(radians($1)) * sin(radians(center_latitude)))) AS distance
              FROM traffic_light_clusters ORDER BY distance ASC LIMIT 1`,
            [midLat, midLon]
        );

        let lightClusterIdForThisSegmentEnd = null;
        if (fallbackNearbyCluster.rows.length > 0 && fallbackNearbyCluster.rows[0].distance < CLUSTERING_RADIUS_METERS * 1.5) { // Wider radius for step matching
            lightClusterIdForThisSegmentEnd = fallbackNearbyCluster.rows[0].cluster_id;
            if (!lightPredictionsMap.has(lightClusterIdForThisSegmentEnd)) {
                const lightData = await fetchLightTimingAndPredictionDataForCluster(dbPool, lightClusterIdForThisSegmentEnd);
                if (lightData) {
                    lightPredictionsMap.set(lightClusterIdForThisSegmentEnd, lightData);
                }
            }
        }

        simulatableRoute.segments.push({
            start_location: { latitude: stepStartLat, longitude: stepStartLon },
            end_location: { latitude: stepEndLat, longitude: stepEndLon },
            duration_seconds: stepDurationSeconds,
            distance_meters: step.distance.value,
            ends_at_traffic_light_cluster_id: lightClusterIdForThisSegmentEnd
        });
        accumulatedDurationSeconds += stepDurationSeconds;
    }


    if (lightPredictionsMap.size === 0) {
        return res.json({
            advice: "No known traffic lights with timing data found on this route to provide advice.",
            optimal_departure_offset_seconds: 0,
            baseline_wait_time_seconds: null,
            optimal_wait_time_seconds: null,
            wait_time_savings_seconds: 0,
            route: googleRouteData
        });
    }

    // 3. Call getDepartureAdvice
    const adviceResult = await getDepartureAdvice(simulatableRoute, lightPredictionsMap, dbPool);

    res.json({ ...adviceResult, route: googleRouteData });

  } catch (err) {
    console.error('Error in /route_departure_advice:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error while generating departure advice.' });
  }
});


// GET: Calculate and return average light timings AND PREDICTION for a nearby cluster
app.get('/light_timings/:latitude/:longitude', async (req, res) => {
  const dbPool = req.app.locals.dbPool;
  const { latitude, longitude } = req.params;
  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);

  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: 'Invalid latitude or longitude format.' });
  }

  try {
    // 1. Find the nearest cluster
    const nearbyClusters = await dbPool.query(
      // Using Haversine formula for distance calculation in SQL
      // (approximates Earth as a sphere, good enough for this use case)
      `SELECT *, (
        6371000 * acos(
          cos(radians($1)) * cos(radians(center_latitude)) *
          cos(radians(center_longitude) - radians($2)) +
          sin(radians($1)) * sin(radians(center_latitude))
        )
      ) AS distance
      FROM traffic_light_clusters
      ORDER BY distance ASC
      LIMIT 1`,
      [lat, lon]
    );

    if (nearbyClusters.rows.length === 0) {
      return res.status(404).json({ message: 'No traffic light clusters found nearby.' });
    }

    const closestCluster = nearbyClusters.rows[0];
    // Optional: Check if the closest cluster is within a certain max distance
    // if (closestCluster.distance > MAX_DISTANCE_FOR_TIMINGS_METERS) {
    //   return res.status(404).json({ message: 'No traffic light clusters close enough to provide timings.' });
    // }

    const clusterId = closestCluster.cluster_id;

    // 2. Calculate Average Durations
    const avgDurationsResult = await dbPool.query(
      `SELECT current_status, AVG(duration_seconds) as avg_duration
       FROM traffic_light_cycle_segments
       WHERE cluster_id = $1 AND duration_seconds IS NOT NULL AND current_status IN ('green', 'yellow', 'red')
       GROUP BY current_status`,
      [clusterId]
    );

    const averageDurations = { green: null, yellow: null, red: null };
    avgDurationsResult.rows.forEach(row => {
      averageDurations[row.current_status.toLowerCase()] = Math.round(row.avg_duration);
    });

    // Initialize response payload
    let responsePayload = {
      cluster_id: clusterId,
      cluster_center: {
        latitude: closestCluster.center_latitude,
        longitude: closestCluster.center_longitude,
      },
      reports_in_cluster: closestCluster.report_count,
      average_durations: averageDurations,
      prediction: {
        predicted_current_status: 'unknown',
        predicted_time_remaining_seconds: null,
        prediction_confidence: 'low',
        last_seen_status: null,
        last_seen_timestamp: null,
      },
    };

    // 3. Fetch Most Recent Segment for Prediction Logic
    const lastSegmentResult = await dbPool.query(
      `SELECT current_status, start_timestamp, end_timestamp
       FROM traffic_light_cycle_segments
       WHERE cluster_id = $1
       ORDER BY start_timestamp DESC
       LIMIT 1`,
      [clusterId]
    );

    if (lastSegmentResult.rows.length > 0) {
      const lastSegment = lastSegmentResult.rows[0];
      responsePayload.prediction.last_seen_status = lastSegment.current_status;
      responsePayload.prediction.last_seen_timestamp = lastSegment.start_timestamp;

      const timeSinceLastStart = Math.round((new Date() - new Date(lastSegment.start_timestamp)) / 1000); // in seconds

      // Basic Confidence Logic
      if (closestCluster.report_count >= 5 && timeSinceLastStart < 600) { // At least 5 reports, last seen < 10 mins
        responsePayload.prediction.prediction_confidence = 'medium';
        if (closestCluster.report_count >= 10 && timeSinceLastStart < 300) { // At least 10 reports, last seen < 5 mins
          responsePayload.prediction.prediction_confidence = 'high';
        }
      }

      const avgDurationForLastSeen = averageDurations[lastSegment.current_status.toLowerCase()];

      if (responsePayload.prediction.prediction_confidence !== 'low' && avgDurationForLastSeen !== null) {
        if (lastSegment.end_timestamp === null) { // Case A: Last segment is OPEN
          let timeRemaining = avgDurationForLastSeen - timeSinceLastStart;
          if (timeRemaining > 0) {
            responsePayload.prediction.predicted_current_status = lastSegment.current_status;
            responsePayload.prediction.predicted_time_remaining_seconds = Math.round(timeRemaining);
          } else { // Light likely changed
            const nextStatus = getNextStatus(lastSegment.current_status);
            responsePayload.prediction.predicted_current_status = nextStatus;
            const avgDurationForNext = averageDurations[nextStatus.toLowerCase()];
            if (avgDurationForNext !== null) {
              let timeIntoNext = -timeRemaining; // how much it overshot
              responsePayload.prediction.predicted_time_remaining_seconds = Math.round(avgDurationForNext - timeIntoNext);
              if (responsePayload.prediction.predicted_time_remaining_seconds < 0) {
                responsePayload.prediction.predicted_time_remaining_seconds = null;
                responsePayload.prediction.prediction_confidence = 'low'; // Downgrade if cycled further or unpredictable
              }
            } else {
              responsePayload.prediction.predicted_current_status = 'unknown';
              responsePayload.prediction.prediction_confidence = 'low';
            }
          }
        } else { // Case B: Last segment is CLOSED
          const timeSinceLastEnd = Math.round((new Date() - new Date(lastSegment.end_timestamp)) / 1000);
          if (timeSinceLastEnd < 60 && responsePayload.prediction.prediction_confidence !== 'low') { // If closed < 1 min ago
            responsePayload.prediction.predicted_current_status = getNextStatus(lastSegment.current_status);
            responsePayload.prediction.predicted_time_remaining_seconds = null; // Hard to tell remaining for this new state
          } else {
            responsePayload.prediction.prediction_confidence = 'low'; // Too old or closed too long ago
          }
        }
      } else {
        responsePayload.prediction.prediction_confidence = 'low'; // Not enough data for confident prediction
      }
    } else { // No segments at all for this cluster
        // Average durations would also be null.
        // No basis for prediction. Keep defaults.
    }

    // If no segments were found for average calculation AND no last segment was found,
    // it implies the cluster has no timing data at all.
    if (avgDurationsResult.rows.length === 0 && lastSegmentResult.rows.length === 0) {
      // Return a more specific message if no data whatsoever for the cluster.
      // The default 'unknown' and 'low' confidence in payload is okay,
      // but we might choose to return 404 if not even average_durations could be computed.
      // For now, we'll allow returning the payload with null averages and 'unknown' prediction.
    }

    res.json(responsePayload);

  } catch (err) {
    console.error(`Database error in GET /light_timings/${latitude}/${longitude}:`, err);
    res.status(500).json({ error: 'Database error while fetching light timings' });
  }
});
