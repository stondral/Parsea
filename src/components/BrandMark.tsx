/** Parsea's code-native brand mark, shared by navigation and account pages. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 34 34"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="1" y="1" width="32" height="32" rx="10" fill="currentColor" opacity=".09" />
      <path
        d="m17 6 3.2 7.8L28 17l-7.8 3.2L17 28l-3.2-7.8L6 17l7.8-3.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="17" cy="17" r="2.3" fill="currentColor" />
    </svg>
  )
}
