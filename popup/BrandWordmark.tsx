import { PRODUCT_NAME, wordmarkUrl } from "../src/brand.js";

export function BrandWordmark({
  className = "brand-wordmark",
}: {
  className?: string;
}): React.ReactElement {
  return (
    <img
      src={wordmarkUrl()}
      alt={PRODUCT_NAME}
      className={className}
      height={24}
      width={256}
    />
  );
}

export function PopupHeader({
  children,
}: {
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="popup-header">
      <BrandWordmark />
      {children}
    </header>
  );
}
