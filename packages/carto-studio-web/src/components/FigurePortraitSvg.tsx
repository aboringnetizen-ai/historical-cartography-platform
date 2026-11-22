import type { FigurePortraitStyle } from "../core/data/demo-types.ts";

export interface FigurePortraitSvgProps {
  name: string;
  monogram: string;
  accentHex: string;
  portraitStyle?: FigurePortraitStyle | undefined;
  variant: "portrait_medallion" | "crest_shield";
  size?: number;
}

export function FigurePortraitSvg(props: FigurePortraitSvgProps) {
  const size = props.size ?? 44;
  const st: FigurePortraitStyle = props.portraitStyle ?? {
    bg_hex: "#1e293b",
    cloak_hex: props.accentHex,
    skin_hex: "#ecc8a0",
    crown_type: "crown",
    beard: true,
  };
  const clipId = `clip-port-${props.monogram}-${props.variant}-${size}`;

  return (
    <svg
      width={size}
      height={props.variant === "crest_shield" ? Math.round(size * 1.15) : size}
      viewBox={props.variant === "crest_shield" ? "0 0 48 56" : "0 0 48 48"}
      aria-label={props.name}
      style={{ flexShrink: 0 }}
    >
      <defs>
        {props.variant === "crest_shield" ? (
          <clipPath id={clipId}>
            <path d="M 4 4 H 44 V 30 C 44 43 24 52 24 52 C 24 52 4 43 4 30 Z" />
          </clipPath>
        ) : (
          <clipPath id={clipId}>
            <circle cx="24" cy="24" r="21" />
          </clipPath>
        )}
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y="0" width="48" height="56" fill={st.bg_hex} />
        {/* Cloaked shoulders */}
        <path d="M 6 52 C 8 36 16 32 24 32 C 32 32 40 36 42 52 Z" fill={st.cloak_hex} />
        <path d="M 18 32 L 24 39 L 30 32" fill="none" stroke="#fef3c7" strokeWidth="1.5" opacity="0.85" />
        {/* Head */}
        <circle cx="24" cy="22" r="9.2" fill={st.skin_hex} />
        {/* Facial detail */}
        <circle cx="20.8" cy="21" r="1.1" fill="#1e293b" />
        <circle cx="27.2" cy="21" r="1.1" fill="#1e293b" />
        {st.beard ? (
          <path d="M 16.5 24 Q 24 34 31.5 24 Q 28 31 24 32 Q 20 31 16.5 24 Z" fill="#27272a" opacity="0.88" />
        ) : (
          <path d="M 21.5 26 Q 24 27.5 26.5 26" fill="none" stroke="#9a3412" strokeWidth="1.1" />
        )}
        {/* Period headgear */}
        {st.crown_type === "turban" && (
          <path d="M 13 18 C 13 10 35 10 35 18 Q 24 14 13 18 Z" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
        )}
        {st.crown_type === "crown" && (
          <path d="M 15 16 L 16 9 L 21 13 L 24 7 L 27 13 L 32 9 L 33 16 Z" fill="#fbbf24" stroke="#b45309" strokeWidth="1" />
        )}
        {st.crown_type === "helmet" && (
          <path d="M 14 19 C 14 10 34 10 34 19 L 36 22 L 32 22 L 32 17 L 16 17 L 16 22 L 12 22 Z" fill="#94a3b8" stroke="#334155" strokeWidth="1" />
        )}
        {st.crown_type === "hat" && (
          <>
            <path d="M 16 16 L 18 9 H 30 L 32 16 Z" fill="#1e293b" />
            <ellipse cx="24" cy="16.5" rx="12" ry="2.2" fill="#0f172a" />
          </>
        )}
      </g>

      {props.variant === "crest_shield" ? (
        <path
          d="M 4 4 H 44 V 30 C 44 43 24 52 24 52 C 24 52 4 43 4 30 Z"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="2.4"
        />
      ) : (
        <circle cx="24" cy="24" r="21" fill="none" stroke="#fbbf24" strokeWidth="2.4" />
      )}
    </svg>
  );
}
