# Third-Party Notices

The root GPLv3 license covers HDS-derived program code, not a blanket
relicensing of every photograph, font or vendored component in this repository.

| Component | Version / Origin | Notices |
| --- | --- | --- |
| HDS firmware reference | decentespresso/openscale, `6f2ac69`, 3.1.16 | [GPLv3](LICENSE) |
| U8g2 | 2.36.18 | [U8g2 notice](licenses/U8g2-LICENSE), source in `vendor/U8g2/` |
| ArduinoJson | 7.4.3 | [MIT notice](licenses/ArduinoJson-LICENSE), source in `vendor/ArduinoJson/` |
| ws | 8.22.2 | [MIT notice](licenses/ws-LICENSE); installed from the pinned lockfile |
| Lucide | 1.8.0 | [ISC notice](licenses/Lucide-LICENSE) |
| Node.js in standalone packages | 22.23.3 | [Complete runtime notice](licenses/Node.js-LICENSE) |
| Emscripten-generated runtime | 3.1.74 | [Compiler/runtime notice](licenses/Emscripten-LICENSE) |
| OLED fonts | U8g2 distributions | [Per-font copyright statements](licenses/Font-copyright-notices.txt) and font notices below |

## Photograph

The Decent Espresso scale photograph was supplied for this simulator. Public
publication was requested by a collaborator who identified themselves as
working for Decent Espresso. Photograph rights remain with their owner; the
program's GPL license does not grant unrelated reuse rights for that image.

## Fonts

Fixed bitmap fonts identify themselves as public domain. Helvetica carries
the Adobe/DEC notice, FreeUniversal carries OFL terms, and Lucida carries
Sun/AT&T/Bigelow & Holmes notices. See [FreeUniversal](licenses/FreeUniversal.md),
[Lucida](licenses/Lucida.md), [OFL](licenses/OFL-1.1.txt) and
[U8g2](licenses/U8g2-LICENSE).

Logisoso has conflicting upstream license descriptions. FontLibrary labels it
OFL, while the original publisher's COPYING file specifies GPLv2 with a font
exception for embedding in documents. The latter does not state "or later."
We do not claim that including notices resolves the discrepancy or establishes
GPLv3 compatibility for every use.

- [Packaged Logisoso notice and both descriptions](licenses/Logisoso.md)
- [Original publisher's COPYING file](https://osp.kitchen/foundry/logisoso/tree/master/COPYING.txt)
- [FontLibrary listing](https://fontlibrary.org/en/font/logisoso)
- [GPLv2 text](licenses/GPL-2.0.txt)

All supplied notices are preserved. Fonts are not relicensed here. The full
vendored U8g2 font catalogue also retains its generated per-font headers;
the simulator uses the subset listed in `Font-copyright-notices.txt`.
