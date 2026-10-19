# Combat Lab on the personal website

The runtime is uploaded separately from Astro. Its production prefix is
`combat-lab/`; previews use `combat-lab-preview/`. The ordinary website sync
excludes those directories so it cannot delete the runtime.

1. Dispatch **Prepare Combat Lab AWS upload** (`halo-aws-bootstrap.yml`) with
   `target=combat-lab` or `target=combat-lab-preview`. The matching
   `<target>-upload` artifact contains a presigned S3 POST policy that expires
   after one hour. Treat it as a credential. Upload the staged files, including
   `index.html`, to that prefix. This workflow does not build or upload files.
2. After the production files are uploaded, dispatch **Publish Combat Lab on
   mitchellhynes.com** (`halo-aws-publish.yml`). Its reusable
   `publish-combat-lab.sh` script first checks that `index.html`, `engine.js`,
   `engine.wasm`, and `coi-serviceworker.js` exist and are nonempty under
   `combat-lab/`. Only then does it remove the old `halo/` and
   `halo-preview/` objects and install redirect entry points and worker cleanup.
3. The script invalidates `/halo*`, `/halo-preview*`, and `/combat-lab*`, and
   waits for CloudFront to finish. If the existing role specifically lacks
   `cloudfront:GetInvalidation`, it reports that global completion cannot be
   inspected and proceeds to public verification. Other waiter failures remain
   failures; no additional IAM permission is required. An ordinary website
   deployment uses `--all-site`, also invalidating the rest of the website.
4. After either a successful wait or that specific permission denial,
   `verify-combat-lab.py` retries public GET and HEAD checks for up to three
   minutes: all eight legacy entry aliases must return 301 to the absolute
   HTTPS Combat Lab URL, old JavaScript/WASM/menu art must return 404, and the
   new runtime must return 200 with the correct types and page title. It also
   checks the WASM header and exact cleanup-worker contents. A failing check
   fails the job. Public verification does not prove invalidation completion
   at every CloudFront location; that status remains explicitly unknown when
   the waiter lacks permission. `coi-serviceworker.js` intentionally remains
   at each legacy prefix to clean up installed workers.

The script needs `MH_BUCKET_ID`, `MH_DISTRIBUTION_ID`, and configured AWS
credentials. Existing workflows use `AWS_ROLE_ARN` when available, otherwise
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. They share the personal site's
production concurrency group. Run the publish workflow from the reviewed
current revision; historical revisions contain the retired upload logic.

Redirect objects use S3 website redirect metadata (HTTP 301) plus an HTML
fallback. The fallback preserves query strings and fragments. S3's static
redirect location cannot dynamically preserve query strings; preserving them
in the HTTP redirect would require an edge function. The cleanup worker can
also preserve them when navigating old open tabs. It unregisters only the
exact `/halo/` and `/halo-preview/` scopes, and never clears saved browser data,
Cache Storage, or other service-worker registrations.
