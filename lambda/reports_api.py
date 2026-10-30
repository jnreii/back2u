import json
import os
import pymysql
import boto3


IMAGE_BUCKET = os.environ["UPLOAD_BUCKET"]

s3 = boto3.client("s3")


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


def make_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=str)
    }


#cognito
def get_claims(event):
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


def get_authenticated_user_id(event):
    return get_claims(event).get("sub")


def is_staff(event):
    groups = get_claims(event).get("cognito:groups", [])

    if isinstance(groups, list):
        return "staff" in groups

    groups = str(groups).strip("[]").replace('"', '').split(",")
    return "staff" in [group.strip() for group in groups]


#matches for a report
def select_matches_for_report(connection, report_id):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                m.match_id,
                m.lost_report_id,
                m.found_report_id,
                m.label_score,
                m.color_score,
                m.location_score,
                m.detail_score,
                m.overall_score,
                m.status AS match_status,

                r.report_id AS matched_report_id,
                r.report_type AS matched_report_type,
                r.category AS matched_category,
                r.manual_color AS matched_manual_color,
                r.area AS matched_area,
                r.event_date AS matched_event_date,
                r.handover_venue AS matched_handover_venue,
                r.image_key AS matched_image_key

            FROM matches m

            JOIN reports r
              ON r.report_id = CASE
                    WHEN m.lost_report_id = %s
                    THEN m.found_report_id
                    ELSE m.lost_report_id
                 END

            WHERE (m.lost_report_id = %s OR m.found_report_id = %s)
              AND m.status IN ('candidate', 'needs_review', 'confirmed')

            ORDER BY m.overall_score DESC
        """, (report_id, report_id, report_id))

        return cursor.fetchall()


#all reports - staff only
def select_reports(connection):
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
                ai_description,
                handover_venue,
                image_key,
                status
            FROM reports
            ORDER BY created_at DESC
            LIMIT 20
        """)

        reports = cursor.fetchall()

    for report in reports:
        report["matches"] = select_matches_for_report(
            connection,
            report["report_id"]
        )

    return reports


#reports for logged in user
def select_reports_for_user(connection, user_id):
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
                ai_description,
                handover_venue,
                image_key,
                status
            FROM reports
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT 20
        """, (user_id,))

        reports = cursor.fetchall()

    for report in reports:
        report["matches"] = select_matches_for_report(
            connection,
            report["report_id"]
        )

    return reports


def select_report(connection, report_id):
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
                ai_description,
                handover_venue,
                image_key,
                status
            FROM reports
            WHERE report_id = %s
        """, (report_id,))

        return cursor.fetchone()


def select_report_image_data(connection, report_id):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                report_id,
                user_id,
                image_key,
                redacted_image_key
            FROM reports
            WHERE report_id = %s
        """, (report_id,))

        return cursor.fetchone()


def user_has_match_access(connection, report_id, user_id):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT 1

            FROM matches m

            JOIN reports lost
              ON lost.report_id = m.lost_report_id

            JOIN reports found
              ON found.report_id = m.found_report_id

            WHERE m.status IN (
                'candidate',
                'needs_review',
                'confirmed'
            )

              AND (
                    (
                        m.lost_report_id = %s
                        AND found.user_id = %s
                    )

                    OR

                    (
                        m.found_report_id = %s
                        AND lost.user_id = %s
                    )
                  )

            LIMIT 1
        """, (
            report_id,
            user_id,
            report_id,
            user_id
        ))

        return cursor.fetchone() is not None


def create_image_url(image_key):
    return s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": IMAGE_BUCKET,
            "Key": image_key
        },
        ExpiresIn=300
    )


def select_report_labels(connection, report_id):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT label_name, confidence
            FROM report_labels
            WHERE report_id = %s
            ORDER BY confidence DESC
        """, (report_id,))

        return cursor.fetchall()


#save a new report
def insert_report(connection, data):
    dominant_rgb = data.get("dominant_rgb") or {}

    with connection.cursor() as cursor:
        cursor.execute("""
            INSERT INTO reports (
                report_id,
                user_id,
                report_type,
                category,
                manual_color,
                detected_color,
                detected_red,
                detected_green,
                detected_blue,
                custom_label,
                custom_confidence,
                area,
                event_date,
                details,
                ai_description,
                handover_venue,
                image_key,
                redacted_image_key
            )
            VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s
            )
        """, (
            data["report_id"],
            data["user_id"],
            data["report_type"],
            data["category"],
            data.get("manual_color"),
            dominant_rgb.get("name"),
            dominant_rgb.get("red"),
            dominant_rgb.get("green"),
            dominant_rgb.get("blue"),
            data.get("custom_label"),
            data.get("custom_confidence"),
            data["area"],
            data["event_date"],
            data.get("details"),
            data.get("ai_description"),
            data.get("handover_venue"),
            data.get("image_key"),
            data.get("redacted_image_key")
        ))

        for label in data.get("labels") or []:
            if not label.get("name"):
                continue

            cursor.execute("""
                INSERT INTO report_labels (
                    report_id,
                    label_name,
                    confidence
                )
                VALUES (%s, %s, %s)
            """, (
                data["report_id"],
                label.get("name"),
                label.get("confidence")
            ))

    connection.commit()


def update_report(connection, report_id, status):
    with connection.cursor() as cursor:
        cursor.execute("""
            UPDATE reports
            SET status = %s
            WHERE report_id = %s
        """, (status, report_id))

        rows_changed = cursor.rowcount

    connection.commit()
    return rows_changed


def delete_report(connection, report_id):
    with connection.cursor() as cursor:
        cursor.execute("""
            DELETE FROM reports
            WHERE report_id = %s
        """, (report_id,))

        rows_deleted = cursor.rowcount

    connection.commit()
    return rows_deleted


#get the users and reports involved in a match
def select_match_users(connection, match_id):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT
                m.match_id,
                m.lost_report_id,
                m.found_report_id,
                lost.user_id AS lost_user_id,
                found.user_id AS found_user_id
            FROM matches m

            JOIN reports lost
              ON lost.report_id = m.lost_report_id

            JOIN reports found
              ON found.report_id = m.found_report_id

            WHERE m.match_id = %s
        """, (match_id,))

        return cursor.fetchone()


def update_match_status(connection, match_id, new_status, current_status):
    with connection.cursor() as cursor:
        cursor.execute("""
            UPDATE matches
            SET status = %s
            WHERE match_id = %s
              AND status = %s
        """, (new_status, match_id, current_status))

        rows_changed = cursor.rowcount

    connection.commit()
    return rows_changed


#staff can confirm the user picked match or another ai suggestion
def confirm_match_as_staff(
    connection,
    match_id,
    lost_report_id,
    found_report_id
):
    with connection.cursor() as cursor:

        #stops one report ending up with two confirmed matches
        cursor.execute("""
            SELECT match_id
            FROM matches
            WHERE status = 'confirmed'
              AND match_id <> %s
              AND (
                    lost_report_id = %s
                    OR found_report_id = %s
                  )
            LIMIT 1
        """, (
            match_id,
            lost_report_id,
            found_report_id
        ))

        existing_confirmed = cursor.fetchone()

        if existing_confirmed:
            return -1

        cursor.execute("""
            UPDATE matches
            SET status = 'confirmed'
            WHERE match_id = %s
              AND status IN ('candidate', 'needs_review')
        """, (match_id,))

        rows_changed = cursor.rowcount

        if rows_changed == 0:
            connection.rollback()
            return 0

        #once one pair is confirmed the other choices should not stay active
        cursor.execute("""
            UPDATE matches
            SET status = 'rejected'
            WHERE match_id <> %s
              AND status IN ('candidate', 'needs_review')
              AND (
                    lost_report_id = %s
                    OR found_report_id = %s
                  )
        """, (
            match_id,
            lost_report_id,
            found_report_id
        ))

        #both reports are finished once staff confirms the same item
        cursor.execute("""
            UPDATE reports
            SET status = 'resolved'
            WHERE report_id IN (%s, %s)
        """, (
            lost_report_id,
            found_report_id
        ))

    connection.commit()
    return rows_changed


#staff rejecting a review removes that requested match
def reject_match_as_staff(connection, match_id):
    with connection.cursor() as cursor:
        cursor.execute("""
            UPDATE matches
            SET status = 'rejected'
            WHERE match_id = %s
              AND status = 'needs_review'
        """, (match_id,))

        rows_changed = cursor.rowcount

    connection.commit()
    return rows_changed


def lambda_handler(event, context):
    connection = None

    try:
        connection = get_connection()

        route_key = event.get("routeKey", "")
        path_parameters = event.get("pathParameters") or {}

        report_id = path_parameters.get("report_id")
        match_id = path_parameters.get("match_id")


        #create report
        if route_key == "POST /reports":
            user_id = get_authenticated_user_id(event)

            if not user_id:
                return make_response(401, {
                    "message": "Unauthorized"
                })

            body = event.get("body", "{}")
            data = json.loads(body) if isinstance(body, str) else body

            #don't trust user_id sent from browser
            data["user_id"] = user_id

            insert_report(connection, data)

            return make_response(201, {
                "message": "Report created successfully",
                "report_id": data["report_id"]
            })


        #logged in user's reports
        if route_key == "GET /my-reports":
            user_id = get_authenticated_user_id(event)

            if not user_id:
                return make_response(401, {
                    "message": "Unauthorized"
                })

            reports = select_reports_for_user(connection, user_id)
            return make_response(200, reports)


        #one report - owner only
        if route_key == "GET /reports/{report_id}":
            user_id = get_authenticated_user_id(event)

            if not user_id:
                return make_response(401, {
                    "message": "Unauthorized"
                })

            report = select_report(connection, report_id)

            if not report:
                return make_response(404, {
                    "error": "Report not found"
                })

            if report["user_id"] != user_id:
                return make_response(403, {
                    "message": "You do not have permission to access this report"
                })

            report["labels"] = select_report_labels(connection, report_id)
            return make_response(200, report)


        #secure report image
        if route_key == "GET /reports/{report_id}/image":
            user_id = get_authenticated_user_id(event)

            if not user_id:
                return make_response(401, {
                    "message": "Unauthorized"
                })

            report = select_report_image_data(
                connection,
                report_id
            )

            if not report:
                return make_response(404, {
                    "error": "Report not found"
                })

            #staff can view the original private image
            if is_staff(event):
                image_key = report["image_key"]
                image_type = "original"

            else:
                #normal user must either own the report
                #or own a report matched with it
                allowed = (
                    report["user_id"] == user_id
                    or user_has_match_access(
                        connection,
                        report_id,
                        user_id
                    )
                )

                if not allowed:
                    return make_response(403, {
                        "message": "You do not have permission to view this image"
                    })

                #normal users only receive censored copy
                image_key = report["redacted_image_key"]
                image_type = "redacted"

            if not image_key:
                return make_response(404, {
                    "error": "Image not available"
                })

            image_url = create_image_url(image_key)

            return make_response(200, {
                "image_url": image_url,
                "image_type": image_type,
                "expires_in": 300
            })


        #all reports - staff only
        if route_key == "GET /reports":
            user_id = get_authenticated_user_id(event)

            if not user_id:
                return make_response(401, {
                    "message": "Unauthorized"
                })

            if not is_staff(event):
                return make_response(403, {
                    "message": "Staff access required"
                })

            reports = select_reports(connection)
            return make_response(200, reports)


        #update report - owner only
        if route_key == "PUT /reports/{report_id}":
            user_id = get_authenticated_user_id(event)

            if not user_id:
                return make_response(401, {
                    "message": "Unauthorized"
                })

            report = select_report(connection, report_id)

            if not report:
                return make_response(404, {
                    "error": "Report not found"
                })

            if report["user_id"] != user_id:
                return make_response(403, {
                    "message": "You do not have permission to update this report"
                })

            body = event.get("body", "{}")
            data = json.loads(body) if isinstance(body, str) else body
            status = data.get("status")

            if not status:
                return make_response(400, {
                    "error": "Status is required"
                })

            update_report(connection, report_id, status)

            return make_response(200, {
                "message": "Report updated successfully",
                "report_id": report_id
            })


        #delete report - owner only
        if route_key == "DELETE /reports/{report_id}":
            user_id = get_authenticated_user_id(event)

            if not user_id:
                return make_response(401, {
                    "message": "Unauthorized"
                })

            report = select_report(connection, report_id)

            if not report:
                return make_response(404, {
                    "error": "Report not found"
                })

            if report["user_id"] != user_id:
                return make_response(403, {
                    "message": "You do not have permission to delete this report"
                })

            delete_report(connection, report_id)

            return make_response(200, {
                "message": "Report deleted successfully",
                "report_id": report_id
            })


        #update a match
        if route_key == "PUT /matches/{match_id}":
            user_id = get_authenticated_user_id(event)

            if not user_id:
                return make_response(401, {
                    "message": "Unauthorized"
                })

            match = select_match_users(
                connection,
                match_id
            )

            if not match:
                return make_response(404, {
                    "error": "Match not found"
                })

            body = event.get("body", "{}")
            data = json.loads(body) if isinstance(body, str) else body
            status = data.get("status")


            #staff decision
            if is_staff(event):

                if status not in (
                    "confirmed",
                    "rejected"
                ):
                    return make_response(400, {
                        "error": "Invalid staff match status"
                    })


                #staff can confirm the user choice
                #or another ai suggestion if it looks more correct
                if status == "confirmed":
                    rows_changed = confirm_match_as_staff(
                        connection,
                        match_id,
                        match["lost_report_id"],
                        match["found_report_id"]
                    )

                    if rows_changed == -1:
                        return make_response(409, {
                            "error": "One of these reports already has a confirmed match"
                        })

                    if rows_changed == 0:
                        return make_response(409, {
                            "error": "Match is no longer available for confirmation"
                        })


                #reject is only for the match the user actually sent for review
                else:
                    rows_changed = reject_match_as_staff(
                        connection,
                        match_id
                    )

                    if rows_changed == 0:
                        return make_response(409, {
                            "error": "Match is no longer waiting for staff review"
                        })


            #normal user decision
            else:

                if user_id not in (
                    match["lost_user_id"],
                    match["found_user_id"]
                ):
                    return make_response(403, {
                        "message": "You do not have permission to update this match"
                    })

                if status not in (
                    "needs_review",
                    "rejected"
                ):
                    return make_response(400, {
                        "error": "Invalid match status"
                    })

                rows_changed = update_match_status(
                    connection,
                    match_id,
                    status,
                    "candidate"
                )

                if rows_changed == 0:
                    return make_response(409, {
                        "error": "Match is no longer an active candidate"
                    })


            return make_response(200, {
                "message": "Match updated successfully",
                "match_id": match_id,
                "status": status
            })


        return make_response(404, {
            "error": "Route not found"
        })


    except Exception as error:
        if connection:
            connection.rollback()

        print(
            "Database error:",
            repr(error)
        )

        return make_response(500, {
            "error": "Database operation failed"
        })


    finally:
        if connection:
            connection.close()