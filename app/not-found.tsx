import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main>
      <section className="flex flex-col items-center justify-center my-16">
        <h1 className="text-4xl font-bold">404</h1>
        <p>Page not found.</p>
        <a href="/" className="underline text-md flex gap-2 items-center">
          <ArrowLeft />
          Return to the homepage
        </a>
      </section>
    </main>
  );
}
