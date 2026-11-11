# Source And Licenses

This local-use bundle includes the HDS GPLv3 license, unminified simulator and
server JavaScript in `app/`, and matching firmware/renderer code in `sources/`.
`package-manifest.json` records file hashes and the pinned renderer revision.

The renderer uses U8g2 2.36.18 and ArduinoJson 7.4.3. Their source and licenses
are under `sources/vendor/` and `licenses/`. `firmware/tools/build_hds_simulator.py`
records the compiler flags and generation steps. Developer rebuilds require
Python, a Git checkout with the recorded source, and Emscripten 3.1.74; none is
required to use the prebuilt package. No SDK or compiler cache is included.

`licenses/` also includes the complete Node.js 22.23.3 notice (including its
bundled components), ws and Lucide licenses, Emscripten's license, and the
relevant font notices. Fixed bitmap fonts identify themselves as public domain.
Helvetica uses the Adobe/DEC notice, FreeUniversal uses OFL, and Lucida carries
the Sun/AT&T/Bigelow & Holmes notice.

Before publishing this bundle, review the photograph's redistribution rights
and the Logisoso font terms. U8g2's upstream page lists OFL but also reproduces
the original GPLv2-with-font-exception notice. Both notices and the OFL/GPLv2
texts accompany this package. This local packaging task does not resolve that
licensing ambiguity or claim approval for external publication.
