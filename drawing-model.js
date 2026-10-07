export const PENCIL_COLORS=['#334155','#c93436','#df7437','#e6b741','#38825c','#3677bb','#7955a6','#dc719e','#80533c','#ffffff'];
export const PENCIL_NAMES=['진한 남색','빨강','주황','노랑','초록','파랑','보라','분홍','갈색','흰색'];
export const DRAW_LIMITS=Object.freeze({strokes:160,pointsPerStroke:512,totalPoints:6000});
export function validStrokes(strokes){
 if(!Array.isArray(strokes)||strokes.length>DRAW_LIMITS.strokes)return false;
 let total=0;const ids=new Set();
 for(const s of strokes){
  if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==4||!['id','color','width','points'].every(k=>Object.hasOwn(s,k))||typeof s.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(s.id)||ids.has(s.id)||!PENCIL_COLORS.includes(s.color)||![2,5,10].includes(s.width)||!Array.isArray(s.points)||!s.points.length||s.points.length>DRAW_LIMITS.pointsPerStroke)return false;
  ids.add(s.id);total+=s.points.length;if(total>DRAW_LIMITS.totalPoints)return false;
  for(const p of s.points)if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==2||!Object.hasOwn(p,'x')||!Object.hasOwn(p,'y')||!Number.isInteger(p.x)||p.x<0||p.x>1000||!Number.isInteger(p.y)||p.y<0||p.y>700)return false;
 }
 return true;
}
