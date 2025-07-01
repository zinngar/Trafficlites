// Trafficlites Backend - Node.js + Express + PostgreSQL

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Still need Pool constructor
require('dotenv').config();

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
      'INSERT INTO reports (latitude, longitude, status) VALUES ($1, $2, $3) RETURNING *',
      [latitude, longitude, status]
    );
    res.status(201).json(result.rows[0]); // Return the newly created report
  } catch (err) {
    console.error('Database error in POST /report:', err);
    res.status(500).json({ error: 'Database error while saving report' });
  }
});

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
      // Attempt a simple query to check connection and create table
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS reports (
          id SERIAL PRIMARY KEY,
          latitude FLOAT NOT NULL,
          longitude FLOAT NOT NULL,
          status TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      const duration = Date.now() - startTime;
      console.log(`[localInitDb] Table 'reports' ensured/created successfully in ${duration}ms.`);
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
