import Image from "next/image";

// Brand mark (the gold key-in-shield). Single source of truth for the logo asset:
// to change it, replace `public/seneschal-logo.png`. A SQUARE, TRANSPARENT-background
// PNG (≥256px) is recommended so the mark sits cleanly on both the ivory login screen
// and the navy app sidebar. Sized by the caller via `className` (e.g. "h-20 w-20").
export function Logo({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/seneschal-logo.png"
      alt="Seneschal"
      width={512}
      height={512}
      priority={priority}
      className={className}
    />
  );
}
