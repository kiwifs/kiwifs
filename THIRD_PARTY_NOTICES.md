# Third-party notices

KiwiFS is licensed under the Business Source License 1.1 (see `LICENSE`). The
binary also contains the third-party software below, used unmodified under its
own license. Each license text ships with the module's source at the URL given.

## D2 diagram renderer

Linked into `internal/d2render` and left out of builds made with `-tags nod2`.

| Component | License | Source |
|---|---|---|
| D2 (`github.com/d2lang/d2`) | Mozilla Public License 2.0 | https://github.com/terrastruct/d2 |
| elk-go (`github.com/d2lang/elk-go`) | Eclipse Public License 2.0 | https://github.com/d2lang/elk-go |
| dagro (`github.com/d2lang/dagro`) | MIT | https://github.com/d2lang/dagro |
| rough-go (`github.com/d2lang/rough-go`) | MIT | https://github.com/d2lang/rough-go |
| mathjax-go (`github.com/d2lang/mathjax-go`) | Apache License 2.0 | https://github.com/d2lang/mathjax-go |
| util-go (`github.com/d2lang/util-go`) | ISC-style (Terrastruct) | https://github.com/d2lang/util-go |
| go-text/typesetting | Unlicense or BSD-3-Clause | https://github.com/go-text/typesetting |
| chroma | MIT | https://github.com/alecthomas/chroma |
| goquery | BSD-3-Clause | https://github.com/PuerkitoBio/goquery |
| regexp2 | MIT | https://github.com/dlclark/regexp2 |
| go-colorful | MIT | https://github.com/lucasb-eyer/go-colorful |
| csscolorparser | MIT | https://github.com/mazznoer/csscolorparser |
| uniseg | MIT | https://github.com/rivo/uniseg |

The MPL-2.0 and EPL-2.0 components are distributed in object form inside the
KiwiFS binary; their complete corresponding source is available at the URLs
above, at the versions pinned in `go.mod`.

### Fonts embedded by D2

Source Sans Pro, Source Code Pro, Fuzzy Bubbles and Noto Color Emoji (v2.051)
are licensed under the SIL Open Font License 1.1
(https://openfontlicense.org). Diagrams rendered with them are not subject to
the font license.

## Editor code adapted from other projects

The live preview editor (`ui/src/components/editor/livePreview/`) contains
code adapted, with changes, from the projects below. Each adapted file names
its source in a header comment.

| File | Adapted from | License |
|---|---|---|
| `ios.ts` | SilverBullet `client/codemirror/editing/ios_enter.ts`, `ios_completion.ts` | MIT |
| `tasks.ts` | SilverBullet `client/codemirror/syntax/task.ts` | MIT |
| `hideMarks.ts` | SilverBullet `client/codemirror/syntax/hide_mark.ts`, itself forked from Ixora | MIT; Apache License 2.0 |

SilverBullet (https://github.com/silverbulletmd/silverbullet):

> Copyright 2022, Zef Hemel
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to
> deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
> sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
> FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
> IN THE SOFTWARE.

Ixora (https://codeberg.org/retronav/ixora), by Pranav Karawale, is licensed
under the Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0).
The hide-marks logic was rewritten for KiwiFS's syntax tree walk and reveal
rules.

The editor also depends, unmodified, on `@replit/codemirror-vim` (MIT) and on
BlockNote (`@blocknote/*`, Mozilla Public License 2.0), whose source is at
https://github.com/TypeCellOS/BlockNote.
