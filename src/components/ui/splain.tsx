type Props = {
  text: string;
};

export default function MitchSplain({ text }: Props) {
  return (
    <div className="flex justify-end items-center">
      <span className="relative mr-2 text-sm bg-blue-500 text-white max-w-[255px] py-[10px] font-sms px-[20px] my-4 rounded-[25px] before:right-[-7px] before:absolute before:w-[20px] before:bottom-0 before:h-[25px] before:bg-blue-500 before:rounded-bl-[16px] after:right-[-8px] after:rounded-bl-[10px] after:w-[8px] after:absolute after:bottom-0 after:bg-background after:h-[25px]">
        {text}
      </span>
      <img
        className="rounded-full mt-auto"
        alt="A hand drawn picture of myself"
        src="/profile.jpg"
        width={50}
        height={50}
      />
    </div>
  );
}
