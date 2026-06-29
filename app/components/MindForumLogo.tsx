type MindForumLogoProps = {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
  showWord?: boolean;
};

export default function MindForumLogo({
  className = "",
  markClassName = "",
  wordClassName = "",
  showWord = true,
}: MindForumLogoProps) {
  return (
    <span className={`brand-logo ${className}`.trim()} aria-label="MindForum">
      <svg
        className={`brand-logo__mark ${markClassName}`.trim()}
        viewBox="0 0 48 48"
        role="img"
        aria-hidden="true"
        focusable="false"
      >
        <rect width="48" height="48" rx="14" fill="#E84A27" />
        <path d="M8 14c6-7 20-9 32-3" fill="none" stroke="#FF8A5C" strokeWidth="8" strokeLinecap="round" opacity="0.6" />
        <path
          d="M12.5 23.2c0-7 5.8-12.2 13-12.2s13 5.2 13 12.2c0 6.6-5.2 11.8-12.2 12.2l-5.2 4.1c-.9.7-2.2.1-2.2-1v-3.9c-3.9-2-6.4-6.1-6.4-11.4Z"
          fill="none"
          stroke="white"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M26 16.8c-2.2-2.2-6.2-.6-6.2 2.8 0 .6.1 1.1.3 1.6-1.7.8-2.4 3.1-1.3 4.7.8 1.2 2.2 1.7 3.5 1.5.5 2.5 3.7 3.2 5.2 1.2M26 16.8c2.2-2.2 6.2-.6 6.2 2.8 0 .6-.1 1.1-.3 1.6 1.7.8 2.4 3.1 1.3 4.7-.8 1.2-2.2 1.7-3.5 1.5-.5 2.5-3.7 3.2-5.2 1.2M26 16.8v11.8M22.2 22.1H26M26 24.6h4M21.9 26.6c1.2-.1 2.1-.6 2.8-1.5M30.1 19.8c-1.1 0-2 .5-2.7 1.4"
          fill="none"
          stroke="#13294B"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.86"
        />
      </svg>
      {showWord && <span className={`brand-logo__word ${wordClassName}`.trim()}>MindForum</span>}
    </span>
  );
}
