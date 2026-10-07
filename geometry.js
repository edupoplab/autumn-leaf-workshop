export function halfPlanePolygon(cut, extent = 190) {
  const {ax,ay,bx,by,keep}=cut;
  const signed=p=>((bx-ax)*(p.y-ay)-(by-ay)*(p.x-ax))*keep;
  const polygon=[{x:-extent,y:-extent},{x:extent,y:-extent},{x:extent,y:extent},{x:-extent,y:extent}];
  const result=[];
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i], b=polygon[(i+1)%polygon.length], da=signed(a), db=signed(b);
    if(da>=0) result.push(a);
    if((da>=0)!==(db>=0)) { const t=da/(da-db); result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}); }
  }
  return result;
}
export function worldToLocal(shape,p) {
  const r=-shape.rotation*Math.PI/180, dx=(p.x-shape.x)/shape.scale,dy=(p.y-shape.y)/shape.scale;
  return {x:dx*Math.cos(r)-dy*Math.sin(r), y:dx*Math.sin(r)+dy*Math.cos(r)};
}
export function starPoints(cx,cy,r) {
  return Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5, rr=i%2?r*.45:r;return `${cx+Math.cos(a)*rr},${cy+Math.sin(a)*rr}`;}).join(' ');
}
export function lineTouchesBox(a,b,min=-110,max=110) {
  if(Math.hypot(b.x-a.x,b.y-a.y)<12) return false;
  let lo=0,hi=1; const dx=b.x-a.x,dy=b.y-a.y;
  for(const [p,q] of [[-dx,a.x-min],[dx,max-a.x],[-dy,a.y-min],[dy,max-a.y]]) {
    if(p===0&&q<0)return false;
    if(p!==0){const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);}
  }
  return lo<=hi;
}
export function splitShape(shape,worldStart,worldEnd,newId,gap=20) {
  const a=worldToLocal(shape,worldStart),b=worldToLocal(shape,worldEnd);
  const length=Math.hypot(worldEnd.x-worldStart.x,worldEnd.y-worldStart.y);
  if(length<1||!newId||newId===shape.id)throw new Error('A distinct piece and a nonzero line are required.');
  const first=structuredClone(shape),second=structuredClone(shape);
  first.cuts??=[];second.cuts??=[];
  const cut={ax:a.x,ay:a.y,bx:b.x,by:b.y,keep:1};
  first.cuts.push(cut);second.cuts.push({...cut,keep:-1});second.id=newId;
  const nx=-(worldEnd.y-worldStart.y)/length,ny=(worldEnd.x-worldStart.x)/length;
  first.x=Math.min(1000,Math.max(0,first.x+nx*gap/2));first.y=Math.min(700,Math.max(0,first.y+ny*gap/2));
  second.x=Math.min(1000,Math.max(0,second.x-nx*gap/2));second.y=Math.min(700,Math.max(0,second.y-ny*gap/2));
  return [first,second];
}
