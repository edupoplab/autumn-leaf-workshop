import {runtimeConfig,createPathHelpers,normalizeAppBase} from './paths.js';
import QRCode from './vendor/qrcode.js';
const ROOM=/^[A-HJ-NP-Z2-9]{6}$/;
const INVITE=/^[A-Za-z0-9_-]{43}$/;
// Manual admission is a separate secret, never the six-character room identifier.
export function normalizeJoinCode(value){
 if(typeof value!=='string'||value.length>32||! /^[0-9 -]+$/.test(value))return null;
 const digits=value.replace(/[ -]/g,'');return /^[0-9]{12}$/.test(digits)?digits:null;
}
export function formatJoinCode(value){const digits=normalizeJoinCode(value);return digits?digits.match(/.{4}/g).join('-'):'';}
export function currentAccessGrant(session,metadata){return typeof session?.grantId==='string'&&Array.isArray(metadata?.accessGrants)&&metadata.accessGrants.some(grant=>grant.id===session.grantId);}
export function validInviteToken(value){return typeof value==='string'&&INVITE.test(value);}
export function linkedInvitation(search){
 if(typeof search!=='string')return null;
 const match=/^\?room=([A-HJ-NP-Z2-9]{6})&invite=([A-Za-z0-9_-]{43})$/.exec(search);
 return match?{code:match[1],inviteToken:match[2]}:null;
}
export function linkedRoom(search){return linkedInvitation(search)?.code||null;}
export function childRoomLink(origin,code,inviteToken,appBase=runtimeConfig.appBase){
 if(!ROOM.test(code))throw new Error('Invalid room code');
 if(!validInviteToken(inviteToken))throw new Error('A valid room invitation is required');
 const base=new URL(origin);if(!['https:','http:'].includes(base.protocol)||base.username||base.password)throw new Error('Invalid site origin');
 const paths=createPathHelpers({appBase:normalizeAppBase(appBase)});
 return new URL(paths.pageUrl('play',{room:code,invite:inviteToken}),base.origin).href;
}
export function roomQrData(origin,code,inviteToken,appBase=runtimeConfig.appBase){const text=childRoomLink(origin,code,inviteToken,appBase),qr=QRCode.create(text,{errorCorrectionLevel:'M'});return {text,size:qr.modules.size,data:qr.modules.data};}
export function roomQrElement(origin,code,inviteToken,appBase=runtimeConfig.appBase){const qr=roomQrData(origin,code,inviteToken,appBase),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),pad=4,size=qr.size+pad*2;svg.setAttribute('viewBox',`0 0 ${size} ${size}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','만들기 방에 들어가는 QR');svg.setAttribute('class','room-qr');svg.setAttribute('shape-rendering','crispEdges');const paper=document.createElementNS(ns,'rect');paper.setAttribute('width',size);paper.setAttribute('height',size);paper.setAttribute('fill','#fff');svg.append(paper);const path=document.createElementNS(ns,'path');let d='';for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.data[y*qr.size+x])d+=`M${x+pad} ${y+pad}h1v1h-1z`;path.setAttribute('d',d);path.setAttribute('fill','#101a15');svg.append(path);return svg;}
