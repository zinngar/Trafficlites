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
    // console.log(`[processReportForTiming] Updated cluster ${clusterId}`);
  } else {
    // Create new cluster
    const newClusterResult = await dbPool.query(
      'INSERT INTO traffic_light_clusters (center_latitude, center_longitude, report_count) VALUES ($1, $2, 1) RETURNING cluster_id',
      [latitude, longitude]
    );
    clusterId = newClusterResult.rows[0].cluster_id;
    // console.log(`[processReportForTiming] Created new cluster ${clusterId}`);
  }

  // 2. Update Cycle Segments
  const lastSegmentResult = await dbPool.query(
    'SELECT * FROM traffic_light_cycle_segments WHERE cluster_id = $1 ORDER BY start_timestamp DESC, segment_id DESC LIMIT 1',
    [clusterId]
  );
  const lastSegment = lastSegmentResult.rows.length > 0 ? lastSegmentResult.rows[0] : null;

  if (lastSegment) {
    const newReportTime = new Date(reportTimestamp);
    const lastSegmentStartTime = new Date(lastSegment.start_timestamp);

    if (lastSegment.current_status !== status && lastSegment.end_timestamp === null) {
      const durationSeconds = Math.round((newReportTime - lastSegmentStartTime) / 1000);
      await dbPool.query(
        'UPDATE traffic_light_cycle_segments SET end_timestamp = $1, duration_seconds = $2, is_estimated_end = FALSE WHERE segment_id = $3',
        [reportTimestamp, durationSeconds, lastSegment.segment_id]
      );
      await dbPool.query(
        'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())',
        [clusterId, lastSegment.current_status, status, reportTimestamp]
      );
    } else if (lastSegment.current_status !== status && lastSegment.end_timestamp !== null) {
      await dbPool.query(
        'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())',
        [clusterId, lastSegment.current_status, status, reportTimestamp]
      );
    } else if (lastSegment.current_status === status && lastSegment.end_timestamp !== null) {
         await dbPool.query(
            'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())',
            [clusterId, lastSegment.current_status, status, reportTimestamp]
        );
    }
  } else {
    await dbPool.query(
      'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())',
      [clusterId, null, status, reportTimestamp]
    );
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
  const localPool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/trafficlites' });
  const localInitDb = async (dbPool) => {
    try {
      await dbPool.query(`CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, latitude FLOAT NOT NULL, longitude FLOAT NOT NULL, status TEXT NOT NULL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
      await dbPool.query(`CREATE TABLE IF NOT EXISTS traffic_light_clusters (cluster_id SERIAL PRIMARY KEY, center_latitude FLOAT NOT NULL, center_longitude FLOAT NOT NULL, report_count INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
      await dbPool.query(`CREATE TABLE IF NOT EXISTS traffic_light_cycle_segments (segment_id SERIAL PRIMARY KEY, cluster_id INTEGER REFERENCES traffic_light_clusters(cluster_id) ON DELETE CASCADE, previous_status TEXT, current_status TEXT NOT NULL, start_timestamp TIMESTAMP NOT NULL, end_timestamp TIMESTAMP, duration_seconds INTEGER, is_estimated_end BOOLEAN DEFAULT FALSE, reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
      console.log(`[localInitDb] All tables ensured/created successfully.`);
    } catch (dbError) {
      console.error('[localInitDb] !!! Database query failed during initialization !!!', dbError); throw dbError;
    }
  };
  try {
    app.locals.dbPool = localPool;
    await localInitDb(localPool);
    console.log(`Trafficlites backend listening on port ${PORT}`);
  } catch (err) {
    console.error('Error during startup in app.listen:', err);
    if (localPool) { localPool.end().catch(poolEndErr => console.error('Error ending localPool during startup error', poolEndErr));}
    process.exit(1);
  }
});

function getNextStatus(currentStatus) {
  if (currentStatus === 'green') return 'yellow';
  if (currentStatus === 'yellow') return 'red';
  if (currentStatus === 'red') return 'green';
  return 'unknown';
}

function predictLightStateAtFutureTime(lightData, arrivalTimeInMs) {
  const { average_durations, last_seen_status, last_seen_timestamp } = lightData;
  const G_AVG = (average_durations && average_durations.green != null) ? average_durations.green : 60;
  const Y_AVG = (average_durations && average_durations.yellow != null) ? average_durations.yellow : 5;
  const R_AVG = (average_durations && average_durations.red != null) ? average_durations.red : 45;
  const effective_averages = { green: G_AVG, yellow: Y_AVG, red: R_AVG, unknown: 60 };

  if (!last_seen_status || !last_seen_timestamp) return { predicted_status: 'unknown', wait_time_seconds: 0 };
  let currentSimTimeMs = last_seen_timestamp.getTime();
  let currentSimStatus = last_seen_status;
  if (arrivalTimeInMs < currentSimTimeMs) {
    return (currentSimTimeMs - arrivalTimeInMs) < 1000 ? { predicted_status: last_seen_status, wait_time_seconds: 0 } : { predicted_status: 'unknown', wait_time_seconds: 0 };
  }
  while (currentSimTimeMs < arrivalTimeInMs) {
    const avgDurationForCurrentSimStatusMs = (effective_averages[currentSimStatus.toLowerCase()] || 60) * 1000;
    if (currentSimTimeMs + avgDurationForCurrentSimStatusMs > arrivalTimeInMs) {
      let timeRemainingInCurrentSimStatusMs = (currentSimTimeMs + avgDurationForCurrentSimStatusMs) - arrivalTimeInMs;
      let wait_time_seconds = 0;
      if (currentSimStatus === 'red') wait_time_seconds = Math.max(0, Math.round(timeRemainingInCurrentSimStatusMs / 1000));
      else if (currentSimStatus === 'yellow') wait_time_seconds = Math.max(0, Math.round((timeRemainingInCurrentSimStatusMs + (effective_averages.red * 1000)) / 1000));
      return { predicted_status: currentSimStatus, wait_time_seconds: wait_time_seconds };
    } else {
      currentSimTimeMs += avgDurationForCurrentSimStatusMs;
      currentSimStatus = getNextStatus(currentSimStatus);
    }
  }
  let wait_time_seconds = 0;
  if (currentSimStatus === 'red') wait_time_seconds = Math.round(effective_averages.red);
  else if (currentSimStatus === 'yellow') wait_time_seconds = Math.round(effective_averages.yellow + effective_averages.red);
  return { predicted_status: currentSimStatus, wait_time_seconds: wait_time_seconds };
}

async function simulateRouteForDeparture(simulatableRoute, departureTimeMs, lightPredictionsMap) {
  let totalWaitTimeSeconds = 0;
  let accumulatedTravelTimeMs = 0;
  for (const segment of simulatableRoute.segments) {
    const segmentTravelTimeMs = segment.duration_seconds * 1000;
    const arrivalAtSegmentEndWithoutLightMs = departureTimeMs + accumulatedTravelTimeMs + segmentTravelTimeMs;
    accumulatedTravelTimeMs += segmentTravelTimeMs;
    if (segment.ends_at_traffic_light_cluster_id) {
      const lightData = lightPredictionsMap.get(segment.ends_at_traffic_light_cluster_id);
      if (lightData) {
        const lightDataForSim = { ...lightData, last_seen_timestamp: new Date(lightData.last_seen_timestamp) };
        const predictionAtArrival = predictLightStateAtFutureTime(lightDataForSim, arrivalAtSegmentEndWithoutLightMs);
        totalWaitTimeSeconds += predictionAtArrival.wait_time_seconds;
        accumulatedTravelTimeMs += (predictionAtArrival.wait_time_seconds * 1000);
      } else {
        console.warn(`Sim: No prediction data for light ${segment.ends_at_traffic_light_cluster_id}. Assuming 0 wait.`);
      }
    }
  }
  return totalWaitTimeSeconds;
}

async function getDepartureAdvice(simulatableRoute, lightPredictionsMap) {
  if (!simulatableRoute || !simulatableRoute.segments || simulatableRoute.segments.length === 0) {
    return { advice: "Route data insufficient.", optimal_departure_offset_seconds: 0, baseline_wait_time_seconds: null, optimal_wait_time_seconds: null, wait_time_savings_seconds: 0 };
  }
  const currentTimeMs = new Date().getTime();
  const baselineWaitTimeSeconds = await simulateRouteForDeparture(simulatableRoute, currentTimeMs, lightPredictionsMap);
  let minWaitTimeSeconds = baselineWaitTimeSeconds;
  let bestOffsetSeconds = 0;
  const offsetsToTest = [-60, -30, 30, 60, 90, 120, 150, 180];
  for (const offset of offsetsToTest) {
    const currentWaitTimeSeconds = await simulateRouteForDeparture(simulatableRoute, currentTimeMs + (offset * 1000), lightPredictionsMap);
    if (currentWaitTimeSeconds < minWaitTimeSeconds) {
      minWaitTimeSeconds = currentWaitTimeSeconds;
      bestOffsetSeconds = offset;
    }
  }
  const waitTimeSavingsSeconds = baselineWaitTimeSeconds - minWaitTimeSeconds;
  let adviceMessage = "Current departure time seems reasonable.";
  if (bestOffsetSeconds > 0 && waitTimeSavingsSeconds > 10) adviceMessage = `Depart in ${bestOffsetSeconds}s to save ~${Math.round(waitTimeSavingsSeconds)}s.`;
  else if (bestOffsetSeconds < 0 && waitTimeSavingsSeconds > 10) adviceMessage = `If left ${-bestOffsetSeconds}s ago, might have saved ~${Math.round(waitTimeSavingsSeconds)}s.`;
  else if (waitTimeSavingsSeconds <= 0 && bestOffsetSeconds === 0 && baselineWaitTimeSeconds !== null) adviceMessage = "Departing now optimal.";
  else if (baselineWaitTimeSeconds === null) adviceMessage = "Baseline wait time undetermined.";
  return { advice: adviceMessage, optimal_departure_offset_seconds: bestOffsetSeconds, baseline_wait_time_seconds: Math.round(baselineWaitTimeSeconds), optimal_wait_time_seconds: Math.round(minWaitTimeSeconds), wait_time_savings_seconds: Math.round(waitTimeSavingsSeconds) };
}

function decodeGooglePolyline(encoded) {
    if (!encoded) return [];
    let points = []; let index = 0, len = encoded.length; let lat = 0, lng = 0;
    while (index < len) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat;
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng;
        points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    } return points;
}

async function fetchLightTimingAndPredictionDataForCluster(dbPool, clusterId) {
    try {
        const avgDurationsResult = await dbPool.query( `SELECT current_status, AVG(duration_seconds) as avg_duration FROM traffic_light_cycle_segments WHERE cluster_id = $1 AND duration_seconds IS NOT NULL AND current_status IN ('green', 'yellow', 'red') GROUP BY current_status`, [clusterId]);
        const average_durations = { green: null, yellow: null, red: null };
        avgDurationsResult.rows.forEach(r => { average_durations[r.current_status.toLowerCase()] = Math.round(r.avg_duration); });
        const lastSegmentResult = await dbPool.query( `SELECT current_status, start_timestamp, center_latitude, center_longitude FROM traffic_light_cycle_segments s JOIN traffic_light_clusters c ON s.cluster_id = c.cluster_id WHERE s.cluster_id = $1 ORDER BY s.start_timestamp DESC LIMIT 1`, [clusterId]);
        if (lastSegmentResult.rows.length === 0 && avgDurationsResult.rows.length === 0) return null;
        const lastSegment = lastSegmentResult.rows.length > 0 ? lastSegmentResult.rows[0] : null;
        return { cluster_id: clusterId, average_durations, last_seen_status: lastSegment?.current_status, last_seen_timestamp: lastSegment ? new Date(lastSegment.start_timestamp) : null, cluster_center: lastSegment ? {latitude: lastSegment.center_latitude, longitude: lastSegment.center_longitude} : null };
    } catch(e) { console.error(`Error fetching light data for cluster ${clusterId}:`, e); return null; }
}

app.post('/route_departure_advice', async (req, res) => {
  const dbPool = req.app.locals.dbPool;
  const { origin, destination } = req.body;
  if (!origin || typeof origin.lat !== 'number' || typeof origin.lon !== 'number' || !destination || typeof destination.lat !== 'number' || typeof destination.lon !== 'number') {
    return res.status(400).json({ error: 'Invalid origin/destination. Expected {lat:num, lon:num}.' });
  }
  const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY_BACKEND;
  if (!GOOGLE_API_KEY) return res.status(500).json({ error: 'Routing API key not configured.' });

  try {
    const googleDirectionsURL = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lon}&destination=${destination.lat},${destination.lon}&key=${GOOGLE_API_KEY}`;
    let googleRouteData;
    try {
      const dRes = await axios.get(googleDirectionsURL);
      if (dRes.data.routes && dRes.data.routes.length > 0) googleRouteData = dRes.data.routes[0];
      else return res.status(404).json({ error: 'Route not found by Google.', details: dRes.data.status });
    } catch (e) { return res.status(502).json({ error: 'Failed to fetch route from external service.' }); }

    const simulatableRoute = {
      origin: { latitude: googleRouteData.legs[0].start_location.lat, longitude: googleRouteData.legs[0].start_location.lng },
      destination: { latitude: googleRouteData.legs[0].end_location.lat, longitude: googleRouteData.legs[0].end_location.lng },
      total_initial_duration_seconds: googleRouteData.legs[0].duration.value,
      total_distance_meters: googleRouteData.legs[0].distance.value,
      segments: [],
    };
    const lightPredictionsMap = new Map();
    const uniqueClusterIdsOnEntireRoute = new Set();

    // Phase 5, Step 1: Refined Light-to-Step Association
    const stepSpecificLightsData = new Map(); // K: stepIndex, V: sorted array of { cluster_id, location, distanceFromStepStart }

    for (let stepIndex = 0; stepIndex < googleRouteData.legs[0].steps.length; stepIndex++) {
        const step = googleRouteData.legs[0].steps[stepIndex];
        const stepPolylineDecoded = decodeGooglePolyline(step.polyline.points);
        const lightsFoundOnThisStep = [];

        if (stepPolylineDecoded.length === 0 && !(step.start_location.lat === step.end_location.lat && step.start_location.lng === step.end_location.lng)) {
            stepPolylineDecoded.push({latitude: step.start_location.lat, longitude: step.start_location.lng});
            stepPolylineDecoded.push({latitude: step.end_location.lat, longitude: step.end_location.lng});
        } else if (stepPolylineDecoded.length === 0) {
             stepSpecificLightsData.set(stepIndex, lightsFoundOnThisStep);
             continue;
        }

        // Temporarily fetch all cluster centers to check proximity (less efficient than spatial query)
        const allClustersResult = await dbPool.query('SELECT cluster_id, center_latitude, center_longitude FROM traffic_light_clusters');
        const allClusters = allClustersResult.rows;

        for (const cluster of allClusters) {
            const cluster_center = { latitude: cluster.center_latitude, longitude: cluster.center_longitude };
            let isLightOnThisStep = false;
            for (const polyPoint of stepPolylineDecoded) {
                if (getDistance(cluster_center.latitude, cluster_center.longitude, polyPoint.latitude, polyPoint.longitude) < CLUSTERING_RADIUS_METERS * 1.1) { // Slightly tighter for step polyline match
                    isLightOnThisStep = true;
                    break;
                }
            }
            if (isLightOnThisStep) {
                const distanceFromStepStart = getDistance(step.start_location.lat, step.start_location.lng, cluster_center.latitude, cluster_center.longitude);
                lightsFoundOnThisStep.push({ cluster_id: cluster.cluster_id, location: cluster_center, distanceFromStepStart });
                uniqueClusterIdsOnEntireRoute.add(cluster.cluster_id); // Collect for fetching prediction data
            }
        }
        lightsFoundOnThisStep.sort((a, b) => a.distanceFromStepStart - b.distanceFromStepStart);
        stepSpecificLightsData.set(stepIndex, lightsFoundOnThisStep);
    }

    for (const clusterId of uniqueClusterIdsOnEntireRoute) {
        if (!lightPredictionsMap.has(clusterId)) {
            const lightData = await fetchLightTimingAndPredictionDataForCluster(dbPool, clusterId);
            if (lightData) lightPredictionsMap.set(clusterId, lightData);
        }
    }
    // End of Phase 5, Step 1 refinement. Light identification done.
    // Phase 5, Step 2: Segment reconstruction will use stepSpecificLightsData

    // --- START: Phase 5, Step 2 --- Segment Reconstruction ---
    let currentPathOrigin = { latitude: simulatableRoute.origin.latitude, longitude: simulatableRoute.origin.longitude };

    for (let stepIndex = 0; stepIndex < googleRouteData.legs[0].steps.length; stepIndex++) {
        const step = googleRouteData.legs[0].steps[stepIndex];
        const lightsOnThisStep = stepSpecificLightsData.get(stepIndex) || [];
        let lastPointInStepProcessed = currentPathOrigin; // Start of this step for apportionment
        let remainingStepDuration = step.duration.value;
        let remainingStepDistance = step.distance.value;

        // Calculate total straight-line distance for apportionment reference for this step
        let totalApportionmentDistanceForStep = 0;
        let prevApportionPoint = currentPathOrigin;
        lightsOnThisStep.forEach(light => {
            totalApportionmentDistanceForStep += getDistance(prevApportionPoint.latitude, prevApportionPoint.longitude, light.location.latitude, light.location.longitude);
            prevApportionPoint = light.location;
        });
        totalApportionmentDistanceForStep += getDistance(prevApportionPoint.latitude, prevApportionPoint.longitude, step.end_location.lat, step.end_location.lng);
        if (totalApportionmentDistanceForStep === 0) totalApportionmentDistanceForStep = step.distance.value || 1; // Avoid div by zero, use Google's distance if path is tiny

        for (const light of lightsOnThisStep) {
            const distToThisLight = getDistance(lastPointInStepProcessed.latitude, lastPointInStepProcessed.longitude, light.location.latitude, light.location.longitude);
            const fractionOfStep = totalApportionmentDistanceForStep > 0 ? (distToThisLight / totalApportionmentDistanceForStep) : 0;

            const apportionedDuration = Math.round(step.duration.value * fractionOfStep);
            const apportionedDistance = Math.round(step.distance.value * fractionOfStep);

            simulatableRoute.segments.push({
                start_location: lastPointInStepProcessed,
                end_location: light.location,
                duration_seconds: apportionedDuration,
                distance_meters: apportionedDistance,
                ends_at_traffic_light_cluster_id: light.cluster_id
            });
            lastPointInStepProcessed = light.location;
            remainingStepDuration -= apportionedDuration;
            remainingStepDistance -= apportionedDistance;
        }

        // Segment from last light (or step start) to step end
        simulatableRoute.segments.push({
            start_location: lastPointInStepProcessed,
            end_location: { latitude: step.end_location.lat, longitude: step.end_location.lng },
            duration_seconds: Math.max(0, remainingStepDuration), // Ensure non-negative
            distance_meters: Math.max(0, remainingStepDistance),
            ends_at_traffic_light_cluster_id: null // Could check if step.end_location is a light, but lights_on_this_step should cover it
        });
        currentPathOrigin = { latitude: step.end_location.lat, longitude: step.end_location.lng }; // For next Google step
    }
    // --- END: Phase 5, Step 2 ---

    if (simulatableRoute.segments.length === 0 && googleRouteData.legs[0].steps.length > 0) {
         return res.status(500).json({ error: "Failed to process route steps into simulatable segments."});
    }

    if (uniqueClusterIdsOnEntireRoute.size === 0) {
        return res.json({ advice: "No known traffic lights on this route.", optimal_departure_offset_seconds: 0, baseline_wait_time_seconds: null, optimal_wait_time_seconds: null, wait_time_savings_seconds: 0, route: googleRouteData });
    }

    const adviceResult = await getDepartureAdvice(simulatableRoute, lightPredictionsMap);
    res.json({ ...adviceResult, route: googleRouteData });

  } catch (err) {
    console.error('Error in /route_departure_advice:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error.' });
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
    const nearbyClusters = await dbPool.query( `SELECT *, ( 6371000 * acos( cos(radians($1)) * cos(radians(center_latitude)) * cos(radians(center_longitude) - radians($2)) + sin(radians($1)) * sin(radians(center_latitude)) ) ) AS distance FROM traffic_light_clusters ORDER BY distance ASC LIMIT 1`, [lat, lon]);
    if (nearbyClusters.rows.length === 0) return res.status(404).json({ message: 'No traffic light clusters found nearby.' });
    const closestCluster = nearbyClusters.rows[0];
    const clusterId = closestCluster.cluster_id;

    const lightData = await fetchLightTimingAndPredictionDataForCluster(dbPool, clusterId);
    if (!lightData) return res.status(404).json({ message: 'No timing data for nearest cluster.', cluster_id: clusterId });

    let responsePayload = {
      cluster_id: clusterId,
      cluster_center: lightData.cluster_center || { latitude: closestCluster.center_latitude, longitude: closestCluster.center_longitude },
      reports_in_cluster: closestCluster.report_count,
      average_durations: lightData.average_durations,
      prediction: { predicted_current_status: 'unknown', predicted_time_remaining_seconds: null, prediction_confidence: 'low', last_seen_status: null, last_seen_timestamp: null },
    };

    if (lightData.last_seen_status && lightData.last_seen_timestamp) {
      responsePayload.prediction.last_seen_status = lightData.last_seen_status;
      responsePayload.prediction.last_seen_timestamp = lightData.last_seen_timestamp.toISOString();
      const timeSinceLastStart = Math.round((new Date() - lightData.last_seen_timestamp) / 1000);
      if (closestCluster.report_count >= 5 && timeSinceLastStart < 600) {
        responsePayload.prediction.prediction_confidence = 'medium';
        if (closestCluster.report_count >= 10 && timeSinceLastStart < 300) responsePayload.prediction.prediction_confidence = 'high';
      }
      const avgDurationForLastSeen = lightData.average_durations[lightData.last_seen_status.toLowerCase()];
      if (responsePayload.prediction.prediction_confidence !== 'low' && avgDurationForLastSeen !== null) {
        // Note: The original /light_timings endpoint had more complex logic here for open/closed last segment.
        // This has been simplified as predictLightStateAtFutureTime handles the full projection.
        // For this endpoint, we primarily show current prediction based on *now*.
        const predictionNow = predictLightStateAtFutureTime(lightData, new Date().getTime());
        responsePayload.prediction.predicted_current_status = predictionNow.predicted_status;
        responsePayload.prediction.predicted_time_remaining_seconds = predictionNow.wait_time_seconds > 0 && predictionNow.predicted_status === lightData.last_seen_status ? predictionNow.wait_time_seconds : null;
        // Simplified: if it's red, time remaining is wait time. If green/yellow, it's more complex.
         if(predictionNow.predicted_status === 'red') {
            responsePayload.prediction.predicted_time_remaining_seconds = predictionNow.wait_time_seconds;
        } else {
             // For green/yellow, the "wait_time_seconds" from predictLightStateAtFutureTime is actually the time *until end of red cycle if one were to arrive at red*.
             // The actual time remaining in current green/yellow needs different calculation not directly provided by that helper in this way.
             // So, keep it simple for now, or null.
             // Let's re-calculate remaining in current state if open:
             if (lightData.last_seen_timestamp) { // Assuming last segment is open
                let timeInCurrent = avgDurationForLastSeen - timeSinceLastStart;
                if (timeInCurrent > 0) {
                    responsePayload.prediction.predicted_current_status = lightData.last_seen_status;
                    responsePayload.prediction.predicted_time_remaining_seconds = Math.round(timeInCurrent);
                } else { // Likely changed
                    responsePayload.prediction.predicted_current_status = getNextStatus(lightData.last_seen_status);
                    responsePayload.prediction.predicted_time_remaining_seconds = null; // Hard to say without full simulation from change point
                }
             }
        }


      } else { responsePayload.prediction.prediction_confidence = 'low'; }
    }
    res.json(responsePayload);
  } catch (err) {
    console.error(`Database error in GET /light_timings/${latitude}/${longitude}:`, err);
    res.status(500).json({ error: 'Database error while fetching light timings' });
  }
});
