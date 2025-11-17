import { Skeleton } from "./ui/skeleton";

export function SkeletonAIResponse() {
  return (
    <div className="w-full space-y-2">
      <Skeleton className="h-6 w-1/2 mb-4 bg-foreground/10" />
      <Skeleton className="h-4 w-full bg-foreground/10" />
      <Skeleton className="h-4 w-full bg-foreground/10" />
      <Skeleton className="h-4 w-7/8 bg-foreground/10" />
    </div>
  );
}
