/* eslint-disable @next/next/no-img-element */
import Shape from "@mitch/components/icons/Shape";
import Navbar from "@mitch/components/navbar/Navbar";
import { Badge } from "@mitch/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@mitch/components/ui/card";
import portfolio from "@mitch/portfolio";
import portolio from "@mitch/portfolio";
import Image from "next/image";

export default function Home() {
  return (
    <main className="relative">
      <div className="absolute w-screen max-w-full aspect-video overflow-hidden">
        <div className="absolute top-[-100px] md:top-[-200px] left-0 bg-white">
          <Shape className="text-slate-100 w-screen h-auto max-w-full" />
        </div>
        <Image
          src="/head.png"
          alt="My face"
          width={680}
          height={907}
          className="absolute w-[47vw] right-[20px] top-[0px]"
        />
        <Shape className="text-background absolute top-0 left-0 w-screen h-auto max-w-full" />
      </div>

      <div className="absolute flex flex-col items-center justify-between p-4 md:p-24 w-screen max-w-full aspect-video gap-10 lg:gap-32">
        <div className="flex-0">
          <Navbar portfolio={portfolio} />
        </div>

        <div className="text-center gap-2 flex flex-col mt-40 md:m-0 w-full flex-1">
          <div className="md:w-1/2 bg-white p-8 border-dashed border-amber-100 border-4 shadow-lg">
            <p className="text-md md:text-2xl">Full-Stack Engineer</p>
            <div className="text-2xl lg:text-5xl text-red-700">
              <h1 className="font-sans skew-x-[20deg]">MITCHELL HYNES</h1>
            </div>
            <ul className="flex flex-row flex-wrap lg:w-1/2 mx-auto justify-center gap-2 mt-2">
              <li>
                <a href="https://junglescout.com">Jungle Scout</a>
              </li>
              <li>
                <a href="https://siftmed.ca">Siftmed</a>
              </li>
              <li>
                <a href="https://colabsoftware.com">Colab Software</a>
              </li>
              <li>
                <a href="https://get-coding.ca">GetCoding</a>
              </li>
              <li>
                <a href="https://www.notificationapi.com/">NotificationAPI</a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/** Hugh Mungus Spacer */}
      <div className="aspect-video w-screen max-w-full" />

      <div className="w-screen max-w-full flex items-center flex-col gap-8 md:mt-0 mt-96 pb-32">
        <h1 className="text-4xl font-bold">Projects</h1>
        <div className="flex flex-row items-start justify-center gap-4 flex-wrap">
          {portolio.map((project) => (
            <a
              href={project.link}
              key={project.title}
              className="relative group"
            >
              <Card className="relative hover:shadow-xl animate z-10 w-72">
                <CardHeader>
                  <CardTitle>{project.title}</CardTitle>
                  <CardDescription>{project.description}</CardDescription>
                </CardHeader>
                <CardContent className="h-[200px] flex items-center">
                  <img
                    src={project.image}
                    alt={project.title}
                    width={200}
                    className="my-2 mx-auto rounded-md border-black border-2"
                  />
                </CardContent>
                <CardFooter className="flex gap-2 font-bold flex-wrap">
                  {project.tags.map((tag) => (
                    <Badge key={tag} className="uppercase whitespace-nowrap">
                      {tag}
                    </Badge>
                  ))}
                </CardFooter>
              </Card>
              <div className="invisible group-hover:visible group-focus:visible w-full h-full absolute z-50 top-0 bg-blue-300 bg-opacity-50 backdrop-blur-md flex items-center justify-center text-xl font-bold underline border-dashed border-black border-2 rounded-md">
                <div className="px-2 rounded-sm bg-white bg-opacity-50">
                  Visit {project.title}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
