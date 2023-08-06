import { ImageResponse } from "next/server";

export const runtime = "edge";

export default async function handler(...args) {
  console.log(args);
  const ebGaramond = await fetch(
    new URL("../lib/fonts/EBGaramond-Regular.ttf", import.meta.url)
  ).then((res) => res.arrayBuffer());
  const ebGaramondBold = await fetch(
    new URL("../lib/fonts/EBGaramond-Bold.ttf", import.meta.url)
  ).then((res) => res.arrayBuffer());
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          fontSize: 100,
          fontFamily: '"EB Garamond", serif"',
          background: "white",
          width: "100%",
          height: "100%",
          display: "flex",
          textAlign: "center",
          padding: "100px",
        }}
      >
        <img
          style={{
            position: "absolute",
            right: "0",
            top: "100px",
          }}
          src="http://localhost:3000/head.png"
          alt="My face"
          width={680}
          height={907}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontWeight: 800,
            }}
          >
            Mitchell Hynes
          </div>
          <div
            style={{
              fontSize: 50,
            }}
          >
            Full-Stack Developer
          </div>
        </div>
      </div>
    ),
    {
      fonts: [
        {
          name: "EB Garamond",
          data: ebGaramond,
          weight: 400,
          style: "normal",
        },
        {
          name: "EB Garamond",
          data: ebGaramondBold,
          weight: 800,
          style: "normal",
        },
      ],
      width: 1200,
      height: 600,
    }
  );
}
