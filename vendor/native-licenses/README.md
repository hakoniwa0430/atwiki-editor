# Native dependency license material

Scope: Windows x64, sharp 0.35.5, libvips 8.18.7.

- `THIRD-PARTY-NOTICES.md` is copied unmodified from lovell/sharp-libvips tag v1.3.4.
- `GPL-3.0-only.txt`, `LGPL-3.0-only.txt`, `MPL-1.1.txt`, `MPL-2.0.txt`, `MIT.txt`, and `Apache-2.0.txt` are verbatim standard texts from https://github.com/spdx/license-list-data/tree/v3.26.0/text (retrieved 2026-11-11). The filenames identify the text version, not a restriction on upstream's "or later" grants. The SPDX LGPL text includes the GPL terms it incorporates.
- `UPSTREAM-NOTICES.txt` preserves notices extracted from the hash-verified source archives. For crates without separate notice files, package declarations and source/readme headers are included. This is a superset including development and other-platform sources; it does not assert that every component is linked into the DLL.
- `sources.json` records source versions, URLs, SHA-256, and the reviewed native binary hashes. Native source checksums come from the corresponding MXE definitions; Rust checksums come from librsvg's Cargo.lock. Build archive hashes were calculated after retrieval. The libxml2 URL uses its matching 2.15 directory (the upstream recipe's primary URL still says 2.14); the expected source hash is unchanged.
- The original native DLL was compared byte-for-byte by SHA-256 with `vips-dev-x64-web-8.18.7-static.zip` from https://github.com/libvips/build-win64-mxe/releases/tag/v8.18.7.

Full source archives, including original notices, are distributed as the companion source ZIP described in `docs/third-party-licenses.md`. These files supplement, and do not replace, the licenses shipped inside the npm packages.
