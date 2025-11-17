import { SkeletonAIResponse } from "@/components/skeletons";
import { CardDescription, CardTitle } from "./ui/card";

export function EmptyDPIP() {
  return (
    <div className="flex flex-col border-dashed shadow-none gap-2">
      <CardTitle>No Scripts Yet</CardTitle>
      <CardDescription className="mb-2">
        Click the buttons below to get NBG scripts for your session.
      </CardDescription>

      <SkeletonAIResponse />
    </div>
  );
}
