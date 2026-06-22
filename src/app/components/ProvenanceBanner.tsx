interface Props {
  sourceUrl: string;
  title: string | null;
  onClose: () => void;
}

export function ProvenanceBanner({ sourceUrl, title, onClose }: Props) {
  let displayText: string;
  try {
    displayText = title || new URL(sourceUrl).hostname;
  } catch {
    displayText = title || sourceUrl;
  }

  return (
    <div className="provenance-banner">
      <a
        className="provenance-banner__link"
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="provenance-banner__icon" aria-hidden="true">
          📖
        </span>
        <span className="provenance-banner__prefix">Из книги:&nbsp;</span>
        <span className="provenance-banner__title">{displayText}</span>
        <span className="provenance-banner__arrow" aria-hidden="true">
          ↗
        </span>
      </a>
      <button
        className="provenance-banner__close"
        type="button"
        aria-label="Закрыть баннер источника"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
