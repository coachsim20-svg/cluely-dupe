import { PictureInPicture } from "@/components/picture-in-picture";
import Image from "next/image";
import { Card } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="p-8 bg-accent h-screen gap-12">
      <PictureInPicture />
      <Card className="max-w-md p-0 mx-auto shadow-none overflow-hidden">
        <Image
          className="w-full h-full object-cover"
          src="/Screenshot.png"
          alt="NBG AI"
          width={500}
          height={100}
        />
      </Card>
    </div>
  );
}
