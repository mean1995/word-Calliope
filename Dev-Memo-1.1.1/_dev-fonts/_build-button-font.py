#!/usr/bin/env python3
"""1.1.1 stage-08: build the approved Primary-Control button font (dev-only build script).

Source   : Doto[ROND,wght].ttf  (upstream variable font, SIL OFL 1.1, no Reserved Font Name)
Setting  : ROND = 100 (round dots), wght = 400         <- product-side choice, 2026-10-06
Subset   : A-Z a-z 0-9 SPACE - %  (65 code points; widened 2026-10-16 for the PgUp / PgDn
                                     labels of the two new Primary Controls)
Rename   : family "KalliopeButton" (OFL allows modification; the original family name is not used)
Output   : ../../assets/fonts/font-button.woff2

Source material stays in this directory and is never distributed with the product.
Usage: python3 _build-button-font.py [/tmp/Doto-VF.ttf]
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/Doto-VF.ttf"
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "assets", "fonts", "font-button.woff2"))
CHARSET = "".join(chr(c) for c in list(range(0x41, 0x5B)) + list(range(0x61, 0x7B))
                  + list(range(0x30, 0x3A))) + " -%"
FAMILY = "KalliopeButton"
PSNAME = "KalliopeButton-Regular"

if not os.path.exists(SRC):
    sys.exit("source variable font not found: " + SRC)

inst = instancer.instantiateVariableFont(TTFont(SRC), {"ROND": 100, "wght": 400},
                                         inplace=False, updateFontNames=False)

opts = subset.Options()
opts.layout_features = ["*"]
opts.notdef_outline = True
opts.drop_tables += ["STAT", "DSIG", "meta"]
sub = subset.Subsetter(options=opts)
sub.populate(text=CHARSET)
sub.subset(inst)

# rename: family / unique id / full name / postscript name / typographic names.
# nameID 0 (copyright) and 13/14 (licence description / URL) are left untouched.
name = inst["name"]
for nid, value in ((1, FAMILY), (3, FAMILY + ";1.000;KalliopeButton"), (4, FAMILY + " Regular"),
                   (6, PSNAME), (16, FAMILY), (17, "Regular")):
    for rec in list(name.names):
        if rec.nameID == nid:
            name.names.remove(rec)
    name.setName(value, nid, 3, 1, 0x409)
    name.setName(value, nid, 1, 0, 0)

inst.flavor = "woff2"
inst.save(OUT)
print(f"wrote {OUT}")
print(f"  family   : {inst['name'].getDebugName(1)}")
print(f"  psname   : {inst['name'].getDebugName(6)}")
print(f"  copyright: {(inst['name'].getDebugName(0) or '')[:60]}")
print(f"  size     : {os.path.getsize(OUT)} bytes")
print(f"  cmap     : {len(inst.getBestCmap())} code points")
