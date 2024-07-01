import { X } from "lucide-react";

type Props = {
  address: string;
  language: string;
  children: React.ReactNode;
};

export default function Webpage({ children, address, language }: Props) {
  return (
    <span className="flex justify-center my-12">
      <span className="flex flex-col border-black border rounded-lg mx-auto">
        <span className="px-2 border-black border-b gap-3 flex">
          <span className="flex items-center gap-2">
            <div className="rounded-lg w-4 h-4 bg-red-500" />
            <div className="rounded-lg w-4 h-4 bg-yellow-500" />
            <div className="rounded-lg w-4 h-4 bg-green-500" />
          </span>
          <div className="flex mt-2 border-black border-t border-r border-l rounded-tr-md rounded-tl-md px-2">
            <a href={address} className="font-bold font-sans text-sm">
              {address}
            </a>
            <div className="pl-1 font-bold font-sans">
              <X width={16} />
            </div>
          </div>
          <span className="border-dashed border-black border rounded-sm text-sm px-1 my-auto">
            {language}
          </span>
        </span>
        <span className="px-4 py-2 relative">{children}</span>
      </span>
    </span>
  );
}
