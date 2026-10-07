import {assetUrl} from './paths.js';
import {MATERIAL_TEXTURES,TEXTURE_PATHS} from './material-textures.js';
export {TEXTURE_PATHS} from './material-textures.js';
import {artBounds} from './art-bounds.js';
import {halfPlanePolygon,starPoints} from './geometry.js';
const NS='http://www.w3.org/2000/svg';
export function el(tag, attrs={}, children=[]) { const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v)); for(const child of children)n.append(child);return n; }
export const COLORS=['#c95f37','#e6b741','#a34532','#78894b','#bd743c','#80533c','#df9650'];
export const BACKGROUNDS=['#fffaf0','#ffffff','#f3ead8','#e9f0e4','#e8f0f4'];
export const MATERIALS=[
  {type:'maple',name:'단풍잎',color:'#c95f37'},
  {type:'ginkgo',name:'은행잎',color:'#e6b741'},
  {type:'oak',name:'참나무잎',color:'#a34532'},
  {type:'oval',name:'작은 잎',color:'#78894b'},
  {type:'acorn',name:'도토리',color:'#bd743c'},
  {type:'chestnut',name:'밤',color:'#80533c'},
  {type:'pinecone',name:'솔방울',color:'#bd743c'}
];
export const PATHS={
 maple:'M0 88 L-8 36 L-58 49 L-45 22 L-95 4 L-72 -10 L-83 -43 L-44 -30 L-49 -72 L-19 -49 L0 -101 L20 -49 L47 -73 L46 -29 L84 -45 L73 -10 L97 5 L45 23 L59 48 L9 36 L6 88 Z',
 ginkgo:'M0 81 C-10 57 -12 37 -20 25 C-44 25 -73 6 -94 -20 C-103 -39 -88 -69 -70 -79 C-49 -86 -23 -83 -3 -70 C2 -65 4 -65 8 -71 C31 -86 57 -84 79 -72 C101 -59 111 -34 95 -16 C70 11 41 25 20 26 C12 43 8 61 7 82 Z',
 oak:'M0 92 C-6 63 -5 44 -8 30 C-49 51 -79 31 -57 13 C-95 18 -106 -16 -75 -22 C-107 -42 -82 -69 -56 -53 C-76 -87 -42 -107 -22 -74 C-33 -119 31 -119 23 -73 C44 -107 79 -85 57 -55 C89 -71 107 -42 75 -22 C107 -15 94 19 58 13 C83 31 48 53 9 31 L6 92 Z',
 oval:'M0 83 C-55 51 -86 2 -69 -47 C-57 -79 -18 -86 0 -106 C25 -85 61 -73 72 -38 C86 7 40 64 0 83 Z',
 acorn:'M-52 -23 C-59 23 -30 61 0 82 C30 60 58 21 51 -23 Z',
 chestnut:'M0 -85 C-16 -53 -55 -49 -66 -6 C-87 57 -45 81 0 81 C45 81 87 57 66 -6 C55 -49 16 -53 0 -85 Z',
 pinecone:'M0 -105 C-30 -85 -52 -54 -61 -20 C-78 30 -47 83 0 96 C47 83 78 30 61 -20 C52 -54 30 -85 0 -105 Z'
};
function path(d,attrs={}){return el('path',{d,...attrs});}
let textureCounter=0;
export function shapeBody(type,color) {
 const asset=MATERIAL_TEXTURES[type];if(!asset)return el('g');
 const id=`material-texture-${++textureCounter}`,outline=`${id}-outline`,clip=`${id}-crop`,defs=el('defs');
 defs.append(el('clipPath',{id:outline},[path(asset.path)]));
 const [x,y,w,h]=asset.crop;defs.append(el('clipPath',{id:clip},[el('rect',{x,y,width:w,height:h})]));
 const image=el('image',{href:assetUrl('playtable/material-atlas.webp'),width:1254,height:1254,'clip-path':`url(#${clip})`,'pointer-events':'none'});
 const natural=MATERIALS.find(m=>m.type===type)?.color;
 if(color!==natural&&COLORS.includes(color)){
  const rgb=[1,3,5].map(n=>parseInt(color.slice(n,n+2),16)/255),rows=rgb.map(c=>[.2126*.9*c,.7152*.9*c,.0722*.9*c,0,.12*c].join(' '));
  defs.append(el('filter',{id:`${id}-color`,'color-interpolation-filters':'sRGB'},[el('feColorMatrix',{type:'matrix',values:rows.join(' ')+' 0 0 0 1 0'})]));image.setAttribute('filter',`url(#${id}-color)`);
 }
 const photo=el('svg',{x:-asset.width/2,y:-asset.height/2,width:asset.width,height:asset.height,viewBox:asset.crop.join(' '),preserveAspectRatio:'none','pointer-events':'none'},[image]);
 return el('g',{},[defs,el('g',{'clip-path':`url(#${outline})`},[photo]),path(asset.path,{fill:'transparent','pointer-events':'all'})]);
}
function holeElement(h) {
 if(h.kind==='circle')return el('circle',{cx:h.x,cy:h.y,r:h.size,fill:'black'});
 if(h.kind==='star')return el('polygon',{points:starPoints(h.x,h.y,h.size),fill:'black'});
 const s=h.size; return path(`M${h.x} ${h.y+s*.8} C${h.x-s*1.7} ${h.y-s*.3} ${h.x-s*.6} ${h.y-s*1.3} ${h.x} ${h.y-s*.5} C${h.x+s*.6} ${h.y-s*1.3} ${h.x+s*1.7} ${h.y-s*.3} ${h.x} ${h.y+s*.8}Z`,{fill:'black'});
}
export function renderShape(shape,prefix='art',selected=false) {
 const outer=el('g',{transform:`translate(${shape.x} ${shape.y}) rotate(${shape.rotation}) scale(${shape.scale})`,'data-shape-id':shape.id});
 const defs=el('defs'); let body=shapeBody(shape.type,shape.color);
 (shape.cuts||[]).forEach((cut,i)=>{const id=`${prefix}-${shape.id}-cut-${i}`,points=halfPlanePolygon(cut).map(p=>`${p.x},${p.y}`).join(' ');defs.append(el('clipPath',{id},[el('polygon',{points})]));body=el('g',{'clip-path':`url(#${id})`},[body]);});
 if(shape.holes?.length){const id=`${prefix}-${shape.id}-holes`;defs.append(el('mask',{id,maskUnits:'userSpaceOnUse',x:-190,y:-190,width:380,height:380},[el('rect',{x:-190,y:-190,width:380,height:380,fill:'white'}),...shape.holes.map(holeElement)]));body=el('g',{mask:`url(#${id})`},[body]);}
 outer.append(defs,body);
 if(selected){outer.append(el('rect',{x:-116,y:-120,width:232,height:228,rx:12,fill:'none',stroke:'#497866','stroke-width':2/shape.scale,'stroke-dasharray':`${7/shape.scale} ${6/shape.scale}`,'pointer-events':'none'}));}
 return outer;
}
export function renderStrokes(strokes=[]) {
 const layer=el('g',{'data-pencil-layer':'true','pointer-events':'none'});
 for(const stroke of strokes){
  if(stroke.points.length===1)layer.append(el('circle',{cx:stroke.points[0].x,cy:stroke.points[0].y,r:stroke.width/2,fill:stroke.color,'data-stroke-id':stroke.id}));
  else layer.append(el('path',{d:stroke.points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' '),fill:'none',stroke:stroke.color,'stroke-width':stroke.width,'stroke-linecap':'round','stroke-linejoin':'round','data-stroke-id':stroke.id}));
 }
 return layer;
}
export function holeMarker(kind,x,y,size){const marker=holeElement({kind,x,y,size});marker.setAttribute('fill','#fffaf0');marker.setAttribute('fill-opacity','.7');marker.setAttribute('stroke','#a34532');marker.setAttribute('stroke-width','2');marker.setAttribute('stroke-dasharray','4 3');marker.setAttribute('pointer-events','none');return marker;}
let counter=0;
export function artPreview(art,label='잎으로 만든 작품') {const svg=el('svg',{viewBox:'0 0 1000 700',role:'img','aria-label':label});svg.append(el('rect',{width:1000,height:700,fill:art.background}));const p=`preview${++counter}`;for(const shape of art.shapes)svg.append(renderShape(shape,p));svg.append(renderStrokes(art.strokes||[]));return svg;}
const objectBoundsCache=new WeakMap();
export function artObjectBounds(art){if(objectBoundsCache.has(art))return objectBoundsCache.get(art);const bounds=artBounds(art,TEXTURE_PATHS,true);objectBoundsCache.set(art,bounds);return bounds;}
export function artObjectPreview(art,label='풍경 속 작품'){const b=artObjectBounds(art),svg=el('svg',{viewBox:`${b.x} ${b.y} ${b.width} ${b.height}`,role:'img','aria-label':label,preserveAspectRatio:'xMidYMid meet'});const prefix=`object${++counter}`;for(const shape of art.shapes)svg.append(renderShape(shape,prefix));svg.append(renderStrokes(art.strokes||[]));return svg;}
export function emptyArt(){return {version:1,background:'#fffaf0',shapes:[],strokes:[]};}
export function syntheticArt(){return {version:1,background:'#fffaf0',shapes:[
{id:'sample1',type:'oak',x:485,y:366,scale:1.46,rotation:78,color:'#c95f37',cuts:[],holes:[]},
{id:'sample2',type:'ginkgo',x:478,y:334,scale:.84,rotation:110,color:'#e6b741',cuts:[],holes:[]},
{id:'sample3',type:'maple',x:344,y:412,scale:.68,rotation:-48,color:'#a34532',cuts:[],holes:[]},
{id:'sample4',type:'acorn',x:612,y:302,scale:.61,rotation:21,color:'#bd743c',cuts:[],holes:[]},
{id:'sample5',type:'oval',x:658,y:302,scale:.29,rotation:86,color:'#e6b741',cuts:[],holes:[]},
{id:'sample6',type:'oval',x:485,y:503,scale:.3,rotation:0,color:'#80533c',cuts:[],holes:[]},
{id:'sample7',type:'oval',x:542,y:502,scale:.3,rotation:-10,color:'#80533c',cuts:[],holes:[]}
]};}
