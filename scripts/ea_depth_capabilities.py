"""Discover authoritative EA planning surface-water depth WMS layers.

Does not invent return periods, depth thresholds, or represent WMS imagery as
hydrodynamic output. Saves capabilities to a versioned manifest to audit.
"""
import json
import os
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

SOURCES = {
    "present": "https://environment.data.gov.uk/spatialdata/fmfp-surface-water-depths/wms",
    "climate_2070_upper": "https://environment.data.gov.uk/spatialdata/fmfp-surface-water-climate-change-depths/wms",
}
OUT = Path(__file__).resolve().parents[1]/"assets/flood_risk/ea_depth_wms_capabilities.json"
def fetch(url, query):
    req=urllib.request.Request(url+"?"+urlencode(query),headers={"User-Agent":"LondonMapEAResearch/3.22.27"})
    with urllib.request.urlopen(req,timeout=55) as response:
        return response.read()
def local(tag):
    return tag.rsplit("}",1)[-1]
def text_direct(node, field):
    return next((child.text.strip() for child in node if local(child.tag)==field and child.text),"")
def names(node):
    out=[]
    if local(node.tag)=="Layer":
        nm=text_direct(node,"Name")
        title=text_direct(node,"Title")
        styles=[]
        for el in node:
            if local(el.tag)=="Style":
                styles.append({"name":text_direct(el,"Name"),"title":text_direct(el,"Title")})
        if nm:out.append({"name":nm,"title":title,"styles":styles})
    for el in node:out.extend(names(el))
    return out

manifest={"generated_utc":datetime.now(timezone.utc).isoformat(),"agency":"Environment Agency",
    "aep_official_percent":[3.3,1.0,0.1],
    "year_climate_note":"2070s Upper End (2061–2125) not an annual 2100 forecast",
    "sources":{}}
for key,url in SOURCES.items():
    body=fetch(url,{"SERVICE":"WMS","REQUEST":"GetCapabilities","VERSION":"1.3.0"})
    root=ET.fromstring(body)
    layers=names(root)
    if not layers:raise RuntimeError("EA WMS did not disclose named layers for "+key)
    for item in layers:
        # Record official SLD legend and underlying polygon depth filters.
        # The build must validate these values before decoding a single pixel.
        body_style=fetch(url,{"SERVICE":"WMS","REQUEST":"GetStyles",
                              "VERSION":"1.1.1","LAYERS":item["name"]})
        styled=ET.fromstring(body_style)
        rules=[]
        for node in styled.iter():
            if local(node.tag)!="Rule":continue
            fills=[]
            for fill in node.iter():
                if local(fill.tag) in ("CssParameter","SvgParameter") and fill.attrib.get("name")=="fill":
                    if fill.text:fills.append(fill.text.strip())
            literals=[v.text.strip() for v in node.iter() if local(v.tag)=="Literal" and v.text]
            rules.append({"rule":text_direct(node,"Name"),
                          "title":text_direct(node,"Title"),
                          "literal_filters":literals,"fills":fills})
        item["official_depth_rules"]=rules
        if not rules:raise RuntimeError("Official depth SLD has no rules: "+item["name"])
    manifest["sources"][key]={"url":url,"layer_count":len(layers),"layers":layers}
    print(key,"layers",len(layers),[(x["name"],x["official_depth_rules"]) for x in layers],flush=True)
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
print("Published layer manifest",OUT)
