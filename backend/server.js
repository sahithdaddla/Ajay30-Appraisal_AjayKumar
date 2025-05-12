
const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
const port = 3000

// CORS middleware with specific origins
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3001',
    
    'http://127.0.0.1:5500',
    'http://localhost:5500'
  ]
}));
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'new_employee_db',
  password: process.env.DB_PASSWORD || 'Password@12345',
  port: process.env.DB_PORT || 5432,
});

// Initialize database (create appraisals table if it doesn't exist)
async function initializeDatabase() {
  try {
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'appraisals'
      );
    `);
    const tableExists = tableCheck.rows[0].exists;

    if (!tableExists) {
      console.log('Creating appraisals table...');
      await pool.query(`
        CREATE TABLE appraisals (
          id SERIAL PRIMARY KEY,
          emp_name VARCHAR(40) NOT NULL,
          emp_id VARCHAR(7) NOT NULL,
          task_name VARCHAR(40) NOT NULL,
          feedback TEXT NOT NULL,
          rating INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT valid_emp_id CHECK (emp_id ~ '^[A-Z]{3}0[0-9]{3}$'),
          CONSTRAINT valid_rating CHECK (rating BETWEEN 1 AND 5)
        );
        CREATE INDEX idx_emp_id ON appraisals(emp_id);
        CREATE INDEX idx_created_at ON appraisals(created_at);
      `);
      console.log('Appraisals table created successfully.');
    } else {
      console.log('Appraisals table already exists.');
    }
  } catch (err) {
    console.error('Error initializing database:', {
      message: err.message,
      stack: err.stack,
      code: err.code,
      detail: err.detail
    });
    process.exit(1); // Exit if table creation fails
  }
}

// Test database connection and initialize database
pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection error:', {
      message: err.message,
      stack: err.stack,
      code: err.code
    });
    process.exit(1);
    return;
  }
  console.log('Connected to PostgreSQL database');
  release();
  // Initialize database after successful connection
  initializeDatabase();
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'Database connection OK' });
  } catch (err) {
    console.error('Health check error:', {
      message: err.message,
      stack: err.stack,
      code: err.code
    });
    res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
});

// Get all appraisals
app.get('/api/appraisals', async (req, res) => {
  try {
    let result;
    try {
      result = await pool.query('SELECT * FROM appraisals ORDER BY created_at DESC');
    } catch (err) {
      if (err.code === '42703') { // Undefined column (e.g., created_at missing)
        console.warn('created_at column missing, falling back to query without ORDER BY');
        result = await pool.query('SELECT * FROM appraisals');
      } else if (err.code === '42P01') { // Undefined table
        console.error('Table "appraisals" does not exist');
        return res.status(500).json({ error: 'Table "appraisals" does not exist. Please initialize the database.' });
      } else {
        throw err;
      }
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Error in GET /api/appraisals:', {
      message: err.message,
      stack: err.stack,
      code: err.code,
      detail: err.detail
    });
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Create a new appraisal
app.post('/api/appraisals', async (req, res) => {
  const { empName, empId, taskName, feedback, rating } = req.body;

  if (!empName || !empId || !taskName || !feedback || !rating) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO appraisals (emp_name, emp_id, task_name, feedback, rating) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [empName, empId, taskName, feedback, rating]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error in POST /api/appraisals:', {
      message: err.message,
      stack: err.stack,
      code: err.code,
      detail: err.detail
    });
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
