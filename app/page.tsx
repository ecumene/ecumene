/* eslint-disable @next/next/no-img-element */
import Shape from "@mitch/components/icons/Shape";
import { Badge } from "@mitch/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@mitch/components/ui/card";
import portolio from "@mitch/portfolio";
import Image from "next/image";

export default function Home() {
  return (
    <main className="relative">
      <div className="absolute w-screen max-w-full aspect-video overflow-hidden">
        <div className="absolute top-[-50px] md:top-[-200px] left-0 bg-sky-100">
          <Shape className="text-rose-800 w-screen h-auto max-w-full" />
        </div>
        <div className="absolute right-[20px] top-[0px]">
          <div className="relative w-[47vw]">
            <Image
              src="/head.svg"
              alt="My face"
              width={680}
              height={907}
              className="w-full h-auto"
            />
            <Image
              src="/head.png"
              alt="My face"
              width={680}
              height={907}
              className="absolute top-[0px] w-full h-auto"
            />
          </div>
        </div>
        <Shape className="text-background absolute top-0 left-0 w-screen h-auto max-w-full" />
      </div>

      <div className="absolute flex flex-col items-center justify-between p-4 md:p-24 w-screen max-w-full aspect-video gap-10 lg:gap-32">
        <div className="text-center gap-2 flex flex-col mt-40 md:m-0 w-full flex-1 justify-end">
          <div className="md:w-1/2 p-8 border-dashed relative py-40">
            <Image
              src="/background.png"
              alt="White paint background"
              width={337}
              height={234}
              className="absolute top-[50%] -translate-y-1/2 left-0"
            />
            <p className="text-md md:text-2xl relative z-10 font-bold">
              Full-Stack Developer
            </p>
            <div className="text-2xl lg:text-5xl text-red-700">
              <Image
                src="/signature.svg"
                alt="Logo"
                width={1571}
                height={432}
                className="relative z-10 w-1/2 mx-auto"
              />
            </div>
            <ul className="flex flex-row flex-wrap lg:w-1/2 mx-auto justify-center gap-2 mt-2 z-10 relative text-xl">
              <li>
                <a href="https://junglescout.com">Jungle Scout</a>
              </li>
              <li>
                <a href="https://get-coding.ca">GetCoding</a>
              </li>
              <div className="flex gap-2 whitespace-nowrap text-sm">
                <p>previously@</p>
                <li>
                  <a href="https://siftmed.ca">Siftmed</a>
                </li>
                <li>
                  <a href="https://colabsoftware.com">Colab Software</a>
                </li>
                <li>
                  <a href="https://www.notificationapi.com/">NotificationAPI</a>
                </li>
              </div>
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
                  <CardDescription className="h-8">
                    {project.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[230px]">
                  <img
                    loading="lazy"
                    src={project.image}
                    alt={project.title}
                    height={200}
                    className="my-2 rounded-md border-black border-2"
                  />
                </CardContent>
                <CardFooter className="flex gap-2 font-bold flex-wrap h-20">
                  {project.tags.map((tag) => (
                    <Badge key={tag} className="uppercase whitespace-nowrap">
                      {tag}
                    </Badge>
                  ))}
                </CardFooter>
              </Card>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
