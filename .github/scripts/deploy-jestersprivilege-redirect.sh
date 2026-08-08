#!/usr/bin/env bash

set -euo pipefail

: "${JP_DISTRIBUTION_ID:?JP_DISTRIBUTION_ID must contain the Jester CloudFront distribution ID}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FUNCTION_CODE="${ROOT_DIR}/.github/cloudfront/jestersprivilege-redirect.js"
FUNCTION_NAME="${JP_REDIRECT_FUNCTION_NAME:-jestersprivilege-ca-redirect}"
FUNCTION_CONFIG='{"Comment":"Canonical redirects for jestersprivilege.ca","Runtime":"cloudfront-js-2.0"}'
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

if aws cloudfront describe-function --name "${FUNCTION_NAME}" --stage DEVELOPMENT >"${TEMP_DIR}/function.json" 2>/dev/null; then
  FUNCTION_ETAG="$(jq -r '.ETag' "${TEMP_DIR}/function.json")"
  aws cloudfront update-function \
    --name "${FUNCTION_NAME}" \
    --if-match "${FUNCTION_ETAG}" \
    --function-config "${FUNCTION_CONFIG}" \
    --function-code "fileb://${FUNCTION_CODE}" \
    --no-cli-pager >/dev/null
else
  aws cloudfront create-function \
    --name "${FUNCTION_NAME}" \
    --function-config "${FUNCTION_CONFIG}" \
    --function-code "fileb://${FUNCTION_CODE}" \
    --no-cli-pager >/dev/null
fi

FUNCTION_ETAG="$(
  aws cloudfront describe-function \
    --name "${FUNCTION_NAME}" \
    --stage DEVELOPMENT \
    --query 'ETag' \
    --output text
)"
aws cloudfront publish-function \
  --name "${FUNCTION_NAME}" \
  --if-match "${FUNCTION_ETAG}" \
  --no-cli-pager >/dev/null

FUNCTION_ARN="$(
  aws cloudfront describe-function \
    --name "${FUNCTION_NAME}" \
    --stage LIVE \
    --query 'FunctionSummary.FunctionMetadata.FunctionARN' \
    --output text
)"

aws cloudfront get-distribution-config \
  --id "${JP_DISTRIBUTION_ID}" \
  --no-cli-pager >"${TEMP_DIR}/distribution.json"

DISTRIBUTION_ETAG="$(jq -r '.ETag' "${TEMP_DIR}/distribution.json")"
EXISTING_VIEWER_FUNCTION="$(
  jq -r '
    .DistributionConfig.DefaultCacheBehavior.FunctionAssociations.Items[]?
    | select(.EventType == "viewer-request")
    | .FunctionARN
  ' "${TEMP_DIR}/distribution.json"
)"

if [[ -n "${EXISTING_VIEWER_FUNCTION}" && "${EXISTING_VIEWER_FUNCTION}" != "${FUNCTION_ARN}" ]]; then
  echo "Refusing to replace existing viewer-request function: ${EXISTING_VIEWER_FUNCTION}" >&2
  exit 1
fi

jq --arg function_arn "${FUNCTION_ARN}" '
  .DistributionConfig
  | .DefaultCacheBehavior.FunctionAssociations //= {"Quantity": 0, "Items": []}
  | .DefaultCacheBehavior.FunctionAssociations.Items = (
      (.DefaultCacheBehavior.FunctionAssociations.Items // [])
      | map(select(.EventType != "viewer-request"))
      + [{"EventType": "viewer-request", "FunctionARN": $function_arn}]
    )
  | .DefaultCacheBehavior.FunctionAssociations.Quantity =
      (.DefaultCacheBehavior.FunctionAssociations.Items | length)
' "${TEMP_DIR}/distribution.json" >"${TEMP_DIR}/distribution-config.json"

aws cloudfront update-distribution \
  --id "${JP_DISTRIBUTION_ID}" \
  --if-match "${DISTRIBUTION_ETAG}" \
  --distribution-config "file://${TEMP_DIR}/distribution-config.json" \
  --no-cli-pager >/dev/null

echo "Published ${FUNCTION_NAME} and attached it to ${JP_DISTRIBUTION_ID}."
