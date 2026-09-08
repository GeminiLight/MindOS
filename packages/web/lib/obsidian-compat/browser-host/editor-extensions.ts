import { Compartment, StateEffect, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type Registration = { compartment: Compartment; extensions: Extension[] };

/** Real CM6 extensions. This is lifecycle management, NOT a code isolation boundary. */
export class EditorExtensionRegistry {
  private owners = new Map<string, Registration>();
  private editors = new Map<EditorView, Compartment>();
  private destroyed = false;

  register(owner: string, extension: Extension): void {
    this.assertActive();
    if (!owner.trim()) throw new Error('An extension owner is required.');
    const previous = this.owners.get(owner);
    const candidate = new Map(this.owners);
    candidate.set(owner, {
      compartment: previous?.compartment ?? new Compartment(),
      // Preserve nested mutable arrays: Obsidian plugins refresh them with updateOptions().
      extensions: [...(previous?.extensions ?? []), extension],
    });
    this.apply(candidate);
    this.owners = candidate;
  }

  attach(view: EditorView): () => void {
    this.assertActive();
    if (this.editors.has(view)) throw new Error('Editor is already attached.');
    const root = new Compartment();
    view.dispatch({ effects: StateEffect.appendConfig.of(root.of(this.configuration(this.owners))) });
    this.editors.set(view, root);
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      if (this.editors.get(view) !== root) return;
      view.dispatch({ effects: root.reconfigure([]) });
      this.editors.delete(view);
    };
  }

  remove(owner: string): void {
    this.assertActive();
    if (!this.owners.has(owner)) return;
    const candidate = new Map(this.owners);
    candidate.delete(owner);
    this.apply(candidate);
    this.owners = candidate;
  }

  refresh(): void { this.assertActive(); this.apply(this.owners); }

  destroy(): void {
    if (this.destroyed) return;
    this.apply(new Map());
    this.editors.clear();
    this.owners.clear();
    this.destroyed = true;
  }

  private configuration(owners: Map<string, Registration>): Extension {
    return Array.from(owners.values(), owner => owner.compartment.of(owner.extensions));
  }

  private apply(owners: Map<string, Registration>): void {
    const configuration = this.configuration(owners);
    // Materialize every resulting state before changing any view. An invalid extension
    // (or a StateField.create failure in one document) must not leave a half-mounted owner.
    const updates = Array.from(this.editors, ([view, root]) => {
      const transaction = view.state.update({ effects: [
        root.reconfigure(configuration),
        ...Array.from(owners.values(), owner => owner.compartment.reconfigure(owner.extensions)),
      ] });
      void transaction.state;
      return { view, transaction };
    });
    for (const { view, transaction } of updates) view.dispatch(transaction);
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error('Editor extension registry is destroyed.');
  }
}
