import jsdomGlobal from "jsdom-global";
jsdomGlobal();

type Props = {
  initialState: any;
};

export default async function convert({ initialState }: Props) {
  const { Crypto } = await import("@peculiar/webcrypto");
  global.crypto = new Crypto();
  global.devicePixelRatio = 1;

  // @ts-ignore
  const { exportToSvg } = await import("@excalidraw/utils");
  return await exportToSvg(initialState);
}
