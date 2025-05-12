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
