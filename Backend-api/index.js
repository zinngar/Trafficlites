// Trafficlites Backend - Node.js + Express + PostgreSQL
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();
const { getDistance, predictLightStateAtFutureTime } = require('./services.js');

// --- Configuration & Constants ---
const PORT = process.env.PORT || 4000;

const DB_CONFIG = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
};

const pool = new Pool(DB_CONFIG);

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// --- Custom Validation Middleware ---
const validate = (validations) => {
    return async (req, res, next) => {
        const errors = [];
        for (const validation of validations) {
            const { field, location, message, validator } = validation;
            let value;
            if (location === 'body') value = req.body[field];
            if (location === 'params') value = req.params[field];

            if (value === undefined || value === null || !validator(value)) {
                errors.push({ field, message });
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({ errors });
        }
        next();
    };
};

const reportValidation = validate([
    { field: 'latitude', location: 'body', message: 'Latitude must be a valid number.', validator: (v) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 90 },
    { field: 'longitude', location: 'body', message: 'Longitude must be a valid number.', validator: (v) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 180 },
    { field: 'status', location: 'body', message: 'Status must be one of green, yellow, or red.', validator: (v) => ['green', 'yellow', 'red'].includes(v) },
]);

const lightTimingsValidation = validate([
    { field: 'latitude', location: 'params', message: 'Latitude must be a valid number.', validator: (v) => !isNaN(parseFloat(v)) && isFinite(v) && Math.abs(v) <= 90 },
    { field: 'longitude', location: 'params', message: 'Longitude must be a valid number.', validator: (v) => !isNaN(parseFloat(v)) && isFinite(v) && Math.abs(v) <= 180 },
]);

// --- API Endpoints ---
app.post('/report', reportValidation, async (req, res) => {
    const { latitude, longitude, status } = req.body;
    try {
        // In a real implementation, you would save this to the database
        // For example: await pool.query('INSERT INTO reports (latitude, longitude, status) VALUES ($1, $2, $3)', [latitude, longitude, status]);
        console.log(`Received valid report: ${status} at (${latitude}, ${longitude})`);
        res.status(202).json({ message: 'Report received.' });
    } catch (error) {
        console.error('Error processing report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/light_timings/:latitude/:longitude', lightTimingsValidation, async (req, res) => {
    const { latitude, longitude } = req.params;
    try {
        // This is a placeholder for the actual logic that would fetch light data from the DB
        // and then call the prediction service.
        const mockLightData = {
            average_durations: { green: 55, yellow: 5, red: 40 },
            last_seen_status: 'red',
            last_seen_timestamp: new Date(Date.now() - 20000).toISOString(), // 20 seconds ago
            base_confidence: 'high',
            has_complete_averages: true,
        };
        const arrivalTime = Date.now() + 30000; // 30 seconds from now
        const prediction = predictLightStateAtFutureTime(mockLightData, arrivalTime);

        res.status(200).json({
            requested_coords: { latitude, longitude },
            prediction_for_arrival_in_30s: prediction,
        });
    } catch (error) {
        console.error('Error fetching light timings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// --- Server Initialization ---
const localInitDb = async () => {
    try {
        const client = await pool.connect();
        console.log('Database connected successfully.');
        // You could add table creation scripts here for development
        // Example: await client.query('CREATE TABLE IF NOT EXISTS reports (...)');
        client.release();
    } catch (err) {
        console.error('Failed to connect to the database.', err.stack);
        process.exit(1);
    }
};

app.listen(PORT, async () => {
    await localInitDb();
    console.log(`Trafficlites backend listening on port ${PORT}`);
});
