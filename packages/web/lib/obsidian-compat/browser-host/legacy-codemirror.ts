import { assertIsolatedPluginRealm } from './realm';

/*! CodeMirror 5.65.21 — MIT License

Copyright (C) 2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

/** Load the real CM5 runtime only after the caller has verified the disposable realm.
 * Lazy CommonJS imports keep DOM-dependent CM5 initialization out of server imports.
 * The live MindOS editor remains CM6; original plugins may register CM5 syntax modes.
 */
export function installLegacyCodeMirror(): void {
  assertIsolatedPluginRealm();
  // These literal requires are bundled locally, never resolved from plugin code or the network.
  const CodeMirror = require('codemirror5');
  require('codemirror5/mode/javascript/javascript');
  require('codemirror5/addon/runmode/runmode');
  Object.assign(window, { CodeMirror });
}
