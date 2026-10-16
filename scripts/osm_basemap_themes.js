/* London Map basemap colours. MapLibre paint-only themes: never call map.setStyle().
 * Capture Liberty base layer IDs and native fill-pattern / outline paints
 * BEFORE project analysis layers are added. Dark Tech neutralises colourful
 * Liberty sprite textures, and Planning restores their exact originals.
 * DEM/EA/flood/tensor/parcel layers remain untouched. */
export const BASEMAP_THEMES=Object.freeze({
  planning:Object.freeze({
    id:'planning',name:'建筑规划',
    background:'#f7f8f6',land:'#f1f3f1',residential:'#f2f3f2',
    park:'#e3ece4',water:'#dcecf2',
    building:'#bbc5cb',buildingEdge:'#85929a',
    motorway:'#d0d7d9',primaryRoad:'#dce2e3',road:'#e7ebea',
    rail:'#a3abb1',boundary:'#aeb9bb',
    text:'#65727b',textHalo:'#f7f8f6',poi:'#748a91'
  }),
  dark:Object.freeze({
    id:'dark',name:'黑色科技',
    background:'#161616',land:'#1f1f1f',residential:'#242424',
    park:'#202020',water:'#0f0f10',
    building:'#2b2f33',buildingEdge:'#3b4045',
    motorway:'#6e7378',primaryRoad:'#62676c',road:'#555a5f',
    rail:'#4a4f54',boundary:'#34383c',
    text:'#9a9a9a',textHalo:'#161616',poi:'#8a8a8a'
  })
});
export const normaliseBasemapTheme=value=>
  value==='dark'?'dark':'planning';

function colorFor(layer,palette){
  const id=String(layer.id||'').toLowerCase();
  const src=String(layer['source-layer']||'').toLowerCase();
  const label=id+' '+src;
  const has=pattern=>pattern.test(label);
  if(layer.type==='background')return {'background-color':palette.background};
  if(layer.type==='fill'||layer.type==='fill-extrusion'){
    const isBuilding=has(/buildings?|house|structure/);
    const color=isBuilding?palette.building:
      has(/water|river|lake|basin|dock|stream|canal/)?palette.water:
      has(/park|garden|forest|wood|grass|green|landcover|cemetery|meadow|allotment|farmland|vegetation/)?palette.park:
      has(/motorway|trunk|expressway|highway/)?palette.motorway:
      has(/primary|secondary|major|arterial|bridge/)?palette.primaryRoad:
      has(/road|street|transportation|tunnel|pedestrian|path|aeroway|airport/)?palette.road:
      has(/residential|commercial|industrial|landuse|construction/)?palette.residential:
      palette.land;
    const prop=layer.type==='fill-extrusion'?'fill-extrusion-color':'fill-color';
    const props={[prop]:color};
    if(isBuilding&&layer.type==='fill')props['fill-outline-color']=palette.buildingEdge;
    return props;
  }
  if(layer.type==='line'){
    const c=has(/water|river|stream|canal/)?palette.water:
      has(/rail|transit|subway|metro/)?palette.rail:
      has(/admin|boundary|border/)?palette.boundary:
      has(/motorway|trunk|expressway/)?palette.motorway:
      has(/primary|secondary|major|arterial|bridge/)?palette.primaryRoad:
      has(/road|street|path|pedestrian|transportation|tunnel/)?palette.road:
      has(/building/)?palette.buildingEdge:
      palette.boundary;
    return {'line-color':c};
  }
  if(layer.type==='circle'){
    return {'circle-color':has(/poi|place|station|transit/)?palette.poi:palette.rail};
  }
  if(layer.type==='symbol'){
    return {'text-color':palette.text,
      'text-halo-color':palette.textHalo,
      'text-halo-width':1.2};
  }
  return {}; // Raster terrain/EA layers are always managed by their own controls.
}

/** All captured layer IDs are from the ORIGINAL OpenFreeMap style. */
export function createBasemapThemeController(map){
  const baseLayers=new Map();
  const applied=new Map();
  let active='planning',captured=false;
  function capture(){
    if(captured)return;
    const style=map.getStyle?.();
    if(!style?.layers?.length)return;
    for(const layer of style.layers){
      if(!layer?.id)continue;
      const originalPaint=layer.paint||{};
      const hasFillPattern=layer.type==='fill'&&
        Object.prototype.hasOwnProperty.call(originalPaint,'fill-pattern');
      const originalFillPattern=hasFillPattern?
        structuredClone(originalPaint['fill-pattern']):null;
      // Liberty's 'park' layer contains a BRIGHT GREEN outline unrelated to
      // its fill color; it must be reset when using a monochrome palette.
      const hasFillOutline=layer.type==='fill'&&
        Object.prototype.hasOwnProperty.call(originalPaint,'fill-outline-color');
      const originalFillOutline=hasFillOutline?
        structuredClone(originalPaint['fill-outline-color']):null;
      baseLayers.set(layer.id,{
        id:layer.id,type:layer.type,'source-layer':layer['source-layer']||'',
        hasFillPattern,originalFillPattern,hasFillOutline,originalFillOutline
      });
    }
    captured=true;
  }
  function apply(mode='planning'){
    capture();
    active=normaliseBasemapTheme(mode);
    if(!captured)return false;
    const palette=BASEMAP_THEMES[active];
    for(const layer of baseLayers.values()){
      if(!map.getLayer?.(layer.id))continue;
      const paint=colorFor(layer,palette);
      if(layer.type==='fill'){
        // A fill-pattern sprite OVERRIDES fill-color. The Liberty style uses
        // wetland_bg_11 and pedestrian_polygon, and the wetland sprite contains
        // bright coloured reeds. Dark mode suppresses these original *basemap*
        // patterns; Planning mode restores each exact expression/string.
        if(layer.hasFillPattern)
          paint['fill-pattern']=active==='dark'?null:layer.originalFillPattern;
        // Green park outlines stay green even after fill-color is overridden.
        // Building outlines already follow the palette in colorFor(), while
        // other original outlines must be neutral in Dark and exact in Planning.
        if(layer.hasFillOutline&&!/buildings?|house|structure/i.test(
          layer.id+' '+layer['source-layer'])){
          paint['fill-outline-color']=active==='dark'?
            (/park|garden|forest|wood|grass|green|landcover|wetland|cemetery|meadow/i
              .test(layer.id+' '+layer['source-layer'])?palette.park:palette.boundary):
            layer.originalFillOutline;
        }
      }
      for(const [key,value] of Object.entries(paint)){
        const identity=layer.id+'|'+key;
        if(applied.get(identity)===value)continue;
        try{
          // null removes MapLibre's sprite pattern paint property; no source,
          // layer, filter or underlying OSM feature is deleted.
          map.setPaintProperty(layer.id,key,value);
          applied.set(identity,value);
        }catch(error){
          // A rare style-specific layer may reject a generic property. Preserve
          // its existing geometry and continue with the remaining base layers.
          console.warn('Basemap colour not supported:',layer.id,key,error);
        }
      }
    }
    return true;
  }
  return {capture,apply,isBaseLayer:id=>baseLayers.has(id),
    getMode:()=>active,getCapturedCount:()=>baseLayers.size};
}
