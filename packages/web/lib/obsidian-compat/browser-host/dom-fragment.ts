import { createObsidianElement, type ObsidianElement } from '../shims/dom';

export type BrowserFragment = DocumentFragment & Pick<ObsidianElement, 'createEl' | 'createDiv' | 'createSpan'> & {
  appendText(text: string): void;
};

/** Native fragment; reuse the generic child factories, not an HTML string parser.
 * Those factories need only appendChild/createEl, which DocumentFragment supplies.
 */
export function createBrowserFragment(callback?: (fragment: BrowserFragment) => void): BrowserFragment {
  const { createEl, createDiv, createSpan } = createObsidianElement('div');
  const fragment = Object.assign(document.createDocumentFragment(), {
    createEl, createDiv, createSpan,
    appendText(this: DocumentFragment, text: string) { this.appendChild(document.createTextNode(text)); },
  });
  callback?.(fragment); return fragment;
}
