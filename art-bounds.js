import {svgPathProperties} from './vendor/path-properties.js';

// Bounds of visible vector geometry on the original 1000 × 700 artboard.
// PATHS is supplied by art.js to avoid an import cycle or duplicate leaf artwork.
const BOARD_WIDTH=1000, BOARD_HEIGHT=700, PAD=3, EPS=1e-8;
const pathCache=new Map();
const finite=Number.isFinite;
const same=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<EPS;

function sampledPaths(d) {
  if(pathCache.has(d)) return pathCache.get(d);
  const paths=[];
  try {
    const properties=new svgPathProperties(d);
    let points=[];
    // Sampling each original segment preserves sharp corners and endpoints.
    for(const part of properties.getParts()) {
      if(!finite(part.length)) continue;
      if(points.length&&!same(points[points.length-1],part.start)) {
        paths.push(points);points=[];
      }
      if(!points.length) points.push({...part.start});
      const count=Math.max(1,Math.ceil(part.length/1.5));
      for(let i=1;i<=count;i++) {
        const p=part.getPointAtLength(part.length*i/count);
        if(finite(p.x)&&finite(p.y)) points.push(p);
      }
    }
    if(points.length) paths.push(points);
  } catch { /* Invalid imported artwork contributes no unbounded geometry. */ }
  pathCache.set(d,paths);
  return paths;
}

function plane(a,b,c) {
  const length=Math.hypot(a,b);
  return length>EPS?{a:a/length,b:b/length,c:c/length}:null;
}
const signed=(p,h)=>h.a*p.x+h.b*p.y+h.c;
const inside=(p,planes)=>planes.every(h=>signed(p,h)>=-EPS);

function constraints(shape) {
  const angle=(shape.rotation??0)*Math.PI/180, scale=shape.scale??1;
  const c=Math.cos(angle)*scale,s=Math.sin(angle)*scale;
  const x=shape.x??0,y=shape.y??0;
  if(![c,s,x,y,scale].every(finite)||Math.abs(scale)<EPS) return null;
  const planes=[plane(c,-s,x),plane(-c,s,BOARD_WIDTH-x),
    plane(s,c,y),plane(-s,-c,BOARD_HEIGHT-y)];
  for(const cut of Array.isArray(shape.cuts)?shape.cuts:[]) {
    if(!cut||![cut.ax,cut.ay,cut.bx,cut.by,cut.keep].every(finite)) continue;
    const dx=cut.bx-cut.ax,dy=cut.by-cut.ay,k=cut.keep;
    const h=plane(-dy*k,dx*k,(dy*cut.ax-dx*cut.ay)*k);
    if(h) planes.push(h);
  }
  // The renderer bounds every cut and hole mask to this local square.
  if((Array.isArray(shape.cuts)&&shape.cuts.length)||(Array.isArray(shape.holes)&&shape.holes.length)) {
    planes.push(plane(1,0,190),plane(-1,0,190),plane(0,1,190),plane(0,-1,190));
  }
  return {planes,transform:p=>({x:x+c*p.x-s*p.y,y:y+s*p.x+c*p.y})};
}

function pointInPolygon(p,polygon) {
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) result=!result;
  }
  return result;
}

function clipCorners(planes) {
  const points=[];
  for(let i=0;i<planes.length;i++) for(let j=i+1;j<planes.length;j++) {
    const a=planes[i],b=planes[j],det=a.a*b.b-b.a*a.b;
    if(Math.abs(det)<EPS) continue;
    const p={x:(a.b*b.c-b.b*a.c)/det,y:(b.a*a.c-a.a*b.c)/det};
    if(inside(p,planes)) points.push(p);
  }
  return points;
}

// Keep every outline-edge fragment inside all half-planes, and every clipping
// corner inside the polygon. Unlike clipping one non-convex point list, this
// cannot invent bridges between disconnected pieces after several cuts.
function addClippedPolygon(polygon,planes,corners,add) {
  if(polygon.length<3) return;
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    let lo=0,hi=1;
    for(const h of planes) {
      const da=signed(a,h),db=signed(b,h),delta=db-da;
      if(Math.abs(delta)<EPS) {if(da<-EPS){lo=1;hi=0;break;}continue;}
      const t=-da/delta;
      if(delta>0) lo=Math.max(lo,t);else hi=Math.min(hi,t);
      if(lo>hi+EPS) break;
    }
    if(lo<=hi+EPS&&lo<=1&&hi>=0) {
      lo=Math.max(0,lo);hi=Math.min(1,hi);
      add({x:a.x+(b.x-a.x)*lo,y:a.y+(b.y-a.y)*lo});
      add({x:a.x+(b.x-a.x)*hi,y:a.y+(b.y-a.y)*hi});
    }
  }
  for(const p of corners) if(pointInPolygon(p,polygon)) add(p);
}

function circlePolygon(p,r) {
  // Circumscribed polygon never trims a round line cap or a pencil dot.
  const count=16,outer=r/Math.cos(Math.PI/count);
  return Array.from({length:count},(_,i)=>{const a=(i+.5)*2*Math.PI/count;return{x:p.x+outer*Math.cos(a),y:p.y+outer*Math.sin(a)};});
}

function addStroke(points,r,emit) {
  if(!points.length||!finite(r)||r<=0) return;
  for(let i=0;i<points.length;i++) {
    const a=points[i];emit(circlePolygon(a,r));
    if(!i) continue;
    const b=points[i-1],length=Math.hypot(b.x-a.x,b.y-a.y);
    if(length<EPS) continue;
    const nx=(b.y-a.y)*r/length,ny=-(b.x-a.x)*r/length;
    emit([{x:a.x+nx,y:a.y+ny},{x:b.x+nx,y:b.y+ny},
      {x:b.x-nx,y:b.y-ny},{x:a.x-nx,y:a.y-ny}]);
  }
}

function addPath(d,fill,r,emit) {
  if(typeof d!=='string'||!d) return;
  for(const points of sampledPaths(d)) {
    if(fill) emit(points);
    if(r) addStroke(points,r,emit);
  }
}

export function artBounds(art,paths={},textured=false) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const addWorld=p=>{if(!finite(p.x)||!finite(p.y))return;minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);};
  for(const shape of Array.isArray(art?.shapes)?art.shapes:[]) {
    if(!shape) continue;
    const config=constraints(shape);if(!config)continue;
    const {planes,transform}=config,corners=clipCorners(planes);
    const emit=polygon=>addClippedPolygon(polygon,planes,corners,p=>addWorld(transform(p)));
    addPath(paths[shape.type]||paths.maple,true,.6,emit);
    if(!textured&&shape.type==='acorn') {
      addPath('M-61 -22 Q-63 -65 0 -67 Q63 -65 61 -22 Q0 -5 -61 -22Z',true,0,emit);
      addPath('M0 -65 Q-8 -86 10 -92',false,5,emit);
    }
    if(!textured&&shape.type==='chestnut') addPath('M-60 40 Q0 13 60 40 Q43 84 0 81 Q-43 84 -60 40Z',true,0,emit);
    if(!textured&&shape.type==='pinecone') for(let row=0;row<6;row++) {
      const yy=-68+row*27,ww=16+Math.min(row,5-row)*12;
      for(let col=-1;col<=1;col++) {
        const xx=col*ww*.9;
        addPath(`M${xx-19} ${yy} Q${xx} ${yy+28} ${xx+19} ${yy} Q${xx} ${yy-15} ${xx-19} ${yy}Z`,true,1,emit);
      }
    }
  }
  const board=[plane(1,0,0),plane(-1,0,BOARD_WIDTH),plane(0,1,0),plane(0,-1,BOARD_HEIGHT)],corners=clipCorners(board);
  for(const stroke of Array.isArray(art?.strokes)?art.strokes:[]) {
    if(!stroke)continue;
    const points=(Array.isArray(stroke.points)?stroke.points:[]).filter(p=>p&&finite(p.x)&&finite(p.y));
    addStroke(points,Math.max(0,Number(stroke.width)||0)/2,polygon=>addClippedPolygon(polygon,board,corners,addWorld));
  }
  if(!finite(minX)) return {x:0,y:0,width:1,height:1};
  const x=Math.max(0,Math.floor(minX-PAD)),y=Math.max(0,Math.floor(minY-PAD));
  const right=Math.min(BOARD_WIDTH,Math.ceil(maxX+PAD)),bottom=Math.min(BOARD_HEIGHT,Math.ceil(maxY+PAD));
  return {x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)};
}
