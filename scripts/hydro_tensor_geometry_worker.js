// Static geometry runs off the UI thread; the validated tensor worker is untouched.
import {buildTensorGeometryPacket} from './hydro_tensor_geometry.js?v=3.29.0-global-warp';
self.onmessage=({data})=>{
  if(data?.type!=='build-geometry')return;
  try{
    const packet=buildTensorGeometryPacket(data.result,data.options);
    self.postMessage({type:'geometry-result',id:data.id,packet},[packet.coordinates.buffer]);
  }catch(error){self.postMessage({type:'geometry-error',id:data.id,message:error?.message||String(error)})}
};

