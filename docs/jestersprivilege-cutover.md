# Jester's Privilege cutover

`mitchellhynes.com/blog` is the canonical home for both essays and development logs. The old `jestersprivilege.ca` S3 bucket remains available as a legacy asset origin; its Astro app is no longer deployed.

## Redirects

Redirect objects in the existing S3 website bucket send old page routes to their canonical locations:

| Old route                                 | Canonical route                        |
| ----------------------------------------- | -------------------------------------- |
| `/`, `/blog`, and `/devlog`               | `https://mitchellhynes.com/blog`       |
| `/blog/:slug`                             | `https://mitchellhynes.com/blog/:slug` |
| `/devlog/:slug`                           | `https://mitchellhynes.com/blog/:slug` |
| `/about`                                  | `https://mitchellhynes.com/about`      |
| `/rss.xml`                                | `https://mitchellhynes.com/rss.xml`    |
| `/sitemap-index.xml` and `/sitemap-0.xml` | matching `mitchellhynes.com` sitemap   |
| `/blog/using-mdx`                         | `https://mitchellhynes.com/blog`       |

All other paths pass through to the existing Jester origin. This deliberately preserves article media and generated `/og/*.png` images.

## Deployment

After a successful `mitchellhynes.com` production deployment, `jestersprivilege-ca-redirect.yml` builds redirect pages from the unified post collection and uploads only those objects to the existing Jester bucket. It never uses `s3 sync --delete`, so legacy media remains untouched. Each object carries S3 website redirect metadata for a real 301 and also contains a canonical HTML redirect as a fallback.

The workflow uses the `AWS_ROLE_ARN` GitHub secret when it is present and falls back to the existing access-key secrets during the OIDC migration. It needs the same `s3:PutObject` and `cloudfront:CreateInvalidation` permissions as the previous Jester deployment.

`JP_DISTRIBUTION_ID` continues to identify the existing Jester distribution. Redirect-only changes can be applied manually with the workflow-dispatch control instead of redeploying the main site.

## Rollback

Restore a previous version of the overwritten HTML objects from S3 version history or redeploy the old Jester application from Git history. Legacy media is never removed by the redirect workflow.
