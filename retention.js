export function deletionLabel(record,now=Date.now()){
 const deadline=Date.parse(record.expiresAt);if(!Number.isFinite(deadline))return '삭제 예정 시각 확인 중';
 const date=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(deadline);
 const remaining=deadline-now;
 return remaining<=0?'보관기간 종료':`삭제 예정 ${date} (한국 시간)${remaining<=86400000?' · 24시간 이내 삭제':''}`;
}
export function isRetained(record,now=Date.now()){return !record.expiresAt||Date.parse(record.expiresAt)>now;}
