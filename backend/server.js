const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
const port = process.env.PORT || 3085;

app.use(cors({
    origin: [
        process.env.FRONTEND_URL,
        'http://127.0.0.1:5500',
        'http://13.49.49.147:8297',
        'http://13.49.49.147:8298',
        'http://13.49.49.147:3085',
        'http://localhost:5500',
        'http://localhost:3085'
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'postgres',
    database: process.env.DB_NAME || 'new_employee_db',
    password: process.env.DB_PASSWORD || 'admin123',
    port: process.env.DB_PORT || 5432,
    retry: {
        max: 5,
        timeout: 5000
    }
});

async function initializeDatabase() {
    try {
        // Check for both tables
        const employeesCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'employees'
            );
        `);
        
        const appraisalsCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'appraisals'
            );
        `);

        if (!employeesCheck.rows[0].exists || !appraisalsCheck.rows[0].exists) {
            console.log('Creating employees and appraisals tables...');
            await pool.query(`
                DROP TABLE IF EXISTS appraisals;
                DROP TABLE IF EXISTS employees;
                
                CREATE TABLE IF NOT EXISTS employees (
                    emp_id VARCHAR(7) PRIMARY KEY,
                    emp_name VARCHAR(100) NOT NULL,
                    emp_email VARCHAR(100) NOT NULL CHECK (emp_email ~ '^[a-zA-Z][a-zA-Z0-9._-]*[a-zA-Z]@astrolitetech\.com$')
                );
                
                CREATE TABLE IF NOT EXISTS appraisals (
                    id SERIAL PRIMARY KEY,
                    emp_id VARCHAR(7) NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
                    emp_name VARCHAR(40) NOT NULL,
                    task_name VARCHAR(40) NOT NULL,
                    feedback TEXT NOT NULL,
                    rating INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT valid_emp_id CHECK (emp_id ~ '^ATS0(?!000)[0-9]{3}$'),
                    CONSTRAINT valid_rating CHECK (rating BETWEEN 1 AND 5)
                );
                
                CREATE INDEX IF NOT EXISTS idx_emp_id ON appraisals(emp_id);
                CREATE INDEX IF NOT EXISTS idx_created_at ON appraisals(created_at);
                
                -- Insert test data with valid emails
                INSERT INTO employees (emp_id, emp_name, emp_email)
                VALUES 
                    ('ATS0001', 'Test User One', 'test.userone@astrolitetech.com'),
                    ('ATS0002', 'Test User Two', 'test.usertwo@astrolitetech.com')
                ON CONFLICT (emp_id) DO NOTHING;
            `);
            console.log('Tables created successfully.');
        } else {
            console.log('Tables already exist.');
        }
    } catch (err) {
        console.error('Error initializing database:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            detail: err.detail
        });
        process.exit(1);
    }
}

app.get('/api/test-email', (req, res) => {
    const testEmails = [
        'test.user1@astrolitetech.com',
        'test.userone@astrolitetech.com',
        'a@astrolitetech.com',
        'a1@astrolitetech.com'
    ];
    
    const pattern = /^[a-zA-Z][a-zA-Z0-9._-]*[a-zA-Z]@astrolitetech\.com$/;
    const results = testEmails.map(email => ({
        email,
        valid: pattern.test(email)
    }));
    
    res.json(results);
});              async function connectWithRetry() {
    let retries = 5;
    while (retries) {
        try {
            const client = await pool.connect();
            client.release();
            console.log('Connected to PostgreSQL database');
            return;
        } catch (err) {
            console.error('Database connection error, retrying...', {
                message: err.message,
                code: err.code
            });
            retries--;
            await new Promise(res => setTimeout(res, 5000));
        }
    }
    console.error('Failed to connect to PostgreSQL after retries');
    process.exit(1);
}

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        const tablesCheck = await pool.query(`
            SELECT 
                (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'employees')) as employees_exists,
                (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'appraisals')) as appraisals_exists
        `);
        
        res.status(200).json({ 
            status: 'Database connection OK',
            tables: {
                employees: tablesCheck.rows[0].employees_exists,
                appraisals: tablesCheck.rows[0].appraisals_exists
            }
        });
    } catch (err) {
        console.error('Health check error:', {
            message: err.message,
            stack: err.stack,
            code: err.code
        });
        res.status(500).json({ error: 'Database connection failed', details: err.message });
    }
});

app.get('/api/appraisals', async (req, res) => {
    try {
        let result;
        try {
            result = await pool.query('SELECT * FROM appraisals ORDER BY created_at DESC');
        } catch (err) {
            if (err.code === '42703') {
                console.warn('created_at column missing, falling back to query without ORDER BY');
                result = await pool.query('SELECT * FROM appraisals');
            } else if (err.code === '42P01') {
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

app.get('/api/appraisals/:empId', async (req, res) => {
    const { empId } = req.params;
    if (!/^ATS0(?!000)[0-9]{3}$/.test(empId)) {
        return res.status(400).json({ error: 'Invalid Employee ID. Must be ATS0xxx (e.g., ATS0001 to ATS0999)' });
    }

    try {
        const result = await pool.query('SELECT * FROM appraisals WHERE emp_id = $1 ORDER BY created_at DESC', [empId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in GET /api/appraisals/:empId:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            detail: err.detail
        });
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

app.post('/api/appraisals', async (req, res) => {
    const { empName, empId, taskName, feedback, rating } = req.body;

    if (!empName || !empId || !taskName || !feedback || !rating) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (!/^ATS0(?!000)[0-9]{3}$/.test(empId)) {
        return res.status(400).json({ 
            error: 'Invalid Employee ID. Must be ATS0xxx (e.g., ATS0001 to ATS0999)',
            example: 'ATS0001'
        });
    }

    try {
        // Verify the employee exists or create it
        await pool.query('BEGIN');
        
        const empCheck = await pool.query('SELECT 1 FROM employees WHERE emp_id = $1', [empId]);
        if (empCheck.rowCount === 0) {
            // Validate email format for new employees
            const email = `${empName.toLowerCase().replace(/\s+/g, '.')}@astrolitetech.com`;
            if (!/^[a-zA-Z][a-zA-Z0-9._-]{1,}[a-zA-Z]@astrolitetech\.com$/.test(email)) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ 
                    error: 'Invalid employee name format for email generation',
                    suggestion: 'Use a name with at least 3 characters'
                });
            }
            
            await pool.query(
                'INSERT INTO employees (emp_id, emp_name, emp_email) VALUES ($1, $2, $3)',
                [empId, empName, email]
            );
        }

        const result = await pool.query(
            'INSERT INTO appraisals (emp_name, emp_id, task_name, feedback, rating) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [empName, empId, taskName, feedback, rating]
        );
        
        await pool.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => {});
        console.error('Error in POST /api/appraisals:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            detail: err.detail
        });
        
        if (err.code === '23503') { // foreign key violation
            return res.status(400).json({ 
                error: 'Employee does not exist in database',
                solution: 'Please register the employee first'
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to save appraisal',
            details: err.message 
        });
    }
});

async function startServer() {
    try {
        await connectWithRetry();
        await initializeDatabase();
        
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();