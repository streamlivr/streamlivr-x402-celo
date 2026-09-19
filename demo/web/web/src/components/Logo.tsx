import Image from 'next/image';

/** The app wordmark. Dark surface only, so this file has one job. */
export function Logo({ height = 18, className }: { height?: number; className?: string }) {
  // Both source files are ~5.55:1, which keeps the intrinsic size predictable.
  const width = Math.round(height * (1200 / 216));
  return (
    <Image
      src="/streamlivr-logo-dark.png"
      alt="Streamlivr"
      width={width}
      height={height}
      priority
      className={className}
      style={{ height, width: 'auto' }}
    />
  );
}
