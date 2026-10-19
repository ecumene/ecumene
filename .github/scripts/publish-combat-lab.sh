#!/usr/bin/env bash

set -euo pipefail

: "${MH_BUCKET_ID:?MH_BUCKET_ID must contain the personal-site S3 bucket name}"
: "${MH_DISTRIBUTION_ID:?MH_DISTRIBUTION_ID must contain its CloudFront distribution ID}"

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
invalidation_paths=("/halo*" "/halo-preview*" "/combat-lab*")
case "${1:-}" in
  "") ;;
  --all-site) invalidation_paths+=("/*") ;;
  *) echo "Usage: $0 [--all-site]" >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [--all-site]" >&2
  exit 2
fi
for source in combat-lab-redirect.html retired-game-serviceworker.js; do
  if [[ ! -s "${script_directory}/${source}" ]]; then
    echo "Missing deployment source: ${source}; nothing was removed." >&2
    exit 1
  fi
done

# Never retire the previous URLs before the replacement has been uploaded.
for runtime_file in index.html engine.js engine.wasm coi-serviceworker.js; do
  runtime_size="$(aws s3api head-object \
    --bucket "${MH_BUCKET_ID}" \
    --key "combat-lab/${runtime_file}" \
    --query ContentLength --output text --no-cli-pager)"
  if [[ ! "${runtime_size}" =~ ^[0-9]+$ ]] || [[ "${runtime_size}" -eq 0 ]]; then
    echo "Combat Lab's ${runtime_file} is missing or empty; nothing was removed." >&2
    exit 1
  fi
done

# These are the only prefixes this script removes. The replacement and the
# rest of the personal website are outside both prefixes.
for prefix in halo halo-preview; do
  aws s3 rm "s3://${MH_BUCKET_ID}/${prefix}/" \
    --recursive --only-show-errors --no-cli-pager

  for key in "${prefix}" "${prefix}/index.html" "${prefix}/halo.html"; do
    aws s3api put-object \
      --bucket "${MH_BUCKET_ID}" \
      --key "${key}" \
      --body "${script_directory}/combat-lab-redirect.html" \
      --content-type "text/html; charset=utf-8" \
      --cache-control "public, max-age=0, must-revalidate" \
      --website-redirect-location "/combat-lab/" \
      --no-cli-pager >/dev/null
  done

  # An installed worker must receive JavaScript, not a redirect, on update.
  aws s3api put-object \
    --bucket "${MH_BUCKET_ID}" \
    --key "${prefix}/coi-serviceworker.js" \
    --body "${script_directory}/retired-game-serviceworker.js" \
    --content-type "application/javascript; charset=utf-8" \
    --cache-control "no-store" \
    --no-cli-pager >/dev/null
done

invalidation_id="$(aws cloudfront create-invalidation \
  --distribution-id "${MH_DISTRIBUTION_ID}" \
  --paths "${invalidation_paths[@]}" \
  --query Invalidation.Id --output text --no-cli-pager)"
if [[ -z "${invalidation_id}" || "${invalidation_id}" == None ]]; then
  echo "CloudFront did not return an invalidation ID." >&2
  exit 1
fi
aws cloudfront wait invalidation-completed \
  --distribution-id "${MH_DISTRIBUTION_ID}" \
  --id "${invalidation_id}" --no-cli-pager

echo "Combat Lab is published; legacy files are retired and CloudFront invalidation is complete."
