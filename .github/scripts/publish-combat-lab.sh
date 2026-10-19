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
for source in combat-lab-redirect.html retired-game-serviceworker.js verify-combat-lab.py; do
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
      --website-redirect-location "https://mitchellhynes.com/combat-lab/" \
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
invalidation_confirmed=false
if wait_output="$(aws cloudfront wait invalidation-completed \
  --distribution-id "${MH_DISTRIBUTION_ID}" \
  --id "${invalidation_id}" --no-cli-pager 2>&1)"; then
  invalidation_confirmed=true
else
  wait_status=$?
  printf '%s\n' "${wait_output}" >&2
  if [[ "${wait_output}" == *"(AccessDenied)"* ]] &&
    [[ "${wait_output}" == *"cloudfront:GetInvalidation"* ||
       "${wait_output}" == *"when calling the GetInvalidation operation"* ]]; then
    echo "CloudFront invalidation was requested, but this role cannot inspect its global status. Checking public responses instead."
  else
    exit "${wait_status}"
  fi
fi

# Also verify the public responses when the invalidation waiter succeeds.
python3 "${script_directory}/verify-combat-lab.py"
if [[ "${invalidation_confirmed}" == true ]]; then
  echo "Combat Lab public endpoints verified; CloudFront invalidation is complete."
else
  echo "Combat Lab public endpoints verified; CloudFront global invalidation status remains unknown."
fi
