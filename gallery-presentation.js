/** Local viewing mode only. Artwork placement and server state are never changed. */
export function createGalleryPresentation({stage,canvas,enterButton,exitButton}) {
  const doc=stage.ownerDocument,target=doc.documentElement;
  let active=false,nativeOwned=false,returnFocus=null;
  function updateBackground(){
    const image=doc.defaultView.getComputedStyle(canvas).backgroundImage;
    stage.style.setProperty('--presentation-scene',image);
  }
  function restore(){
    if(!active)return;
    active=false;nativeOwned=false;
    stage.classList.remove('gallery-presentation');
    doc.body.classList.remove('gallery-presenting');
    exitButton.hidden=true;enterButton.setAttribute('aria-pressed','false');
    returnFocus?.focus({preventScroll:true});returnFocus=null;
  }
  async function exit(){
    const owned=nativeOwned&&doc.fullscreenElement===target;
    restore();
    if(owned)try{await doc.exitFullscreen();}catch{}
  }
  async function enter(){
    if(active)return;
    returnFocus=doc.activeElement;active=true;nativeOwned=false;
    updateBackground();stage.classList.add('gallery-presentation');
    doc.body.classList.add('gallery-presenting');
    exitButton.hidden=false;enterButton.setAttribute('aria-pressed','true');
    exitButton.focus({preventScroll:true});
    // Unsupported/denied native fullscreen still gets an escapable viewport mode.
    if(typeof target.requestFullscreen==='function'&&!doc.fullscreenElement){
      try{
        await target.requestFullscreen();
        if(!active&&doc.fullscreenElement===target)await doc.exitFullscreen();
        else if(active)nativeOwned=doc.fullscreenElement===target;
      }catch{}
    }
  }
  function onFullscreenChange(){
    if(active&&doc.fullscreenElement===target)nativeOwned=true;
    else if(active&&nativeOwned)restore();
  }
  function onKeydown(event){
    if(active&&event.key==='Escape'&&!doc.querySelector('dialog[open]')){
      event.preventDefault();void exit();
    }
  }
  exitButton.addEventListener('click',exit);
  doc.addEventListener('fullscreenchange',onFullscreenChange);
  doc.addEventListener('keydown',onKeydown);
  return {enter,exit,updateBackground,get active(){return active;}};
}
