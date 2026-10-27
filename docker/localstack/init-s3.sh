#!/bin/sh
# Выполняется LocalStack при готовности (ready.d): бакет для файлов + CORS, чтобы браузер мог
# класть куски по presigned PUT и читать txt через fetch. Чтение объектов в LocalStack анонимное.
set -e
BUCKET="${S3_BUCKET_NAME:-comments}"
awslocal s3 mb "s3://${BUCKET}" 2>/dev/null || true
awslocal s3api put-bucket-cors --bucket "${BUCKET}" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
}'
echo "S3 bucket ${BUCKET} ready"
