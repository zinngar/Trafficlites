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
    processReportForTiming(dbPool, newReport).catch(err => {
      console.error('Error in processReportForTiming:', err);
    });
    res.status(201).json(newReport);
  } catch (err) {
    console.error('Database error in POST /report:', err);
    res.status(500).json({ error: 'Database error while saving report' });
  }
});

const CLUSTERING_RADIUS_METERS = 50;

function getDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180; const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180; const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function processReportForTiming(dbPool, report) {
  const { latitude, longitude, status, timestamp: reportTimestamp } = report;
  let clusterId;
  const nearbyClusters = await dbPool.query(
    'SELECT *, (6371000 * acos(cos(radians($1)) * cos(radians(center_latitude)) * cos(radians(center_longitude) - radians($2)) + sin(radians($1)) * sin(radians(center_latitude)))) AS distance FROM traffic_light_clusters ORDER BY distance ASC LIMIT 1',
    [latitude, longitude]
  );
  let targetCluster = null;
  if (nearbyClusters.rows.length > 0 && nearbyClusters.rows[0].distance <= CLUSTERING_RADIUS_METERS) {
    targetCluster = nearbyClusters.rows[0];
  }
  if (targetCluster) {
    clusterId = targetCluster.cluster_id;
    const newReportCount = targetCluster.report_count + 1;
    const oldWeight = targetCluster.report_count / newReportCount;
    const newWeight = 1 / newReportCount;
    const newCenterLatitude = (targetCluster.center_latitude * oldWeight) + (latitude * newWeight);
    const newCenterLongitude = (targetCluster.center_longitude * oldWeight) + (longitude * newWeight);
    await dbPool.query(
      'UPDATE traffic_light_clusters SET center_latitude = $1, center_longitude = $2, report_count = $3, updated_at = NOW() WHERE cluster_id = $4',
      [newCenterLatitude, newCenterLongitude, newReportCount, clusterId]
    );
  } else {
    const newClusterResult = await dbPool.query( 'INSERT INTO traffic_light_clusters (center_latitude, center_longitude, report_count) VALUES ($1, $2, 1) RETURNING cluster_id', [latitude, longitude]);
    clusterId = newClusterResult.rows[0].cluster_id;
  }
  const lastSegmentResult = await dbPool.query( 'SELECT * FROM traffic_light_cycle_segments WHERE cluster_id = $1 ORDER BY start_timestamp DESC, segment_id DESC LIMIT 1', [clusterId]);
  const lastSegment = lastSegmentResult.rows.length > 0 ? lastSegmentResult.rows[0] : null;
  if (lastSegment) {
    const newReportTime = new Date(reportTimestamp);
    const lastSegmentStartTime = new Date(lastSegment.start_timestamp);
    if (lastSegment.current_status !== status && lastSegment.end_timestamp === null) {
      const durationSeconds = Math.round((newReportTime - lastSegmentStartTime) / 1000);
      await dbPool.query( 'UPDATE traffic_light_cycle_segments SET end_timestamp = $1, duration_seconds = $2, is_estimated_end = FALSE WHERE segment_id = $3', [reportTimestamp, durationSeconds, lastSegment.segment_id]);
      await dbPool.query( 'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())', [clusterId, lastSegment.current_status, status, reportTimestamp]);
    } else if (lastSegment.current_status !== status && lastSegment.end_timestamp !== null) {
      await dbPool.query( 'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())', [clusterId, lastSegment.current_status, status, reportTimestamp]);
    } else if (lastSegment.current_status === status && lastSegment.end_timestamp !== null) {
         await dbPool.query( 'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())', [clusterId, lastSegment.current_status, status, reportTimestamp]);
    }
  } else {
    await dbPool.query( 'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())', [clusterId, null, status, reportTimestamp]);
  }
}

app.get('/reports', async (req, res) => { /* ... existing ... */ });

app.listen(PORT, async () => { /* ... existing ... */ });

function getNextStatus(currentStatus) {
  if (currentStatus === 'green') return 'yellow';
  if (currentStatus === 'yellow') return 'red';
  if (currentStatus === 'red') return 'green';
  return 'unknown';
}

// --- Polyline & Simulation Helper Functions ---

function getDistanceOfPolyline(polylinePoints, startIndex = 0, endIndex = -1) {
  if (!polylinePoints || polylinePoints.length < 2) return 0;
  const effectiveEndIndex = (endIndex === -1 || endIndex >= polylinePoints.length) ? polylinePoints.length - 1 : endIndex;
  if (startIndex >= effectiveEndIndex) return 0;
  let totalDistance = 0;
  for (let i = startIndex; i < effectiveEndIndex; i++) {
    const p1 = polylinePoints[i];
    const p2 = polylinePoints[i+1];
    if (p1 && p2 && typeof p1.latitude === 'number' && typeof p1.longitude === 'number' &&
        typeof p2.latitude === 'number' && typeof p2.longitude === 'number') {
        totalDistance += getDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
    } else {
        console.warn("Invalid point in polyline for getDistanceOfPolyline:", p1, p2);
    }
  }
  return totalDistance;
}

function getLightProjectionOnStep(lightLocation, stepPolylinePoints) {
  if (!lightLocation || !stepPolylinePoints || stepPolylinePoints.length === 0) {
    return null;
  }
  let closestVertexIndex = -1;
  let minDistanceToVertex = Infinity;
  for (let i = 0; i < stepPolylinePoints.length; i++) {
    const vertex = stepPolylinePoints[i];
    if (vertex && typeof vertex.latitude === 'number' && typeof vertex.longitude === 'number') {
        const distance = getDistance(
            lightLocation.latitude, lightLocation.longitude,
            vertex.latitude, vertex.longitude
        );
        if (distance < minDistanceToVertex) {
            minDistanceToVertex = distance;
            closestVertexIndex = i;
        }
    } else {
        console.warn("Invalid vertex encountered in getLightProjectionOnStep:", vertex);
    }
  }
  if (closestVertexIndex === -1) return null;
  const closestVertex = stepPolylinePoints[closestVertexIndex];
  const distanceFromStepStartAlongPolyline = getDistanceOfPolyline(stepPolylinePoints, 0, closestVertexIndex);
  return {
    projectedPointLocation: closestVertex,
    indexOnPolyline: closestVertexIndex,
    distanceFromStepStartAlongPolyline: distanceFromStepStartAlongPolyline,
    minDistanceToVertex: minDistanceToVertex
  };
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
    } else if (currentWaitTimeSeconds === minWaitTimeSeconds && offset === 0 && bestOffsetSeconds !==0 ) {
        bestOffsetSeconds = 0;
    }
  }
  const waitTimeSavingsSeconds = baselineWaitTimeSeconds !== null && minWaitTimeSeconds !== null ? baselineWaitTimeSeconds - minWaitTimeSeconds : 0;
  let adviceMessage = "Current departure time seems reasonable.";
  if (bestOffsetSeconds > 0 && waitTimeSavingsSeconds > 10) adviceMessage = `Depart in ${bestOffsetSeconds}s to save ~${Math.round(waitTimeSavingsSeconds)}s.`;
  else if (bestOffsetSeconds < 0 && waitTimeSavingsSeconds > 10) adviceMessage = `If left ${-bestOffsetSeconds}s ago, might have saved ~${Math.round(waitTimeSavingsSeconds)}s.`;
  else if (waitTimeSavingsSeconds <= 0 && bestOffsetSeconds === 0 && baselineWaitTimeSeconds !== null) adviceMessage = "Departing now optimal.";
  else if (baselineWaitTimeSeconds === null) adviceMessage = "Baseline wait time undetermined.";
  return { advice: adviceMessage, optimal_departure_offset_seconds: bestOffsetSeconds, baseline_wait_time_seconds: baselineWaitTimeSeconds !==null ? Math.round(baselineWaitTimeSeconds) : null, optimal_wait_time_seconds: minWaitTimeSeconds !== null ? Math.round(minWaitTimeSeconds) : null, wait_time_savings_seconds: Math.round(waitTimeSavingsSeconds) };
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

        const clusterDetailsResult = await dbPool.query('SELECT center_latitude, center_longitude FROM traffic_light_clusters WHERE cluster_id = $1', [clusterId]);
        const cluster_center = clusterDetailsResult.rows.length > 0 ? {latitude: clusterDetailsResult.rows[0].center_latitude, longitude: clusterDetailsResult.rows[0].center_longitude} : null;

        const lastSegmentResult = await dbPool.query( `SELECT current_status, start_timestamp FROM traffic_light_cycle_segments WHERE cluster_id = $1 ORDER BY start_timestamp DESC LIMIT 1`, [clusterId]);
        // Ensure we return null if essential data is missing, especially cluster_center for geometric calcs
        if (!cluster_center && avgDurationsResult.rows.length === 0 && lastSegmentResult.rows.length === 0) return null;
        const lastSegment = lastSegmentResult.rows.length > 0 ? lastSegmentResult.rows[0] : null;

        return { cluster_id: clusterId, average_durations, last_seen_status: lastSegment?.current_status, last_seen_timestamp: lastSegment ? new Date(lastSegment.start_timestamp) : null, cluster_center };
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

    const lightPredictionsMap = new Map();
    const uniqueClusterIdsOnEntireRoute = new Set();
    const stepSpecificLightsData = new Map();

    // Phase 5, Step 1: Refined Light-to-Step Association (from previous step)
    for (let stepIndex = 0; stepIndex < googleRouteData.legs[0].steps.length; stepIndex++) {
        const step = googleRouteData.legs[0].steps[stepIndex];
        const stepPolylineDecoded = decodeGooglePolyline(step.polyline.points);
        const lightsFoundOnThisStepDetails = [];
        if (stepPolylineDecoded.length === 0 && !(step.start_location.lat === step.end_location.lat && step.start_location.lng === step.end_location.lng)) {
            stepPolylineDecoded.push({latitude: step.start_location.lat, longitude: step.start_location.lng});
            stepPolylineDecoded.push({latitude: step.end_location.lat, longitude: step.end_location.lng});
        } else if (stepPolylineDecoded.length === 0) {
             stepSpecificLightsData.set(stepIndex, lightsFoundOnThisStepDetails); continue;
        }

        // First, ensure all potentially relevant lights have their core data fetched once
        // This loop is from the previous step (P4S2/P5S1) to populate uniqueClusterIdsOnEntireRoute
        const tempPointsToQueryForStep = [];
        if (stepPolylineDecoded.length > 0) {
            tempPointsToQueryForStep.push(stepPolylineDecoded[0]);
            if (stepPolylineDecoded.length > 2) tempPointsToQueryForStep.push(stepPolylineDecoded[Math.floor(stepPolylineDecoded.length / 2)]);
            tempPointsToQueryForStep.push(stepPolylineDecoded[stepPolylineDecoded.length - 1]);
        }
        tempPointsToQueryForStep.push({ latitude: step.start_location.lat, longitude: step.start_location.lng });
        tempPointsToQueryForStep.push({ latitude: step.end_location.lat, longitude: step.end_location.lng });
        const uniqueTempPoints = Array.from(new Set(tempPointsToQueryForStep.map(p => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`))).map(s => { const [lat,lon] = s.split(','); return {latitude: parseFloat(lat), longitude: parseFloat(lon)}; });

        for (const point of uniqueTempPoints) {
            const fallbackNearbyCluster = await dbPool.query( `SELECT cluster_id, center_latitude, center_longitude, (6371000 * acos(cos(radians($1)) * cos(radians(center_latitude)) * cos(radians(center_longitude) - radians($2)) + sin(radians($1)) * sin(radians(center_latitude)))) AS distance FROM traffic_light_clusters ORDER BY distance ASC LIMIT 1`, [point.latitude, point.longitude]);
            if (fallbackNearbyCluster.rows.length > 0 && fallbackNearbyCluster.rows[0].distance < (CLUSTERING_RADIUS_METERS * 1.5)) {
                uniqueClusterIdsOnEntireRoute.add(fallbackNearbyCluster.rows[0].cluster_id);
            }
        }
    }
    for (const clusterId of uniqueClusterIdsOnEntireRoute) {
        if (!lightPredictionsMap.has(clusterId)) {
            const lightData = await fetchLightTimingAndPredictionDataForCluster(dbPool, clusterId);
            if (lightData && lightData.cluster_center) { lightPredictionsMap.set(clusterId, lightData); }
        }
    }
    // Now refine stepSpecificLightsData using the populated lightPredictionsMap
     for (let stepIndex = 0; stepIndex < googleRouteData.legs[0].steps.length; stepIndex++) {
        const step = googleRouteData.legs[0].steps[stepIndex];
        const stepPolylineDecoded = decodeGooglePolyline(step.polyline.points);
        const lightsFoundOnThisStepDetails = []; // Reset for current step
         if (stepPolylineDecoded.length === 0 && !(step.start_location.lat === step.end_location.lat && step.start_location.lng === step.end_location.lng)) {
            stepPolylineDecoded.push({latitude: step.start_location.lat, longitude: step.start_location.lng});
            stepPolylineDecoded.push({latitude: step.end_location.lat, longitude: step.end_location.lng});
        } else if (stepPolylineDecoded.length === 0) {
             stepSpecificLightsData.set(stepIndex, lightsFoundOnThisStepDetails); continue;
        }

        for (const [clusterId, lightData] of lightPredictionsMap.entries()) {
            if (!lightData.cluster_center) continue;
            const projection = getLightProjectionOnStep(lightData.cluster_center, stepPolylineDecoded);
            if (projection && projection.minDistanceToVertex < (CLUSTERING_RADIUS_METERS * 1.2)) {
                lightsFoundOnThisStepDetails.push({
                    cluster_id: clusterId,
                    location: lightData.cluster_center,
                    distanceFromStepStartAlongPolyline: projection.distanceFromStepStartAlongPolyline,
                    projectedPointOnPolyline: projection.projectedPointLocation,
                    projectedPointIndexOnStepPolyline: projection.indexOnPolyline
                });
            }
        }
        lightsFoundOnThisStepDetails.sort((a, b) => a.distanceFromStepStartAlongPolyline - b.distanceFromStepStartAlongPolyline);
        stepSpecificLightsData.set(stepIndex, lightsFoundOnThisStepDetails);
    }
    // --- End of Phase 7, Step 3 (Refined Light-to-Step Association) ---


    // --- START: Phase 7, Step 4 --- Accurate Segment Reconstruction ---
    const simulatableRoute = {
      origin: { latitude: googleRouteData.legs[0].start_location.lat, longitude: googleRouteData.legs[0].start_location.lng },
      destination: { latitude: googleRouteData.legs[0].end_location.lat, longitude: googleRouteData.legs[0].end_location.lng },
      total_initial_duration_seconds: googleRouteData.legs[0].duration.value,
      total_distance_meters: googleRouteData.legs[0].distance.value,
      segments: [],
    };
    let currentSegmentStartLocation = { ...simulatableRoute.origin };

    for (let stepIndex = 0; stepIndex < googleRouteData.legs[0].steps.length; stepIndex++) {
        const step = googleRouteData.legs[0].steps[stepIndex];
        const stepPolylineDecoded = decodeGooglePolyline(step.polyline.points);
        const lightsOnThisStep = stepSpecificLightsData.get(stepIndex) || [];

        let lastProcessedPointLocationInStep = currentSegmentStartLocation; // This should align with step.start_location
        let lastProcessedPolylineIndexOnStep = 0;
        let cumulativeDurationApportionedThisStep = 0;
        // Note: Google step.distance.value is path distance, step.polyline is often simplified.
        // Using step.polyline for path distance is more consistent for apportionment here.
        const totalStepPolylineActualDistance = getDistanceOfPolyline(stepPolylineDecoded);

        for (const lightInfo of lightsOnThisStep) {
            // Distance along polyline from last processed point to this light's closest polyline vertex
            const subSegmentPolylineDistance = getDistanceOfPolyline(stepPolylineDecoded, lastProcessedPolylineIndexOnStep, lightInfo.projectedPointIndexOnStepPolyline);

            let fractionOfStep = 0;
            if (totalStepPolylineActualDistance > 1) { // Avoid division by zero or tiny distances
                 fractionOfStep = subSegmentPolylineDistance / totalStepPolylineActualDistance;
            } else if (lightsOnThisStep.length === 1) { // If only one light and polyline is tiny/zero, assign full step to it
                 fractionOfStep = 1;
            }


            const apportionedDuration = Math.round(step.duration.value * fractionOfStep);
            // Use calculated polyline distance for the segment for better accuracy
            const apportionedDistance = Math.round(subSegmentPolylineDistance);

            if (apportionedDistance > 0 || apportionedDuration > 0 || (lightsOnThisStep.length === 1 && lightInfo.cluster_id === lightsOnThisStep[0].cluster_id)) {
                simulatableRoute.segments.push({
                    start_location: lastProcessedPointLocationInStep,
                    end_location: lightInfo.location, // Actual light cluster center
                    duration_seconds: apportionedDuration,
                    distance_meters: apportionedDistance,
                    ends_at_traffic_light_cluster_id: lightInfo.cluster_id
                });
                cumulativeDurationApportionedThisStep += apportionedDuration;
            }
            lastProcessedPointLocationInStep = lightInfo.location;
            lastProcessedPolylineIndexOnStep = lightInfo.projectedPointIndexOnStepPolyline;
        }

        // Final segment from the last light (or step start) to the actual Google step end
        const distanceRemainingOnPolyline = getDistanceOfPolyline(stepPolylineDecoded, lastProcessedPolylineIndexOnStep);
        const remainingStepDurationCalc = Math.max(0, step.duration.value - cumulativeDurationApportionedThisStep);

        let clusterAtGoogleStepEnd = null;
        for (const [cid, ld] of lightPredictionsMap.entries()) {
            if (ld.cluster_center && getDistance(step.end_location.lat, step.end_location.lng, ld.cluster_center.latitude, ld.cluster_center.longitude) < CLUSTERING_RADIUS_METERS * 0.5) {
                clusterAtGoogleStepEnd = cid; break;
            }
        }
        // Add final segment if there's distance or it's the only segment for this step
        if (distanceRemainingOnPolyline > 1 || lightsOnThisStep.length === 0) {
            simulatableRoute.segments.push({
                start_location: lastProcessedPointLocationInStep,
                end_location: { latitude: step.end_location.lat, longitude: step.end_location.lng },
                duration_seconds: remainingStepDurationCalc,
                distance_meters: Math.round(distanceRemainingOnPolyline), // Use actual remaining polyline distance
                ends_at_traffic_light_cluster_id: clusterAtGoogleStepEnd
            });
        }
        currentSegmentStartLocation = { latitude: step.end_location.lat, longitude: step.end_location.lng };
    }
    // --- END: Phase 7, Step 4 ---

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

app.get('/light_timings/:latitude/:longitude', async (req, res) => {
  const dbPool = req.app.locals.dbPool;
  const { latitude, longitude } = req.params;
  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);
  if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'Invalid latitude or longitude format.' });
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
        const predictionNow = predictLightStateAtFutureTime(lightData, new Date().getTime());
        responsePayload.prediction.predicted_current_status = predictionNow.predicted_status;
        if(predictionNow.predicted_status === 'red') {
            responsePayload.prediction.predicted_time_remaining_seconds = predictionNow.wait_time_seconds;
        } else {
             if (lightData.last_seen_timestamp) {
                let timeInCurrent = avgDurationForLastSeen - timeSinceLastStart;
                if (timeInCurrent > 0 && predictionNow.predicted_status === lightData.last_seen_status) {
                    responsePayload.prediction.predicted_current_status = lightData.last_seen_status;
                    responsePayload.prediction.predicted_time_remaining_seconds = Math.round(timeInCurrent);
                } else if (predictionNow.predicted_status !== lightData.last_seen_status) {
                     responsePayload.prediction.predicted_time_remaining_seconds = null;
                } else {
                    responsePayload.prediction.predicted_time_remaining_seconds = null;
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
