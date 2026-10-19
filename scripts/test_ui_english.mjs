import assert from 'node:assert/strict';
import fs from 'node:fs';
import {translateUI,startEnglishUI} from './ui_english.js';
import {ENGLISH_UI} from './ui_english_dictionary.js';
const han=/[\u3400-\u9fff]/;
const root=new URL('../',import.meta.url);
let checked=0;
for(const file of ['index.html',...fs.readdirSync(new URL('./',import.meta.url)).filter(p=>p.endsWith('.js')&&!p.startsWith('ui_english')).map(p=>'scripts/'+p)]){
 const source=fs.readFileSync(new URL(file,root),'utf8');
 for(const run of source.match(/[\u3400-\u9fff]+/g)||[]){
  assert.ok(Object.hasOwn(ENGLISH_UI,run),'Missing English entry: '+run);
  assert.ok(!han.test(translateUI(run)),'Untranslated UI: '+run);checked++;
 }
}
for(const text of ['STEP 04 · 水文张量场','2026年 → 2100年 · 完成','主路 4.73 km · 次路 15.77 km · 支路 90.3 km','已接收 2100 年张量与洪涝数据','调整2026–2100张量生长及粒子移动速度']){
 assert.ok(!han.test(translateUI(text)),text);
}
assert.equal(translateUI('EPSG:27700 · 0.125 km² · 2026–2100'),'EPSG:27700 · 0.125 km² · 2026–2100');
assert.equal(translateUI('Wool tension'),'Wool tension');
assert.equal(translateUI('2026年 → 2100年'),'2026 → 2100');
class Text{
 constructor(value){this.nodeType=3;this.nodeValue=value;this.childNodes=[];}
 get textContent(){return this.nodeValue;}
}
class Element{
 constructor(tag,attrs={},children=[]){this.nodeType=1;this.tagName=tag.toUpperCase();this.attrs={...attrs};this.childNodes=[];for(const child of children)this.append(child);}
 append(node){node.parentElement=this;node.parentNode=this;this.childNodes.push(node);return node;}
 getAttribute(key){return this.attrs[key]??null;}
 hasAttribute(key){return Object.hasOwn(this.attrs,key);}
 setAttribute(key,value){this.attrs[key]=value;}
 get textContent(){return this.childNodes.map(x=>x.textContent).join('');}
 closest(){for(let e=this;e;e=e.parentElement)if(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA'].includes(e.tagName)||e.hasAttribute('data-no-translate')||e.hasAttribute('contenteditable')&&e.getAttribute('contenteditable')!=='false')return e;return null;}
}
const label=new Element('button',{'title':'重新生成 Wool 最终路网'},[new Text('运行')]);
const option=new Element('option',{value:'presentation'},[new Text('演示模式')]);
const implicitOption=new Element('option',{},[new Text('保留')]);
const input=new Element('input',{'placeholder':'搜索地点、地址或邮编','aria-label':'搜索地点'});input.value='伦敦';
const numeric=new Element('input',{type:'number',value:'0.125'});numeric.value='0.125';
const script=new Element('script',{},[new Text('建筑')]);
const editable=new Element('div',{'contenteditable':'true'},[new Text('我的场地')]);
const body=new Element('body',{},[label,option,implicitOption,input,numeric,script,editable]);
const documentObject={body,documentElement:{lang:'zh-CN'},createTreeWalker(root,mask){const nodes=[];function walk(p){for(const c of p.childNodes){if(c.nodeType===(mask===1?1:3))nodes.push(c);walk(c);}}walk(root);let i=0;return {currentNode:null,nextNode(){this.currentNode=nodes[i++];return this.currentNode||null;}};}};
let callback,config,confirmed;
const windowObject={MutationObserver:class{constructor(cb){callback=cb;}observe(node,options){assert.equal(node,body);config=options;}},confirm(message){confirmed=message;return true;}};
startEnglishUI(documentObject,windowObject);
assert.equal(documentObject.documentElement.lang,'en');
assert.equal(label.textContent,'Run');
assert.equal(label.getAttribute('title'),'Regenerate Wool final road network');
assert.equal(option.textContent,'Presentation mode');
assert.equal(option.getAttribute('value'),'presentation');
assert.equal(implicitOption.getAttribute('value'),'保留','Implicit option value must survive label translation');
assert.equal(input.value,'伦敦','User input must not be translated');
assert.equal(numeric.value,'0.125');
assert.ok(!han.test(input.getAttribute('placeholder')));
assert.equal(script.textContent,'建筑','Do not alter executable script text');
assert.equal(editable.textContent,'我的场地','Do not translate user-editable content');
assert.equal(windowObject.confirm('确定清除当前浏览器保存的 Google API 加载统计吗？'),true);
assert.ok(!han.test(confirmed));
const status=new Text('张量场已暂停');body.append(status);
callback([{type:'childList',addedNodes:[status]}]);assert.equal(status.nodeValue,'Tensor field paused');
status.nodeValue='正在加载';callback([{type:'characterData',target:status}]);assert.equal(status.nodeValue,'Loading');
input.setAttribute('title','线条密度');callback([{type:'attributes',target:input}]);assert.equal(input.getAttribute('title'),'Line density');
assert.deepEqual(config.attributeFilter,['title','aria-label','aria-description','aria-valuetext','alt','placeholder']);
assert.ok(!config.attributeFilter.includes('value'),'Never observe or translate control values');
console.log(JSON.stringify({pass:true,dictionaryEntries:Object.keys(ENGLISH_UI).length,sourceRunsChecked:checked,dynamicText:true,tooltips:true,optionAndInputValuesPreserved:true}));
