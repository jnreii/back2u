import json
import os
import boto3
import base64
import uuid
import re

from io import BytesIO
from PIL import Image, ImageFilter
from botocore.exceptions import ClientError
from botocore.config import Config


rek = boto3.client('rekognition')
s3 = boto3.client('s3')
bedrock = boto3.client(
    'bedrock-runtime',
    region_name='us-east-1',
    config=Config(
        connect_timeout=3,
        read_timeout=8,
        retries={
            'max_attempts': 1
        }
    )
)

BUCKET = os.environ['UPLOAD_BUCKET']

BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0'

CUSTOM_MODEL_ARN = os.environ['CUSTOM_MODEL_ARN']

BLOCKED = {
    'gun',
    'weapon',
    'firearm',
    'knife',
    'blade',
    'dagger',
    'ammunition',
    'bomb'
}

NRIC_FIN_PATTERN = re.compile(
    r'\b[STFGM]\s*\d{7}\s*[A-Z]\b',
    re.IGNORECASE
)

EMAIL_PATTERN = re.compile(
    r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b',
    re.IGNORECASE
)

PHONE_PATTERN = re.compile(
    r'\b(?:\+?65[\s-]?)?[689]\d{3}[\s-]?\d{4}\b'
)


def lambda_handler(event, context):
    body = event.get('body') or {}

    if isinstance(body, str):
        body = json.loads(body)

    key = body.get('key')
    image_bytes = None
    content_type = None

    #if an actual image was sent, save it to S3 first
    if not key:
        image_base64 = body.get('image_base64')
        content_type = body.get('content_type', 'image/jpeg')

        if not image_base64:
            return respond(400, {
                'error': 'no image or S3 key given'
            })

        if content_type not in ['image/jpeg', 'image/png']:
            return respond(400, {
                'error': 'only JPEG and PNG images are supported'
            })

        #FileReader can include the data:image prefix
        if ',' in image_base64:
            image_base64 = image_base64.split(',', 1)[1]

        try:
            image_bytes = base64.b64decode(image_base64)

        except Exception:
            return respond(400, {
                'error': 'invalid base64 image'
            })

        if len(image_bytes) > 6 * 1024 * 1024:
            return respond(400, {
                'error': 'image is too large'
            })

        extension = '.jpg'

        if content_type == 'image/png':
            extension = '.png'

        key = 'uploads/' + str(uuid.uuid4()) + extension

        try:
            s3.put_object(
                Bucket=BUCKET,
                Key=key,
                Body=image_bytes,
                ContentType=content_type
            )

        except Exception as e:
            print('S3 upload error:', repr(e))

            return respond(500, {
                'error': 'could not save image'
            })

    #if an S3 key was sent instead, load the image
    else:
        try:
            s3_object = s3.get_object(
                Bucket=BUCKET,
                Key=key
            )

            image_bytes = s3_object['Body'].read()
            content_type = s3_object.get(
                'ContentType',
                'image/jpeg'
            )

        except Exception as e:
            print('S3 read error:', repr(e))

            return respond(500, {
                'error': 'could not load image'
            })

    #make privacy-safe copy
    try:
        redaction = create_redacted_copy(
            key,
            image_bytes,
            content_type
        )

    except Exception as e:
        print('Redaction error:', repr(e))

        return respond(500, {
            'error': 'could not create privacy-safe image'
        })

    #normal AWS Rekognition
    try:
        result = rek.detect_labels(
            Image={
                'S3Object': {
                    'Bucket': BUCKET,
                    'Name': key
                }
            },
            MaxLabels=20,
            MinConfidence=60,
            Features=[
                'GENERAL_LABELS',
                'IMAGE_PROPERTIES'
            ]
        )

    except Exception as e:
        print('Rekognition error:', repr(e))

        return respond(500, {
            'error': 'could not analyse image'
        })

    labels = []

    for label in result.get('Labels', []):
        if label['Name'].lower() in BLOCKED:
            continue

        labels.append({
            'name': label['Name'],
            'confidence': round(label['Confidence'], 1)
        })

    image_properties = result.get('ImageProperties', {})

    foreground_colours = (
        image_properties
        .get('Foreground', {})
        .get('DominantColors', [])
    )

    if foreground_colours:
        raw_colours = foreground_colours
    else:
        raw_colours = image_properties.get(
            'DominantColors',
            []
        )

    rgb_colours = []

    for colour in raw_colours:
        if colour['PixelPercent'] < 3:
            continue

        rgb_colours.append({
            'name': colour['SimplifiedColor'],
            'css': colour['CSSColor'],
            'red': colour['Red'],
            'green': colour['Green'],
            'blue': colour['Blue'],
            'pct': round(colour['PixelPercent'], 1),
            'neutral': is_neutral(
                colour['Red'],
                colour['Green'],
                colour['Blue']
            )
        })

    merged = {}

    for colour in raw_colours:
        name = colour['SimplifiedColor']

        merged[name] = (
            merged.get(name, 0)
            + colour['PixelPercent']
        )

    colours = [
        {
            'name': name,
            'pct': round(percent, 1)
        }
        for name, percent in sorted(
            merged.items(),
            key=lambda item: -item[1]
        )
        if percent >= 5
    ]

    #choose strongest useful item colour
    dominant_rgb = None

    if len(rgb_colours) > 0:
        non_neutral = []

        for colour in rgb_colours:
            if colour['neutral'] == False:
                non_neutral.append(colour)

        if len(non_neutral) > 0:
            strongest = max(
                non_neutral,
                key=lambda colour: colour['pct']
            )
        else:
            strongest = max(
                rgb_colours,
                key=lambda colour: colour['pct']
            )

        dominant_rgb = {
            'name': strongest['name'],
            'red': strongest['red'],
            'green': strongest['green'],
            'blue': strongest['blue'],
            'pct': strongest['pct']
        }

    #our trained Back2U Custom Labels model
    custom_labels = []
    custom_top_label = None
    custom_model_status = 'unavailable'

    try:
        custom_result = rek.detect_custom_labels(
            ProjectVersionArn=CUSTOM_MODEL_ARN,
            Image={
                'S3Object': {
                    'Bucket': BUCKET,
                    'Name': key
                }
            },
            MinConfidence=0
        )

        for label in custom_result.get('CustomLabels', []):
            custom_labels.append({
                'name': label['Name'],
                'confidence': round(label['Confidence'], 1)
            })

        custom_labels.sort(
            key=lambda label: label['confidence'],
            reverse=True
        )

        if len(custom_labels) > 0:
            custom_top_label = custom_labels[0]

        custom_model_status = 'running'

    except ClientError as e:
        error_code = (
            e.response
            .get('Error', {})
            .get('Code', '')
        )

        if error_code == 'ResourceNotReadyException':
            #custom model is stopped, normal Rekognition can still work
            custom_model_status = 'stopped'

        else:
            print('Custom Labels error:', repr(e))
            custom_model_status = 'error'

    #Bedrock only runs when the image passed the privacy check
    ai_description = None
    bedrock_status = 'skipped_privacy'

    if redaction['status'] == 'clean':
        try:
            ai_description = generate_ai_description(
                image_bytes,
                content_type
            )

            if ai_description:
                bedrock_status = 'generated'

            else:
                bedrock_status = 'empty'

        except Exception as e:
            print('Bedrock error:', repr(e))
            bedrock_status = 'error'

    return respond(200, {
        'image_key': key,
        'redacted_image_key': redaction['key'],

        #privacy check
        'redaction_status': redaction['status'],
        'redaction_count': redaction['count'],
        'redaction_reasons': redaction['reasons'],

        #normal Rekognition
        'labels': labels,
        'colours': colours,
        'rgb_colours': rgb_colours,
        'dominant_rgb': dominant_rgb,

        #trained Back2U model
        'custom_model_status': custom_model_status,
        'custom_top_label': custom_top_label,
        'custom_labels': custom_labels,

        #Bedrock image description
        'bedrock_status': bedrock_status,
        'ai_description': ai_description
    })


#use Bedrock to describe the item in one short sentence
def generate_ai_description(image_bytes, content_type):
    image_format = 'jpeg'

    if content_type == 'image/png':
        image_format = 'png'

    response = bedrock.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[
            {
                'role': 'user',
                'content': [
                    {
                        'image': {
                            'format': image_format,
                            'source': {
                                'bytes': image_bytes
                            }
                        }
                    },
                    {
                        'text': (
                            'Describe the lost-and-found item in one short sentence. '
                            'Focus on the object type, colour and distinctive visible '
                            'features. Do not identify people and do not include names, '
                            'numbers, addresses, dates or any personal information.'
                        )
                    }
                ]
            }
        ],
        inferenceConfig={
            'maxTokens': 80,
            'temperature': 0.2
        }
    )

    content = (
        response
        .get('output', {})
        .get('message', {})
        .get('content', [])
    )

    for item in content:
        text = item.get('text')

        if text:
            return text.strip()

    return None


#make a separate image that is safe to show to users
def create_redacted_copy(key, image_bytes, content_type):
    image_ref = {
        'S3Object': {
            'Bucket': BUCKET,
            'Name': key
        }
    }

    text_result = rek.detect_text(
        Image=image_ref
    )

    face_result = rek.detect_faces(
        Image=image_ref,
        Attributes=['DEFAULT']
    )

    image = Image.open(
        BytesIO(image_bytes)
    )

    lines = [
        item
        for item in text_result.get('TextDetections', [])
        if item.get('Type') == 'LINE'
    ]

    #some images might only return words
    if len(lines) == 0:
        lines = [
            item
            for item in text_result.get('TextDetections', [])
            if item.get('Type') == 'WORD'
        ]

    detected_text = ' '.join(
        item.get('DetectedText', '')
        for item in lines
    )

    detected_upper = detected_text.upper()

    #if it looks like an identity document, hide all detected text
    identity_document = (
        'IDENTITY CARD' in detected_upper
        or 'REPUBLIC OF SINGAPORE' in detected_upper
        or 'DRIVER LICENSE' in detected_upper
        or 'DRIVER LICENCE' in detected_upper
        or "DRIVER'S LICENSE" in detected_upper
        or "DRIVER'S LICENCE" in detected_upper
        or 'DRIVING LICENCE' in detected_upper
        or 'PASSPORT' in detected_upper
        or NRIC_FIN_PATTERN.search(detected_text) is not None
    )

    redaction_count = 0
    reasons = []

    #blur faces
    face_details = face_result.get(
        'FaceDetails',
        []
    )

    if len(face_details) > 0:
        reasons.append('face')

    for face in face_details:
        box = face.get('BoundingBox')

        if box:
            blur_box(
                image,
                box
            )
            redaction_count += 1

    sensitive_text_found = False

    #blur sensitive text
    for item in lines:
        text = item.get(
            'DetectedText',
            ''
        )

        sensitive = (
            identity_document
            or NRIC_FIN_PATTERN.search(text)
            or EMAIL_PATTERN.search(text)
            or PHONE_PATTERN.search(text)
        )

        if not sensitive:
            continue

        box = (
            item
            .get('Geometry', {})
            .get('BoundingBox')
        )

        if not box:
            continue

        blur_box(
            image,
            box
        )

        redaction_count += 1
        sensitive_text_found = True

    if identity_document:
        reasons.append('identity document')

    elif sensitive_text_found:
        reasons.append('sensitive text')

    extension = '.jpg'
    output_format = 'JPEG'

    if (
        content_type == 'image/png'
        or key.lower().endswith('.png')
    ):
        extension = '.png'
        output_format = 'PNG'

    redacted_key = (
        'redacted/'
        + str(uuid.uuid4())
        + extension
    )

    #JPEG cannot save an RGBA image
    if (
        output_format == 'JPEG'
        and image.mode not in ['RGB', 'L']
    ):
        image = image.convert('RGB')

    output = BytesIO()

    if output_format == 'JPEG':
        image.save(
            output,
            format='JPEG',
            quality=90
        )
    else:
        image.save(
            output,
            format='PNG'
        )

    s3.put_object(
        Bucket=BUCKET,
        Key=redacted_key,
        Body=output.getvalue(),
        ContentType=content_type
    )

    status = 'clean'

    if redaction_count > 0:
        status = 'redacted'

    return {
        'key': redacted_key,
        'status': status,
        'count': redaction_count,
        'reasons': reasons
    }


def blur_box(image, box):
    width, height = image.size

    left = int(
        box.get('Left', 0)
        * width
    )

    top = int(
        box.get('Top', 0)
        * height
    )

    right = int(
        (
            box.get('Left', 0)
            + box.get('Width', 0)
        )
        * width
    )

    bottom = int(
        (
            box.get('Top', 0)
            + box.get('Height', 0)
        )
        * height
    )

    padding = max(
        6,
        int(min(width, height) * 0.008)
    )

    left = max(
        0,
        left - padding
    )

    top = max(
        0,
        top - padding
    )

    right = min(
        width,
        right + padding
    )

    bottom = min(
        height,
        bottom + padding
    )

    if right <= left or bottom <= top:
        return

    region = image.crop(
        (left, top, right, bottom)
    )

    region = region.filter(
        ImageFilter.GaussianBlur(
            radius=18
        )
    )

    image.paste(
        region,
        (left, top)
    )


def respond(code, payload):
    return {
        'statusCode': code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(payload)
    }


def is_neutral(r, g, b):
    #greys, whites and blacks can also come from the background
    return max(r, g, b) - min(r, g, b) < 25