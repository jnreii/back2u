import json
import os
import re
import math
import pymysql


def get_connection():
    return pymysql.connect(
        host=os.environ["DB_HOST"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
        port=3306,
        connect_timeout=5,
        cursorclass=pymysql.cursors.DictCursor
    )


def normalise_text(value):
    if not value:
        return ""

    return str(value).strip().lower()


def text_tokens(value):
    if not value:
        return set()

    words = re.findall(r"[a-z0-9]+", str(value).lower())

    stop_words = {
        "the", "a", "an", "and", "or", "of", "to",
        "in", "on", "at", "with", "it", "is", "was",
        "this", "that", "my"
    }

    return {
        word
        for word in words
        if word not in stop_words
    }


def safe_float(value):
    if value is None:
        return 0.0

    return float(value)


def get_report(connection, report_id):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                report_id,
                user_id,
                report_type,
                category,
                manual_color,
                detected_red,
                detected_green,
                detected_blue,
                custom_label,
                custom_confidence,
                area,
                event_date,
                details,
                status
            FROM reports
            WHERE report_id = %s
        """, (report_id,))

        return cursor.fetchone()


def get_report_labels(connection, report_id):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                label_name
            FROM report_labels
            WHERE report_id = %s
        """, (report_id,))

        rows = cursor.fetchall()

    return {
        normalise_text(row["label_name"])
        for row in rows
        if row.get("label_name")
    }


def get_opposite_reports(connection, report):
    opposite_type = (
        "found"
        if report["report_type"] == "lost"
        else "lost"
    )

    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                report_id,
                user_id,
                report_type,
                category,
                manual_color,
                detected_red,
                detected_green,
                detected_blue,
                custom_label,
                custom_confidence,
                area,
                event_date,
                details,
                status
            FROM reports
            WHERE report_type = %s
              AND status = 'active'
              AND report_id <> %s
        """, (
            opposite_type,
            report["report_id"]
        ))

        return cursor.fetchall()


def normal_label_overlap(labels_a, labels_b):
    if not labels_a or not labels_b:
        return 0.0

    union = labels_a | labels_b

    if not union:
        return 0.0

    intersection = labels_a & labels_b

    return (
        len(intersection) /
        len(union)
    ) * 100


def calculate_label_score(
    report_a,
    report_b,
    labels_a,
    labels_b
):
    scores = []

    custom_a = normalise_text(
        report_a.get("custom_label")
    )

    custom_b = normalise_text(
        report_b.get("custom_label")
    )

    if custom_a and custom_b and custom_a == custom_b:
        confidence_a = safe_float(
            report_a.get("custom_confidence")
        )

        confidence_b = safe_float(
            report_b.get("custom_confidence")
        )

        lower_confidence = min(
            confidence_a,
            confidence_b
        )

        custom_score = (
            70 +
            min(lower_confidence, 100) * 0.30
        )

        scores.append(custom_score)

    category_a = normalise_text(
        report_a.get("category")
    )

    category_b = normalise_text(
        report_b.get("category")
    )

    if category_a and category_a == category_b:
        scores.append(60)

    overlap_score = normal_label_overlap(
        labels_a,
        labels_b
    )

    scores.append(overlap_score)

    return round(max(scores), 2)


def calculate_color_score(report_a, report_b):
    rgb_a = (
        report_a.get("detected_red"),
        report_a.get("detected_green"),
        report_a.get("detected_blue")
    )

    rgb_b = (
        report_b.get("detected_red"),
        report_b.get("detected_green"),
        report_b.get("detected_blue")
    )

    if (
        None not in rgb_a
        and None not in rgb_b
    ):
        distance = math.sqrt(
            (rgb_a[0] - rgb_b[0]) ** 2 +
            (rgb_a[1] - rgb_b[1]) ** 2 +
            (rgb_a[2] - rgb_b[2]) ** 2
        )

        max_distance = math.sqrt(
            255 ** 2 +
            255 ** 2 +
            255 ** 2
        )

        score = (
            1 -
            distance / max_distance
        ) * 100

        return round(
            max(0, min(100, score)),
            2
        )

    manual_a = normalise_text(
        report_a.get("manual_color")
    )

    manual_b = normalise_text(
        report_b.get("manual_color")
    )

    if manual_a and manual_a == manual_b:
        return 70.0

    return 0.0


def calculate_location_score(report_a, report_b):
    area_a = normalise_text(
        report_a.get("area")
    )

    area_b = normalise_text(
        report_b.get("area")
    )

    if not area_a or not area_b:
        return 0.0

    if area_a == area_b:
        return 100.0

    tokens_a = text_tokens(area_a)
    tokens_b = text_tokens(area_b)

    if not tokens_a or not tokens_b:
        return 0.0

    union = tokens_a | tokens_b
    intersection = tokens_a & tokens_b

    return round(
        len(intersection) /
        len(union) *
        100,
        2
    )


def calculate_detail_score(report_a, report_b):
    tokens_a = text_tokens(
        report_a.get("details")
    )

    tokens_b = text_tokens(
        report_b.get("details")
    )

    if not tokens_a or not tokens_b:
        return 0.0

    union = tokens_a | tokens_b
    intersection = tokens_a & tokens_b

    return round(
        len(intersection) /
        len(union) *
        100,
        2
    )


def date_is_possible(report_a, report_b):
    if report_a["report_type"] == "lost":
        lost_date = report_a["event_date"]
        found_date = report_b["event_date"]
    else:
        lost_date = report_b["event_date"]
        found_date = report_a["event_date"]

    if not lost_date or not found_date:
        return True

    return found_date >= lost_date


def has_item_signal(
    report_a,
    report_b,
    labels_a,
    labels_b
):
    category_match = (
        normalise_text(report_a.get("category"))
        ==
        normalise_text(report_b.get("category"))
    )

    custom_a = normalise_text(
        report_a.get("custom_label")
    )

    custom_b = normalise_text(
        report_b.get("custom_label")
    )

    custom_match = (
        custom_a
        and custom_b
        and custom_a == custom_b
    )

    label_overlap = (
        normal_label_overlap(
            labels_a,
            labels_b
        ) > 0
    )

    return (
        category_match
        or custom_match
        or label_overlap
    )


def save_matches(connection, report_id, matches):
    with connection.cursor() as cursor:
        cursor.execute("""
            DELETE FROM matches
            WHERE (
                lost_report_id = %s
                OR found_report_id = %s
            )
            AND status IN (
                'candidate',
                'needs_review'
            )
        """, (
            report_id,
            report_id
        ))

        for match in matches:
            cursor.execute("""
                INSERT INTO matches (
                    lost_report_id,
                    found_report_id,
                    label_score,
                    color_score,
                    location_score,
                    detail_score,
                    overall_score,
                    status
                )
                VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, 'candidate'
                )
                ON DUPLICATE KEY UPDATE
                    label_score = VALUES(label_score),
                    color_score = VALUES(color_score),
                    location_score = VALUES(location_score),
                    detail_score = VALUES(detail_score),
                    overall_score = VALUES(overall_score),
                    status = 'candidate',
                    updated_at = CURRENT_TIMESTAMP
            """, (
                match["lost_report_id"],
                match["found_report_id"],
                match["label_score"],
                match["color_score"],
                match["location_score"],
                match["detail_score"],
                match["overall_score"]
            ))

    connection.commit()


def lambda_handler(event, context):
    connection = None

    try:
        body = event.get("body") or {}

        if isinstance(body, str):
            body = json.loads(body)

        report_id = (
            body.get("report_id")
            or event.get("report_id")
        )

        if not report_id:
            return {
                "statusCode": 400,
                "body": json.dumps({
                    "error": "report_id is required"
                })
            }

        connection = get_connection()

        report = get_report(
            connection,
            report_id
        )

        if not report:
            return {
                "statusCode": 404,
                "body": json.dumps({
                    "error": "Report not found"
                })
            }

        report_labels = get_report_labels(
            connection,
            report_id
        )

        opposite_reports = get_opposite_reports(
            connection,
            report
        )

        candidates = []

        for candidate in opposite_reports:
            if not date_is_possible(
                report,
                candidate
            ):
                continue

            candidate_labels = get_report_labels(
                connection,
                candidate["report_id"]
            )

            if not has_item_signal(
                report,
                candidate,
                report_labels,
                candidate_labels
            ):
                continue

            label_score = calculate_label_score(
                report,
                candidate,
                report_labels,
                candidate_labels
            )

            color_score = calculate_color_score(
                report,
                candidate
            )

            location_score = calculate_location_score(
                report,
                candidate
            )

            detail_score = calculate_detail_score(
                report,
                candidate
            )

            overall_score = round(
                label_score * 0.50 +
                color_score * 0.20 +
                location_score * 0.15 +
                detail_score * 0.15,
                2
            )

            if report["report_type"] == "lost":
                lost_report_id = report["report_id"]
                found_report_id = candidate["report_id"]
            else:
                lost_report_id = candidate["report_id"]
                found_report_id = report["report_id"]

            candidates.append({
                "lost_report_id": lost_report_id,
                "found_report_id": found_report_id,
                "label_score": label_score,
                "color_score": color_score,
                "location_score": location_score,
                "detail_score": detail_score,
                "overall_score": overall_score
            })

        candidates.sort(
            key=lambda item: item["overall_score"],
            reverse=True
        )

        top_matches = candidates[:5]

        save_matches(
            connection,
            report_id,
            top_matches
        )

        return {
            "statusCode": 200,
            "body": json.dumps({
                "report_id": report_id,
                "matches_found": len(top_matches),
                "matches": top_matches
            }, default=str)
        }

    except Exception as error:
        if connection:
            connection.rollback()

        print(
            "Matching error:",
            repr(error)
        )

        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": "Matching failed"
            })
        }

    finally:
        if connection:
            connection.close()