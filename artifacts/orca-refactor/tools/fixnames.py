import os,re,sys,glob
root=sys.argv[1]
for f in glob.glob(root+"/mods/*/*-test.js"):
    os.rename(f, f[:-len("-test.js")]+".test.js")
for f in glob.glob(root+"/mods/*/*.test.js")+glob.glob(root+"/mods/*/*.mjs"):
    s=open(f).read(); o=s
    # drop the sentence explaining the -test.js workaround (it may wrap onto the next comment line)
    s=re.sub(r"(?:\n// |\s)?(?:The file is n|N)amed `-test\.js`, not\s*(?://\s*)?`\.test\.js`,? so the (?:manifest's|manifest) test list(?: \(orca-ui/app\.mjs\))? stays unchanged\.", "", s)
    s=s.replace("-test.js","-test.js") if False else s
    if s!=o: open(f,"w").write(s)
