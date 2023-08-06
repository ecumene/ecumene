/* eslint-disable @next/next/no-img-element */
import {
  GetObjectCommand,
  ListObjectsCommand,
  ListObjectsOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ArrowLeft } from "lucide-react";
import { Bucket } from "sst/node/bucket";

const client = new S3Client({});

const getUrls = async (items: ListObjectsOutput) => {
  return (
    items.Contents &&
    (await Promise.all(
      items.Contents.map(async (item) => {
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: Bucket.paintings.bucketName,
            Key: item.Key,
          })
        );
        return url;
      })
    ))
  );
};

export default async function Home() {
  const items = await client.send(
    new ListObjectsCommand({
      Bucket: Bucket.paintings.bucketName,
    })
  );

  const urls = await getUrls(items);

  return (
    <main className="relative">
      <div className="m-12 flex flex-col items-center justify-center">
        <h1 className="text-4xl font-bold">Paintings</h1>
        <p>I like to paint in my free time. I use an iPad with Procreate.</p>
        <p>Sorry for the super long load time.</p>
        <a href="/" className="underline text-md flex gap-2 items-center">
          <ArrowLeft /> Return to the homepage
        </a>
      </div>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
        {urls?.map((url) => (
          <img loading="lazy" alt="image" key={url} src={url} />
        ))}
      </div>
    </main>
  );
}
