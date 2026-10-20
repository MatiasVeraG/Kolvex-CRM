// Logo de Kolvex. Usa el color del texto (currentColor), así funciona en modo claro y oscuro.
export default function Logo({ size = 24, title = 'Kolvex' }) {
  return (
    <svg className="logo" viewBox="0 0 784 905" height={size} width={(size * 784) / 905} fill="currentColor" role="img" aria-label={title}>
      <path d="M0 0 274 2 0 367Z" />
      <path d="M1 538 274 903H0Z" />
      <path d="M442 0H784L534 333 459 231 276 228Z" />
      <path d="M276 677 459 673 534 572 784 905H442Z" />
      <path d="M276 228 436 453 276 677 105 453Z" />
    </svg>
  );
}
