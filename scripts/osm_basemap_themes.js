/* London Map basemap colours. MapLibre paint-only themes: never call map.setStyle().
 * Capture Liberty base layer IDs before project-specific analysis layers exist,
 * so DEM/EA/hydrology, parcel shapes, traffic and interactive tools stay intact.
 * 03 Architectural Planning is the default. 02 Dark Tech is opt-in. */
export const BASEMAP_THEMES=Object.freeze({
  planning:Object.freeze({
    id:'planning',name:'03 · 建筑规划风格',
    background:'#f7f8f6',land:'#f1f3f1',residential:'#f2f3f2',
    park:'#e3ece4',water:'#dcecf2',
    building:'#bbc5cb',buildingEdge:'#85929a',
    motorway:'#d0d7d9',primaryRoad:'#dce2e3',road:'#e7ebea',
    rail:'#a3abb1',boundary:'#aeb9bb',
    text:'#65727b',textHalo:'#f7f8f6',poi:'#748a91'
  }),
  dark:Object.freeze({
    id:'dark',name:'02 · 黑色科技风格',
    background:'#071018',land:'#0d1924',residential:'#142230',
    park:'#143135',water:'#0e334b',
    building:'#30485c',buildingEdge:'#476a81',
    motorway:'#4b7895',primaryRoad:'#355a73',road:'#243f53',
    rail:'#4b6980',boundary:'#41637a',
    text:'#a4c3d2',textHalo:'#071018',poi:'#85b4ce'
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
      baseLayers.set(layer.id,{
        id:layer.id,type:layer.type,'source-layer':layer['source-layer']||''
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
      for(const [key,value] of Object.entries(paint)){
        const identity=layer.id+'|'+key;
        if(applied.get(identity)===value)continue;
        try{
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
