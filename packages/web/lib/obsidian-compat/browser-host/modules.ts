import * as state from '@codemirror/state';
import * as view from '@codemirror/view';
import * as language from '@codemirror/language';
import * as commands from '@codemirror/commands';
import * as autocomplete from '@codemirror/autocomplete';
import * as search from '@codemirror/search';
import * as lint from '@codemirror/lint';
import * as common from '@lezer/common';
import * as highlight from '@lezer/highlight';
import * as lr from '@lezer/lr';
import type { ObsidianBrowserModule } from '../runtime-plan';
/** Import from the host graph so extensions share EditorState/Facet identities. */
export function createBrowserModuleRegistry(obsidian: Record<string, unknown>) {
  return Object.freeze({ obsidian, '@codemirror/state': state, '@codemirror/view': view,
    '@codemirror/language': language, '@codemirror/commands': commands,
    '@codemirror/autocomplete': autocomplete, '@codemirror/search': search, '@codemirror/lint': lint,
    '@lezer/common': common, '@lezer/highlight': highlight, '@lezer/lr': lr,
  } satisfies Record<ObsidianBrowserModule, unknown>);
}
