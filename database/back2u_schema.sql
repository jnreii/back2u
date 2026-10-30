CREATE DATABASE IF NOT EXISTS back2u_db;
USE back2u_db;


-- lost or found report
CREATE TABLE reports (
    report_id VARCHAR(30) PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,

    report_type ENUM('lost', 'found') NOT NULL,
    category VARCHAR(50) NOT NULL,

	manual_color VARCHAR(50),
	detected_color VARCHAR(50),

	detected_red TINYINT UNSIGNED,
	detected_green TINYINT UNSIGNED,
	detected_blue TINYINT UNSIGNED,

    custom_label VARCHAR(100),
    custom_confidence DECIMAL(5,2),

    area VARCHAR(150) NOT NULL,
    event_date DATE NOT NULL,
    details TEXT,

    handover_venue VARCHAR(150),

    image_key VARCHAR(255),
    redacted_image_key VARCHAR(255),

    photo_latitude DECIMAL(10,7),
    photo_longitude DECIMAL(10,7),

    ai_description TEXT,

    status ENUM(
        'active',
        'needs_review',
        'resolved',
        'closed'
    ) DEFAULT 'active',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);


-- rekognition can detect many labels for one report
CREATE TABLE report_labels (
    label_id BIGINT AUTO_INCREMENT PRIMARY KEY,

    report_id VARCHAR(30) NOT NULL,
    label_name VARCHAR(100) NOT NULL,
    confidence DECIMAL(5,2),

    FOREIGN KEY (report_id)
        REFERENCES reports(report_id)
        ON DELETE CASCADE,

    UNIQUE (report_id, label_name)
);


-- one lost report can have many possible found matches
CREATE TABLE matches (
    match_id BIGINT AUTO_INCREMENT PRIMARY KEY,

    lost_report_id VARCHAR(30) NOT NULL,
    found_report_id VARCHAR(30) NOT NULL,

    label_score DECIMAL(5,2),
    color_score DECIMAL(5,2),
    location_score DECIMAL(5,2),
    detail_score DECIMAL(5,2),

    overall_score DECIMAL(5,2) NOT NULL,

    status ENUM(
        'candidate',
        'needs_review',
        'confirmed',
        'rejected'
    ) DEFAULT 'candidate',

    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMP NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (lost_report_id)
        REFERENCES reports(report_id)
        ON DELETE CASCADE,

    FOREIGN KEY (found_report_id)
        REFERENCES reports(report_id)
        ON DELETE CASCADE,

    UNIQUE (lost_report_id, found_report_id)
);