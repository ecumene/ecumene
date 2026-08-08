# Jester's Privilege cutover

`mitchellhynes.com/blog` is the canonical home for both essays and development logs. The old `jestersprivilege.ca` S3 bucket remains available as a legacy asset origin; its Astro app is no longer deployed.

## Redirects

The CloudFront viewer-request function redirects page routes before they reach S3:

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

After a successful `mitchellhynes.com` production deployment, `jestersprivilege-ca-redirect.yml` publishes the CloudFront Function and attaches it to the default cache behavior. Sequencing the workflows this way ensures the canonical pages are live before the old domain begins redirecting. The script refuses to overwrite a different viewer-request function.

The workflow uses the `AWS_ROLE_ARN` GitHub secret when it is present and falls back to the existing access-key secrets during the OIDC migration. The AWS principal needs these CloudFront permissions:

- `cloudfront:CreateFunction`
- `cloudfront:DescribeFunction`
- `cloudfront:UpdateFunction`
- `cloudfront:PublishFunction`
- `cloudfront:GetDistributionConfig`
- `cloudfront:UpdateDistribution`

`JP_DISTRIBUTION_ID` continues to identify the existing Jester distribution. Redirect-only changes can be applied manually with the workflow-dispatch control instead of redeploying the main site.

## Rollback

Remove the viewer-request function association from the default cache behavior in CloudFront. The original Jester build remains in S3, so removing the association restores it without a content upload.
