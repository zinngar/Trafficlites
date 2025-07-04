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
  // ... (existing implementation from previous steps - assumed correct and complete)
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

function predictLightStateAtFutureTime(lightData, arrivalTimeInMs) { /* ... existing ... */ }
async function simulateRouteForDeparture(simulatableRoute, departureTimeMs, lightPredictionsMap) { /* ... existing ... */ }
async function getDepartureAdvice(simulatableRoute, lightPredictionsMap) { /* ... existing ... */ }
function decodeGooglePolyline(encoded) { /* ... existing ... */ }
async function fetchLightTimingAndPredictionDataForCluster(dbPool, clusterId) { /* ... existing ... */ }


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

    // Populate uniqueClusterIdsOnEntireRoute first (Phase 4 logic)
    for (const step of googleRouteData.legs[0].steps) {
      const stepPolylineDecoded = decodeGooglePolyline(step.polyline.points);
      const pointsToQueryForStep = [];
      if (stepPolylineDecoded.length > 0) {
        pointsToQueryForStep.push(stepPolylineDecoded[0]);
        if (stepPolylineDecoded.length > 2) pointsToQueryForStep.push(stepPolylineDecoded[Math.floor(stepPolylineDecoded.length / 2)]);
        pointsToQueryForStep.push(stepPolylineDecoded[stepPolylineDecoded.length - 1]);
      }
      pointsToQueryForStep.push({ latitude: step.start_location.lat, longitude: step.start_location.lng });
      pointsToQueryForStep.push({ latitude: step.end_location.lat, longitude: step.end_location.lng });
      const uniquePointsForStep = Array.from(new Set(pointsToQueryForStep.map(p => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`))).map(s => { const [lat,lon] = s.split(','); return {latitude: parseFloat(lat), longitude: parseFloat(lon)}; });
      for (const point of uniquePointsForStep) {
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

    // Refine light-to-step association using getLightProjectionOnStep (Phase 7, Step 3 / P9S2 logic)
    const stepSpecificLightsData = new Map();
    for (let stepIndex = 0; stepIndex < googleRouteData.legs[0].steps.length; stepIndex++) {
        const step = googleRouteData.legs[0].steps[stepIndex];
        let stepPolylineDecoded = decodeGooglePolyline(step.polyline.points); // Ensure it's 'let'
        const lightsFoundOnThisStepDetails = [];
        if (stepPolylineDecoded.length === 0 && !(step.start_location.lat === step.end_location.lat && step.start_location.lng === step.end_location.lng)) {
            stepPolylineDecoded = [{latitude: step.start_location.lat, longitude: step.start_location.lng}, {latitude: step.end_location.lat, longitude: step.end_location.lng}];
        } else if (stepPolylineDecoded.length === 0) {
             stepSpecificLightsData.set(stepIndex, lightsFoundOnThisStepDetails); continue;
        }
        for (const [clusterId, lightData] of lightPredictionsMap.entries()) {
            if (!lightData.cluster_center) continue;
            const projection = getLightProjectionOnStep(lightData.cluster_center, stepPolylineDecoded);
            if (projection && projection.minDistanceToVertex < (CLUSTERING_RADIUS_METERS * 1.2)) {
                lightsFoundOnThisStepDetails.push({
                    cluster_id: clusterId, location: lightData.cluster_center,
                    distanceFromStepStartAlongPolyline: projection.distanceFromStepStartAlongPolyline,
                    projectedPointOnPolyline: projection.projectedPointLocation,
                    projectedPointIndexOnStepPolyline: projection.indexOnPolyline
                });
            }
        }
        lightsFoundOnThisStepDetails.sort((a, b) => a.distanceFromStepStartAlongPolyline - b.distanceFromStepStartAlongPolyline);
        stepSpecificLightsData.set(stepIndex, lightsFoundOnThisStepDetails);
    }

    // --- START: Phase 9, Step 3 --- Accurate Segment Reconstruction with Polyline Apportionment ---
    const simulatableRoute = {
      origin: { latitude: googleRouteData.legs[0].start_location.lat, longitude: googleRouteData.legs[0].start_location.lng },
      destination: { latitude: googleRouteData.legs[0].end_location.lat, longitude: googleRouteData.legs[0].end_location.lng },
      total_initial_duration_seconds: googleRouteData.legs[0].duration.value,
      total_distance_meters: googleRouteData.legs[0].distance.value,
      segments: [],
    };
    let currentPathOverallStartLocation = { ...simulatableRoute.origin };

    for (let stepIndex = 0; stepIndex < googleRouteData.legs[0].steps.length; stepIndex++) {
        const step = googleRouteData.legs[0].steps[stepIndex];
        let stepPolylineDecoded = decodeGooglePolyline(step.polyline.points);
        if (stepPolylineDecoded.length === 0 && !(step.start_location.lat === step.end_location.lat && step.start_location.lng === step.end_location.lng)) {
             stepPolylineDecoded = [{latitude: step.start_location.lat, longitude: step.start_location.lng}, {latitude: step.end_location.lat, longitude: step.end_location.lng}];
        } else if (stepPolylineDecoded.length === 0) {
            continue; // Skip zero-length polylines that are also zero-length steps
        }

        const lightsOnThisStep = stepSpecificLightsData.get(stepIndex) || [];
        let lastProcessedLocationForCurrentStep = currentPathOverallStartLocation; // Start of current Google step
        let lastProcessedPolylineIndexOnStep = 0;
        let cumulativeDurationApportionedThisStep = 0;

        const totalStepPolylineActualDistance = getDistanceOfPolyline(stepPolylineDecoded, 0, -1); // Full length of step's polyline

        for (const lightInfo of lightsOnThisStep) {
            // Path distance from the last processed point (start of step or prev light's vertex) to this light's closest vertex on step polyline
            const subSegmentPolylineDistance = getDistanceOfPolyline(stepPolylineDecoded, lastProcessedPolylineIndexOnStep, lightInfo.projectedPointIndexOnStepPolyline);

            let fractionOfStep = 0;
            if (totalStepPolylineActualDistance > 0.1) { // Use a small threshold like 0.1m
                 fractionOfStep = subSegmentPolylineDistance / totalStepPolylineActualDistance;
            } else if (lightsOnThisStep.length > 0) { // If total polyline is tiny/zero, distribute duration among lights
                 fractionOfStep = 1 / lightsOnThisStep.length;
            }

            const apportionedDuration = Math.round(step.duration.value * fractionOfStep);
            const apportionedDistance = Math.round(subSegmentPolylineDistance); // Use actual path distance for segment

            if (apportionedDistance > 0 || apportionedDuration > 0 || (lightsOnThisStep.length === 1 && lightInfo.cluster_id === lightsOnThisStep[0].cluster_id)) {
                 simulatableRoute.segments.push({
                    start_location: lastProcessedLocationForCurrentStep,
                    end_location: lightInfo.location, // Actual light cluster center
                    duration_seconds: apportionedDuration,
                    distance_meters: apportionedDistance,
                    ends_at_traffic_light_cluster_id: lightInfo.cluster_id
                });
                cumulativeDurationApportionedThisStep += apportionedDuration;
            }
            lastProcessedLocationForCurrentStep = lightInfo.location;
            lastProcessedPolylineIndexOnStep = lightInfo.projectedPointIndexOnStepPolyline;
        }

        // Final segment from the last light's location (or step start) to the actual Google step end_location
        const remainingPolylinePathDistance = getDistanceOfPolyline(stepPolylineDecoded, lastProcessedPolylineIndexOnStep, -1);
        const finalSegmentDuration = Math.max(0, step.duration.value - cumulativeDurationApportionedThisStep);
        const finalSegmentDistance = Math.round(remainingPolylinePathDistance);

        let clusterAtGoogleStepEnd = null;
        for (const [cid, ld] of lightPredictionsMap.entries()) {
            if (ld.cluster_center && getDistance(step.end_location.lat, step.end_location.lng, ld.cluster_center.latitude, ld.cluster_center.longitude) < CLUSTERING_RADIUS_METERS * 0.5) {
                clusterAtGoogleStepEnd = cid; break;
            }
        }

        // Add final segment only if it has length or if no lights were on this step (making it the only segment for this step)
        if (finalSegmentDistance > 0 || finalSegmentDuration > 0 || lightsOnThisStep.length === 0) {
             simulatableRoute.segments.push({
                start_location: lastProcessedLocationForCurrentStep,
                end_location: { latitude: step.end_location.lat, longitude: step.end_location.lng },
                duration_seconds: finalSegmentDuration,
                distance_meters: finalSegmentDistance,
                ends_at_traffic_light_cluster_id: clusterAtGoogleStepEnd
            });
        }
        currentPathOverallStartLocation = { latitude: step.end_location.lat, longitude: step.end_location.lng };
    }
    // --- END: Phase 9, Step 3 ---

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

app.get('/light_timings/:latitude/:longitude', async (req, res) => { /* ... existing ... */ });
