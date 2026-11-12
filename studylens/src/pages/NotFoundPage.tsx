import { Link } from "react-router-dom";
import { BookOpenText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <main className="min-h-svh flex flex-col items-center justify-center bg-background p-4 text-center">
      <BookOpenText className="size-12 text-muted-foreground mb-4" />
      <h1 className="font-heading text-3xl font-bold">404 - Page Not Found</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        The page you are looking for does not exist or has been moved.
      </p>
      <Button className="mt-6" nativeButton={false} render={<Link to="/" />}>
        Back to StudyLens
      </Button>
    </main>
  );
}

