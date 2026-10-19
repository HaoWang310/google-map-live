/* Presentation-only English UI. Keeps calculation code, stored values, option
   identifiers, input values and geographic source data in their original form. */
import {ENGLISH_UI} from './ui_english_dictionary.js?v=3.29.4-english';
const HAN=/[\u3400-\u9fff]/;
const RUNS=/[\u3400-\u9fff]+/g;
const attributes=['title','aria-label','aria-description','aria-valuetext','alt','placeholder'];
const cache=new Map();
const keys=Object.keys(ENGLISH_UI).sort((a,b)=>b.length-a.length);
const fallback=new RegExp(keys.join('|'),'g');
export function translateUI(value){
 if(typeof value!=='string'||!HAN.test(value))return value;
 if(cache.has(value))return cache.get(value);
 const translated=value
  .replace(RUNS,run=>{
   if(Object.hasOwn(ENGLISH_UI,run))return ' '+ENGLISH_UI[run]+' ';
   return run.replace(fallback,key=>' '+ENGLISH_UI[key]+' ');
  })
  .replace(/[。]/g,'. ').replace(/[，、]/g,', ').replace(/[：]/g,': ')
  .replace(/[；]/g,'; ').replace(/[！]/g,'! ').replace(/[？]/g,'? ')
  .replace(/[（]/g,' (').replace(/[）]/g,') ')
  .replace(/[「『【]/g,'[').replace(/[」』】]/g,']')
  .replace(/(\d{4})\s+year\b/g,'$1')
  .replace(/[ \t]+/g,' ').replace(/ +([,.;:!?\)\]])/g,'$1')
  .replace(/([\(\[]) +/g,'$1').trim();
 if(cache.size>=2048)cache.clear();cache.set(value,translated);
 return translated;
}
function excluded(node){
 const element=node.nodeType===1?node:node.parentElement;
 return !element||Boolean(element.closest('script,style,noscript,textarea,[contenteditable]:not([contenteditable="false"]),[data-no-translate]'));
}
export function translateTextNode(node){
 if(node?.nodeType!==3||excluded(node))return;
 const original=node.nodeValue,translated=translateUI(original);
 if(original!==translated){
  // Chinese did not require spaces around inline icons, numbers or <kbd>
  // elements; English does. Preserve separation without replacing elements.
  const before=/^\s/.test(original)||node.previousSibling?' ':'';
  const after=/\s$/.test(original)||node.nextSibling?' ':'';
  node.nodeValue=before+translated+after;
 }
}
function translateAttributes(element){
 if(excluded(element))return;
 // Explicit option values must never change. Preserve implicit option values
 // too, before translating the visible label of a newly introduced option.
 if(element.tagName==='OPTION'&&!element.hasAttribute('value'))
  element.setAttribute('value',element.textContent);
 for(const attribute of attributes){
  const original=element.getAttribute(attribute);
  if(original){const translated=translateUI(original);if(original!==translated)element.setAttribute(attribute,translated);}
 }
}
export function translateSubtree(root,documentObject=globalThis.document){
 if(!root||!documentObject)return;
 if(root.nodeType===3){translateTextNode(root);return;}
 if(root.nodeType===1)translateAttributes(root);
 const elements=documentObject.createTreeWalker(root,1);
 while(elements.nextNode())translateAttributes(elements.currentNode);
 const texts=documentObject.createTreeWalker(root,4);
 while(texts.nextNode())translateTextNode(texts.currentNode);
}
export function startEnglishUI(documentObject=globalThis.document,windowObject=globalThis.window){
 if(!documentObject?.documentElement||!windowObject)return null;
 documentObject.documentElement.lang='en';
 translateSubtree(documentObject.body,documentObject);
 const observer=new windowObject.MutationObserver(records=>{
  const added=new Set();
  for(const record of records){
   if(record.type==='characterData')translateTextNode(record.target);
   else if(record.type==='attributes')translateAttributes(record.target);
   else for(const node of record.addedNodes)added.add(node);
  }
  // Each added subtree is visited once. WebGL/canvas frames and numerical
  // solver updates are not observed, read, patched or scheduled here.
  for(const node of added)if(!added.has(node.parentNode))translateSubtree(node,documentObject);
 });
 observer.observe(documentObject.body,{subtree:true,childList:true,characterData:true,
  attributes:true,attributeFilter:attributes});
 for(const name of ['alert','confirm','prompt'])if(typeof windowObject[name]==='function'){
  const original=windowObject[name].bind(windowObject);
  windowObject[name]=(message,...args)=>original(translateUI(message),...args);
 }
 return observer;
}
if(typeof document!=='undefined'&&typeof window!=='undefined'){
 const start=()=>startEnglishUI(document,window);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
}
