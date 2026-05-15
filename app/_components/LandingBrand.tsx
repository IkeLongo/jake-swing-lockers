import Image from "next/image";
import { Michroma } from "next/font/google";

const michroma = Michroma({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export function LandingBrand() {
  return (
    <div className="inline-flex items-center gap-2.5 sm:gap-3">
      <Image
        src="/logos/jl-golf-sales-green-icon-variant.svg"
        alt="JL Golf Sales logo"
        width={34}
        height={34}
        priority
        className="h-8 w-8 object-contain sm:h-9 sm:w-9"
      />
      <span
        className={`${michroma.className} text-[0.72rem] font-medium uppercase tracking-[0.22em] text-[#24392f] sm:text-sm`}
      >
        JL GOLF SALES
      </span>
    </div>
  );
}
