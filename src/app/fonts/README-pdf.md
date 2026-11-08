# Quotation PDF font

`IBMPlexSansArabic-Regular.ttf` is the uncompressed TrueType version of the
existing `IBMPlexSansArabic-Regular.woff2`, converted using fontTools 4.66.0
(`TTFont`, set `flavor = None`, then `save`). Glyph outlines, names and Unicode
coverage are unchanged. The existing `IBMPlexSansArabic-OFL.txt` license applies.

The PDF renderer uses this native font file explicitly for Arabic and Latin
text. This avoids relying on system fallback fonts that are available on a
developer's workstation but absent in the production runtime. Both PDF preview
and WhatsApp attachment routes include it in their Next.js output file traces.
