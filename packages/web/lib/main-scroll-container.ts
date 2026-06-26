export const MAIN_SCROLL_CONTAINER_ID = 'main-content';

export interface MainScrollPosition {
  x: number;
  y: number;
}

function documentScrollPosition(): MainScrollPosition {
  return {
    x: window.scrollX || window.document.documentElement.scrollLeft || window.document.body.scrollLeft || 0,
    y: window.scrollY || window.document.documentElement.scrollTop || window.document.body.scrollTop || 0,
  };
}

export function getMainScrollContainer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(MAIN_SCROLL_CONTAINER_ID);
}

export function getMainScrollPosition(): MainScrollPosition {
  const container = getMainScrollContainer();
  if (!container) return documentScrollPosition();
  return {
    x: container.scrollLeft,
    y: container.scrollTop,
  };
}

export function scrollMainTo(x: number, y: number): void;
export function scrollMainTo(options: ScrollToOptions): void;
export function scrollMainTo(xOrOptions: number | ScrollToOptions, y?: number): void {
  const container = getMainScrollContainer();
  if (!container) {
    if (typeof xOrOptions === 'number') {
      window.scrollTo(xOrOptions, y ?? 0);
      return;
    }
    window.scrollTo(xOrOptions);
    return;
  }

  if (typeof xOrOptions === 'number') {
    container.scrollTo(xOrOptions, y ?? 0);
    return;
  }
  container.scrollTo(xOrOptions);
}

export function getMainScrollRelativeTop(element: HTMLElement): number {
  const container = getMainScrollContainer();
  const elementTop = element.getBoundingClientRect().top;
  if (!container) {
    return elementTop + (window.scrollY || window.document.documentElement.scrollTop || window.document.body.scrollTop || 0);
  }
  const containerTop = container.getBoundingClientRect().top;
  return container.scrollTop + elementTop - containerTop;
}
