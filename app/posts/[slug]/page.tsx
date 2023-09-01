import type { Metadata } from "next";
import Image from "next/image";
import dynamic from "next/dynamic";
import React from "react";
import Link from "next/link";

type Props = {
  params: { slug: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    // TODO: Make this dynamic
    title: "Full-Stack Development Course",
  };
}

export default function Page({ params }: Props) {
  const Post = dynamic(() => import(`@mitch/content/${params.slug}.mdx`), {
    ssr: true,
  });

  return (
    <div>
      <div className="bg-accent border-b-card border-b-2">
        <div className="max-w-2xl m-auto px-2 sm:px-0 py-6">
          <Link href="/">
            <Image
              src="/logo.png"
              alt="Logo"
              width={1571}
              height={432}
              className="relative w-1/6"
            />
          </Link>
          <div className="pt-4">Writings &gt; Get Coding &gt; NodeJS</div>
          <h1 className="text-3xl font-bold">Full-stack Development Course</h1>
        </div>
      </div>
      <div className="post-content max-w-2xl m-auto px-2 sm:px-0">
        {/* TODO: Make this dynamic */}
        <Post />
      </div>
    </div>
  );
}
