import Image from "next/image";
import { cn } from "@/lib/utils";
import { brand } from "@/lib/brand";

type CyMonogramProps = {
  className?: string;
  title?: string;
  priority?: boolean;
};

/** Official ContractorYou CY mark. */
export function CyMonogram({ className, title, priority }: CyMonogramProps) {
  return (
    <Image
      src="/brand/cy-mark.png"
      alt={title ?? ""}
      width={480}
      height={278}
      sizes="80px"
      priority={priority}
      className={cn("h-9 w-auto", className)}
    />
  );
}

export function OfficialLockup({
  className,
  priority,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/contractoryou-lockup.png"
      alt={brand.name}
      width={1400}
      height={465}
      sizes="(max-width: 768px) 260px, 300px"
      priority={priority}
      className={cn("h-auto w-[260px] md:w-[300px]", className)}
    />
  );
}
