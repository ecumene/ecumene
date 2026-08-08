type TransitionCapableDocument = Document & {
  startViewTransition?: (update: () => void) => {
    finished: Promise<void>;
  };
};

const documentWithTransitions = document as TransitionCapableDocument;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const transitionName = "image-preview-shared";

const findTrigger = (previewId: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-image-preview-trigger]")).find(
    (trigger) => trigger.dataset.imagePreviewTrigger === previewId,
  );

if (documentWithTransitions.startViewTransition && !prefersReducedMotion.matches) {
  document.documentElement.classList.add("has-image-preview-transitions");

  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;

    const link = target.closest<HTMLAnchorElement>(
      'a[href^="#image-preview-"], a[href^="#image-gallery-"]',
    );
    if (!link) return;

    const nextHash = link.hash;
    const isClosing = nextHash === "#image-preview-closed";
    const activePreview = document.querySelector<HTMLElement>(".image-preview:target");
    const activeImage = activePreview?.querySelector<HTMLElement>(".image-preview__image");
    const openingTrigger = link.matches("[data-image-preview-trigger]") ? link : null;
    const openingImage = openingTrigger?.querySelector<HTMLElement>("img");
    const returnTrigger = isClosing && activePreview ? findTrigger(activePreview.id) : undefined;
    const outgoingImage = openingImage ?? activeImage;

    if (!outgoingImage) return;

    event.preventDefault();

    if (openingImage) openingImage.style.viewTransitionName = transitionName;

    const transition = documentWithTransitions.startViewTransition!(() => {
      if (openingImage) openingImage.style.viewTransitionName = "";
      window.location.hash = nextHash;

      if (returnTrigger) {
        const returnImage = returnTrigger.querySelector<HTMLElement>("img");
        if (returnImage) returnImage.style.viewTransitionName = transitionName;
      }
    });

    void transition.finished.finally(() => {
      if (openingImage) openingImage.style.viewTransitionName = "";

      if (returnTrigger) {
        const returnImage = returnTrigger.querySelector<HTMLElement>("img");
        if (returnImage) returnImage.style.viewTransitionName = "";
      }
    });
  });
}
