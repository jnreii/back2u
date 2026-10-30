import json
import os
import boto3


TOPIC_ARN = os.environ["SNS_TOPIC_ARN"]

sns = boto3.client("sns")


#gets the cognito claims already checked by api gateway
def get_claims(event):
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )


#only staff should be able to send match notifications
def is_staff(event):
    groups = get_claims(event).get("cognito:groups", [])

    if isinstance(groups, list):
        return "staff" in groups

    groups = str(groups).strip("[]").replace('"', '').split(",")

    return "staff" in [
        group.strip()
        for group in groups
    ]


def make_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps(body)
    }


def lambda_handler(event, context):

    #extra backend check even though api gateway also checks the jwt
    if not get_claims(event).get("sub"):
        return make_response(401, {
            "error": "Unauthorized"
        })

    if not is_staff(event):
        return make_response(403, {
            "error": "Staff access required"
        })

    body = event.get("body") or {}

    if isinstance(body, str):
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            return make_response(400, {
                "error": "Invalid request body"
            })

    match_id = body.get("match_id")
    status = body.get("status")

    if not match_id:
        return make_response(400, {
            "error": "match_id is required"
        })

    #notification should only happen after staff confirms the match
    if status != "confirmed":
        return make_response(400, {
            "error": "Notification is only for confirmed matches"
        })

    try:
        result = sns.publish(
            TopicArn=TOPIC_ARN,
            Subject="Back2U Match Confirmed",
            Message=(
                "A Back2U match has been confirmed by staff.\n\n"
                "Sign in to Back2U and check My Matches for the latest update.\n\n"
                "For privacy, item details are not included in this email."
            )
        )

        print(
            "SNS notification sent for match:",
            match_id
        )

        return make_response(200, {
            "message": "Notification sent successfully",
            "match_id": match_id,
            "sns_message_id": result.get("MessageId")
        })

    except Exception as error:
        print(
            "SNS publish error:",
            repr(error)
        )

        return make_response(500, {
            "error": "Notification could not be sent"
        })