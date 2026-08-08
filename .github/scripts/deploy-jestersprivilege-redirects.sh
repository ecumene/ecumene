#!/usr/bin/env bash

set -euo pipefail

: "${JP_BUCKET_ID:?JP_BUCKET_ID must contain the Jester S3 bucket name}"
: "${JP_DISTRIBUTION_ID:?JP_DISTRIBUTION_ID must contain the Jester CloudFront distribution ID}"

REDIRECT_DIRECTORY="${1:?Pass the directory produced by build-jestersprivilege-redirects.mjs}"
MANIFEST="${REDIRECT_DIRECTORY}/redirects.json"

if [[ ! -f "${MANIFEST}" ]]; then
  echo "Redirect manifest not found: ${MANIFEST}" >&2
  exit 1
fi

while IFS= read -r redirect; do
  key="$(jq -r '.key' <<<"${redirect}")"
  source="$(jq -r '.source' <<<"${redirect}")"
  destination="$(jq -r '.destination' <<<"${redirect}")"

  aws s3api put-object \
    --bucket "${JP_BUCKET_ID}" \
    --key "${key}" \
    --body "${REDIRECT_DIRECTORY}/${source}" \
    --content-type "text/html; charset=utf-8" \
    --cache-control "public, max-age=300" \
    --website-redirect-location "${destination}" \
    --no-cli-pager >/dev/null
done < <(jq -c '.[]' "${MANIFEST}")

aws cloudfront create-invalidation \
  --distribution-id "${JP_DISTRIBUTION_ID}" \
  --paths "/*" \
  --no-cli-pager >/dev/null

echo "Uploaded Jester redirect objects and invalidated ${JP_DISTRIBUTION_ID}."
